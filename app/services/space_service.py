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

    def get_space_name(self, process_code: str | None = None) -> SpaceNameResponse:
        all_processes = self._repo.get_processes()
        code = process_code or self._default_process_code()

        process = self._repo.get_process(code)
        if process is None:
            raise HTTPException(
                status_code=404, detail=f"알 수 없는 공정 코드: {code}"
            )

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
            temp_humid = TempHumidReading(timestamp=_now_iso(), **th["readings"][0])

        cameras = [CameraInfo(**c) for c in self._repo.get_cameras(code)]

        return SpaceNameResponse(
            process=ProcessSummary(**process),
            processes=[ProcessSummary(**p) for p in all_processes],
            behaviors=behaviors,
            temp_humid=temp_humid,
            cameras=cameras,
        )
