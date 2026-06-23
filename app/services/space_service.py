"""Business logic for GET /space-name (process info for the selected zone)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.domain.constants import BEHAVIOR_CATEGORIES
from app.repositories.base import KioskRepository
from app.schemas.common import CameraInfo
from app.schemas.sensor import TempHumidReading
from app.schemas.space import (
    BehaviorCount,
    ProcessSummary,
    SpaceNameResponse,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class SpaceService:
    def __init__(self, repo: KioskRepository) -> None:
        self._repo = repo

    def _default_process_code(self) -> str:
        processes = self._repo.get_processes()
        return processes[0]["code"] if processes else ""

    def reset_behaviors(self, process_code: str) -> None:
        """지정 공정의 모든 불안전행동 count를 0으로 초기화한다."""
        process = self._repo.get_process(process_code)
        if process is None:
            raise HTTPException(
                status_code=404, detail=f"알 수 없는 공정 코드: {process_code}"
            )
        self._repo.reset_behavior_counts(process_code)

    def get_space_name(self, process_code: str | None = None) -> SpaceNameResponse:
        all_processes = self._repo.get_processes()
        code = process_code or self._default_process_code() or "PRC-19"

        process = self._repo.get_process(code)
        if process is None:
            if all_processes:
                raise HTTPException(
                    status_code=404, detail=f"알 수 없는 공정 코드: {code}"
                )
            process = {"name": "현장 공정", "code": code, "label": "현장 공정"}
            all_processes = [process]

        counts = self._repo.get_behavior_counts(code)
        behaviors = [
            BehaviorCount(
                id=cat.id.value,
                name=cat.name,
                grade=cat.base_grade.value,
                count=int(counts.get(cat.id.value, 0)),
            )
            for cat in BEHAVIOR_CATEGORIES
        ]

        th = self._repo.get_temp_humid(code)
        temp_humid = None
        if th["readings"]:
            reading = dict(th["readings"][0])
            temp_humid = TempHumidReading(
                timestamp=reading.pop("timestamp", None) or _now_iso(),
                **reading,
            )

        cameras = [CameraInfo(**c) for c in self._repo.get_cameras(code)]

        return SpaceNameResponse(
            process=ProcessSummary(**process),
            processes=[ProcessSummary(**p) for p in all_processes],
            behaviors=behaviors,
            temp_humid=temp_humid,
            cameras=cameras,
        )
