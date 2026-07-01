"""경광등·신호등 공용 카운트 기준치의 런타임 단일 소스(single source of truth).

기준치는 배포마다 고정되는 값이 아니라 키오스크에서 운영 중 조정하는 값이라,
부팅 시 1회만 읽는 ``.env``(Settings) 대신 JSON 파일에 영속화한다. 프론트의 신호등
UI(색상 단계)와 백엔드의 실물 경광등(vlm_service)이 모두 이 store 하나를 바라보므로
[기준치] 패널에서 바꾸면 둘 다 함께 바뀐다.

- ``GET /led/thresholds`` → 현재값 조회
- ``PUT /led/thresholds`` → 검증 후 저장(파일 갱신)
- 파일이 없거나 손상되면 Settings 의 기본값으로 시드한다.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from app.core.config import Settings

logger = logging.getLogger(__name__)

# 관심 < 주의 < 경고 < 위험 (오름차순). 표시/저장 순서도 이 순서를 따른다.
THRESHOLD_KEYS: tuple[str, ...] = ("interest", "caution", "warning", "danger")


class ThresholdError(ValueError):
    """기준치 검증 실패(최소값 위반 또는 오름차순 위반)."""


def _validate(values: dict[str, int]) -> None:
    for key in THRESHOLD_KEYS:
        v = values.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            raise ThresholdError(f"{key} 기준치는 1 이상의 정수여야 합니다")
    if not (
        values["interest"] < values["caution"]
        < values["warning"] < values["danger"]
    ):
        raise ThresholdError("기준치는 관심 < 주의 < 경고 < 위험 순으로 커야 합니다")


class LightThresholdStore:
    """카운트→단계 기준치를 JSON 파일에 영속화하는 프로세스 전역 싱글턴.

    읽기/쓰기는 락으로 보호한다(FastAPI 는 동기 핸들러를 스레드풀에서 실행).
    """

    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.light_threshold_file)
        self._lock = threading.Lock()
        # Settings 기본값을 시드로 사용(파일이 없을 때만 최종 반영).
        self._values: dict[str, int] = {
            "interest": settings.light_interest_threshold,
            "caution": settings.light_caution_threshold,
            "warning": settings.light_warning_threshold,
            "danger": settings.light_danger_threshold,
        }
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            self._persist()  # 최초 실행: 기본값을 파일로 시드
            logger.info("[기준치] %s 없음 → 기본값으로 시드", self._path)
            return
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("[기준치] %s 읽기 실패, 기본값 사용: %s", self._path, exc)
            return

        merged = dict(self._values)
        for key in THRESHOLD_KEYS:
            v = raw.get(key)
            if isinstance(v, int) and not isinstance(v, bool):
                merged[key] = v
        try:
            _validate(merged)
        except ThresholdError as exc:
            logger.warning("[기준치] 저장값 검증 실패, 기본값 사용: %s", exc)
            return
        self._values = merged

    def _persist(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps(self._values, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            logger.warning("[기준치] %s 저장 실패: %s", self._path, exc)

    def get(self) -> dict[str, int]:
        with self._lock:
            return dict(self._values)

    def set(self, values: dict[str, int]) -> dict[str, int]:
        """검증 후 반영 + 파일 저장. 실패 시 ``ThresholdError``."""
        cleaned = {key: int(values[key]) for key in THRESHOLD_KEYS}
        _validate(cleaned)
        with self._lock:
            self._values = cleaned
            self._persist()
            return dict(self._values)
