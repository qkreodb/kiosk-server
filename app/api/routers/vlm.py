"""POST /vlm/infer — risk-scene analysis pipeline."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_vlm_scheduler, get_vlm_service
from app.schemas.vlm import (
    VlmInferRequest,
    VlmInferResponse,
    VlmPromptRequest,
    VlmPromptResponse,
)
from app.services.vlm_scheduler import VlmScheduler
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
        frame_dir=req.frame_dir,
        labels=req.labels,
    )


@router.post("/prompt", response_model=VlmPromptResponse, summary="VLM 자유 프롬프트 질의")
async def prompt(
    body: VlmPromptRequest,
    service: VlmService = Depends(get_vlm_service),
) -> VlmPromptResponse:
    """신규 CCTV 모달용 — 사용자 프롬프트를 VLM /prompt 로 전달하고 답변 텍스트 반환.

    카운트·TTS·경광등 파이프라인을 타지 않는 순수 질의. path 생략 시 camera_id 의
    DB frame_dir 로 자동 해석한다.
    """
    return await service.prompt(
        camera_id=body.camera_id,
        prompt=body.prompt,
        path=body.path,
    )


@router.post("/stop", summary="대기 중 TTS 취소(재생 중인 건 유지)")
async def stop(service: VlmService = Depends(get_vlm_service)) -> dict:
    """CCTV 모달 종료 등에서 호출 — 재생 중인 음성은 끝까지 두고 대기/지연 TTS만 폐기."""
    service.flush_tts()
    return {"stopped": True}


@router.post("/scheduler/start", summary="서버 측 다중 카메라 분석 스케줄러 시작")
async def scheduler_start(scheduler: VlmScheduler = Depends(get_vlm_scheduler)) -> dict:
    """DB 카메라 목록을 주기적으로 순회하며 각자 공정·프레임폴더로 분석(브라우저 불필요)."""
    scheduler.start()
    return scheduler.status()


@router.post("/scheduler/stop", summary="분석 스케줄러 중지")
async def scheduler_stop(scheduler: VlmScheduler = Depends(get_vlm_scheduler)) -> dict:
    await scheduler.stop()
    return scheduler.status()


@router.get("/scheduler/status", summary="분석 스케줄러 상태")
async def scheduler_status(scheduler: VlmScheduler = Depends(get_vlm_scheduler)) -> dict:
    return scheduler.status()
