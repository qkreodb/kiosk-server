"""GET /modal/msds and GET /modal/risk."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_modal_service
from app.schemas.modal import MsdsResponse, RiskResponse
from app.services.modal_service import ModalService

router = APIRouter(prefix="/modal", tags=["modal"])


@router.get("/msds", response_model=MsdsResponse, summary="MSDS 모달 데이터")
async def msds(
    service: ModalService = Depends(get_modal_service),
) -> MsdsResponse:
    return service.get_msds()


@router.get("/risk", response_model=RiskResponse, summary="위험성평가 모달 데이터")
async def risk(
    process_code: str | None = Query(default=None, examples=["PRC-19"]),
    service: ModalService = Depends(get_modal_service),
) -> RiskResponse:
    return service.get_risk(process_code)
