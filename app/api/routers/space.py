"""GET /space-name — process info for the currently selected work zone."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_space_service
from app.schemas.space import BehaviorResetResponse, SpaceNameResponse
from app.services.space_service import SpaceService

router = APIRouter(tags=["space"])


@router.post(
    "/behavior/reset",
    response_model=BehaviorResetResponse,
    summary="불안전행동 카운트 초기화",
)
async def reset_behavior(
    process_code: str = Query(
        description="초기화할 공정 코드 (예: PRC-19)",
        examples=["PRC-19"],
    ),
    service: SpaceService = Depends(get_space_service),
) -> BehaviorResetResponse:
    """지정 공정의 불안전행동 카운트를 전부 0으로 초기화하고 경광등을 녹색(초기) 상태로 되돌린다."""
    service.reset_behaviors(process_code)
    return BehaviorResetResponse(reset=True, process_code=process_code)


@router.get("/space-name", response_model=SpaceNameResponse, summary="공정 정보 조회")
async def space_name(
    process_code: str | None = Query(
        default=None,
        description="공정 코드 (예: PRC-19). 생략 시 첫 번째 공정.",
        examples=["PRC-19"],
    ),
    service: SpaceService = Depends(get_space_service),
) -> SpaceNameResponse:
    """선택된 공정의 이름/코드, 4개 불안전행동 카운트, 온습도, CCTV 정보를 반환."""
    return service.get_space_name(process_code)
