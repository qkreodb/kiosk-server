"""Business logic for the /danger-frames gallery.

VLM 서버가 위험행동 감지 시 저장한 스냅샷 폴더를 읽어, 파일명을 공정/위반/시각으로
파싱해 목록을 만든다. 파일 자체 서빙은 경로 이탈(traversal)을 막고 이미지 확장자만
허용한다. 폴더 소유·저장 규칙은 VLM 서버의 몫이고, 여기서는 **읽기 전용**이다.

저장 규칙(VLM 서버): ``공정이름_위반사항_YYYYMMDD_HHMMSS.png``
  * 공정명의 공백/특수문자는 ``_`` 로 치환(한글 유지), 미지정이면 ``unknown``
  * 위반이 여러 개면 ``-`` 로 연결 (각 위반 키는 그 자체에 ``_`` 를 포함할 수 있음)
  * 원본이 jpg 여도 png 로 저장(변환 실패 시에만 원본 확장자)
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import quote

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import CATEGORY_BY_ID, VLM_ACTION_KEY_MAP
from app.schemas.danger import DangerFrame

logger = get_logger(__name__)

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

# 파일명 파서: ``{공정}_{위반(-위반)*}_{YYYYMMDD}_{HHMMSS}``.
# 위반 키는 그 자체에 ``_`` 를 포함하므로(예: helmet_off) 알려진 키 집합으로만 매칭하고,
# 공정명은 비탐욕(.+?)으로 잡아 위반/시각을 우선 확정한다.
_VIOL_ALT = "|".join(re.escape(k) for k in VLM_ACTION_KEY_MAP)
_NAME_RE = re.compile(
    r"^(?P<process>.+?)_(?P<viol>(?:%s)(?:-(?:%s))*)_(?P<date>\d{8})_(?P<time>\d{6})$"
    % (_VIOL_ALT, _VIOL_ALT)
)


def _labels_for(keys: list[str]) -> list[str]:
    """위반 키 → 한글 라벨(알 수 없는 키는 키 그대로)."""
    out: list[str] = []
    for k in keys:
        cat_id = VLM_ACTION_KEY_MAP.get(k)
        out.append(CATEGORY_BY_ID[cat_id].name if cat_id else k)
    return out


class DangerFrameService:
    def __init__(self, settings: Settings) -> None:
        self._dir = Path(settings.danger_frames_dir)

    @property
    def dir_str(self) -> str:
        return str(self._dir)

    def _parse(self, name: str) -> DangerFrame:
        """파일명 하나를 DangerFrame 으로 파싱. 형식이 안 맞으면 파일명만 채운다."""
        stem = name.rsplit(".", 1)[0]
        m = _NAME_RE.match(stem)
        if not m:
            return DangerFrame(
                filename=name, process="unknown", violations=[],
                violation_labels=[], captured_at=None,
                url=f"/danger-frames/file/{quote(name)}",
            )
        keys = m.group("viol").split("-")
        d, t = m.group("date"), m.group("time")
        captured_at = f"{d[0:4]}-{d[4:6]}-{d[6:8]} {t[0:2]}:{t[2:4]}:{t[4:6]}"
        return DangerFrame(
            filename=name,
            process=m.group("process") or "unknown",
            violations=keys,
            violation_labels=_labels_for(keys),
            captured_at=captured_at,
            url=f"/danger-frames/file/{quote(name)}",
        )

    def list_frames(self) -> list[DangerFrame]:
        """폴더의 이미지 파일을 최신순으로 파싱해 반환. 폴더 없으면 빈 목록."""
        if not self._dir.is_dir():
            return []
        frames: list[tuple[str, DangerFrame]] = []
        for p in self._dir.iterdir():
            if not p.is_file() or p.suffix.lower() not in _IMAGE_EXTS:
                continue
            frame = self._parse(p.name)
            # 정렬 키: 파싱된 시각이 있으면 그걸로, 없으면 파일 수정시각으로 폴백.
            sort_key = frame.captured_at or ""
            if not sort_key:
                try:
                    sort_key = str(p.stat().st_mtime)
                except OSError:
                    sort_key = ""
            frames.append((sort_key, frame))
        frames.sort(key=lambda x: x[0], reverse=True)  # 최신 먼저
        return [f for _, f in frames]

    def frame_path(self, filename: str) -> Path | None:
        """이미지 파일의 실제 경로(경로 이탈 차단 + 이미지 확장자만). 없으면 None."""
        # 디렉터리 구분자/상위경로 차단: 파일명 그 자체만 허용.
        if not filename or filename != Path(filename).name:
            return None
        candidate = self._dir / filename
        try:
            resolved = candidate.resolve()
            base = self._dir.resolve()
        except OSError:
            return None
        if base != resolved and base not in resolved.parents:
            return None
        if not resolved.is_file() or resolved.suffix.lower() not in _IMAGE_EXTS:
            return None
        return resolved

    def clear_frames(self) -> int:
        """폴더의 이미지 파일을 모두 삭제하고 삭제한 개수를 반환. 폴더 없으면 0.

        신호등 [초기화] 와 연동 — 카운트 리셋과 함께 누적된 위험 스냅샷도 비운다.
        이미지 확장자만 지우므로 폴더 내 다른 파일은 건드리지 않는다.
        """
        if not self._dir.is_dir():
            return 0
        deleted = 0
        for p in self._dir.iterdir():
            if p.is_file() and p.suffix.lower() in _IMAGE_EXTS:
                try:
                    p.unlink()
                    deleted += 1
                except OSError as exc:
                    logger.warning("[danger] 파일 삭제 실패 %s: %s", p, exc)
        return deleted
