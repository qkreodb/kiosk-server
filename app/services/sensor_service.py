"""Business logic for temp/humidity and watch (heart-rate) endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from app.repositories.base import KioskRepository
from app.schemas.sensor import (
    TempHumidReading,
    TempHumidResponse,
    WatchReading,
    WatchResponse,
)

# Heart-rate thresholds — match the kiosk frontend (kiosk.html).
HR_DANGER = 130   # >= 130 -> 위험
HR_CAUTION = 110  # >= 110 -> 주의


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def hr_status(bpm: int) -> str:
    if bpm >= HR_DANGER:
        return "위험"
    if bpm >= HR_CAUTION:
        return "주의"
    return "정상"


class SensorService:
    def __init__(self, repo: KioskRepository) -> None:
        self._repo = repo

    def get_temp_humid(
        self, process_code: str | None = None, sensor_name: str | None = None
    ) -> TempHumidResponse:
        data = self._repo.get_temp_humid(process_code, sensor_name)
        readings = [
            TempHumidReading(timestamp=r.pop("timestamp", None) or _now_iso(), **r)
            for r in data["readings"]
        ]
        return TempHumidResponse(
            location=data["location"], count=len(readings), readings=readings
        )

    def get_watch(self, process_code: str | None = None) -> WatchResponse:
        data = self._repo.get_watch(process_code)
        workers = []
        for w in data["workers"]:
            bpm = int(w["hr"])
            workers.append(
                WatchReading(
                    watch_id=w["watch_id"],
                    name=w.get("name"),
                    hr=bpm,
                    status=hr_status(bpm),
                    zone=w.get("zone"),
                    process_code=w.get("process_code"),
                    device=w.get("device", "Galaxy Watch"),
                    timestamp=w.get("timestamp") or _now_iso(),
                )
            )
        return WatchResponse(region=data["region"], count=len(workers), workers=workers)
