"""GET /sensor/temp-humid and GET /sensor/watch."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_sensor_service
from app.schemas.sensor import TempHumidResponse, WatchResponse
from app.services.sensor_service import SensorService

router = APIRouter(prefix="/sensor", tags=["sensor"])


@router.get("/temp-humid", response_model=TempHumidResponse, summary="온습도 센서 조회")
async def temp_humid(
    process_code: str | None = Query(default=None, examples=["PRC-19"]),
    sensor_name: str | None = Query(
        default=None,
        description="특정 센서만 조회 (예: shelly_1, sonoff_1). 미지정 시 전체 센서.",
        examples=["shelly_1"],
    ),
    service: SensorService = Depends(get_sensor_service),
) -> TempHumidResponse:
    return service.get_temp_humid(process_code, sensor_name)


@router.get("/watch", response_model=WatchResponse, summary="갤럭시워치 심박 조회")
async def watch(
    process_code: str | None = Query(default=None, examples=["PRC-19"]),
    service: SensorService = Depends(get_sensor_service),
) -> WatchResponse:
    return service.get_watch(process_code)
