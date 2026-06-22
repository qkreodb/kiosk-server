"""POST /vlm/infer — risk-scene analysis pipeline."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_vlm_service
from app.schemas.vlm import VlmInferRequest, VlmInferResponse
from app.services.vlm_service import VlmService

router = APIRouter(prefix="/vlm", tags=["vlm"])


@router.post("/infer", response_model=VlmInferResponse, summary="VLM 위험장면 분석")
async def infer(
    body: VlmInferRequest | None = None,
    service: VlmService = Depends(get_vlm_service),
) -> VlmInferResponse:
    """VLM 호출 → TTS(스피커) + 파싱·DB 반영·경광등 제어 신호 생성 후 결과 반환."""
    req = body or VlmInferRequest()
    return await service.infer(
        camera_id=req.camera_id,
        process_code=req.process_code,
        frame_ref=req.frame_ref,
    )
