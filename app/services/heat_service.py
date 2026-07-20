"""공정별 체감온도(값+등급) 계산 — GET /api/heat 백엔드.

기존 ``KioskRepository.get_temp_humid(process_code=...)`` 의 프로세스별 JOIN
조회를 그대로 재사용하고, 계산은 domain/thermal_comfort.py 의
calculate_feels_like/grade_feels_like 만 쓴다(공식·임계값 재작성 금지). DB
접근은 리포지토리 뒤의 기존 동기 PyMySQL 패턴 그대로 — 이 서비스 자체는 SQL을
직접 만지지 않는다.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.domain.thermal_comfort import calculate_feels_like, grade_feels_like
from app.repositories.base import KioskRepository

# 센서 재발행 주기(하드웨어 쪽 shelly.py 기본 republish-interval=300초) 대비
# 넉넉한 여유를 둔 "오래됨" 기준. 이보다 오래된 마지막 측정치는 값이 있어도
# 화면에 보여주지 않고 미수신으로 처리한다(신선도를 보장 못 하는 값 노출 방지).
STALE_AFTER_SECONDS = 600

STATUS_NO_DATA = "미수신"


def _is_stale(timestamp: str | None) -> bool:
    """측정 시각 문자열이 STALE_AFTER_SECONDS 보다 오래됐으면 True(값 없음도 True)."""
    if not timestamp:
        return True
    try:
        measured_at = datetime.fromisoformat(timestamp)
    except ValueError:
        return True
    # get_temp_humid() 가 주는 timestamp 는 DB DATETIME 그대로(naive, 로컬시간) —
    # 같은 기준(naive/aware)으로 비교해야 TypeError 가 안 난다.
    now = datetime.now(measured_at.tzinfo) if measured_at.tzinfo else datetime.now()
    return now - measured_at > timedelta(seconds=STALE_AFTER_SECONDS)


class HeatService:
    def __init__(self, repo: KioskRepository) -> None:
        self._repo = repo

    def _process_heat(self, process: dict[str, Any]) -> dict[str, Any]:
        code = process["code"]
        name = process["name"]

        data = self._repo.get_temp_humid(process_code=code)
        readings = data.get("readings") or []
        reading = readings[0] if readings else None
        timestamp = reading.get("timestamp") if reading else None

        if reading is None or _is_stale(timestamp):
            return {
                "process_id": code,
                "process_name": name,
                "temperature": None,
                "humidity": None,
                "heat_index": None,
                "status": STATUS_NO_DATA,
                # 값은 감추되(신선도 보장 불가), 마지막으로 언제 받았는지는 남겨서
                # 진단에 쓸 수 있게 한다. 아예 안 들어온 적이 없으면 null.
                "updated_at": timestamp,
            }

        ta = reading["temp"]
        rh = reading["humidity"]
        heat_index = calculate_feels_like(ta, rh)
        return {
            "process_id": code,
            "process_name": name,
            "temperature": ta,
            "humidity": rh,
            "heat_index": heat_index,
            "status": grade_feels_like(heat_index),
            "updated_at": timestamp,
        }

    def list_all(self) -> list[dict[str, Any]]:
        """전체 공정을 순회하며 각 공정의 최신 체감온도 스냅샷을 만든다."""
        return [self._process_heat(p) for p in self._repo.get_processes()]

    def get_one(self, process_code: str) -> dict[str, Any] | None:
        """단일 공정. 존재하지 않는 공정 코드면 None(라우터가 404로 변환)."""
        process = self._repo.get_process(process_code)
        if process is None:
            return None
        return self._process_heat(process)
