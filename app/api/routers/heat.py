"""GET /api/heat — 공정별 체감온도(값+등급)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_heat_service
from app.schemas.heat import HeatListResponse, ProcessHeat
from app.services.heat_service import HeatService

router = APIRouter(prefix="/api/heat", tags=["heat"])


@router.get("", response_model=HeatListResponse, summary="전체 공정 체감온도 목록")
async def list_heat(
    service: HeatService = Depends(get_heat_service),
) -> HeatListResponse:
    processes = service.list_all()
    return HeatListResponse(count=len(processes), processes=processes)


@router.get("/{process_code}", response_model=ProcessHeat, summary="단일 공정 체감온도")
async def get_heat(
    process_code: str,
    service: HeatService = Depends(get_heat_service),
) -> ProcessHeat:
    result = service.get_one(process_code)
    if result is None:
        raise HTTPException(status_code=404, detail=f"공정을 찾을 수 없습니다: {process_code}")
    return result
