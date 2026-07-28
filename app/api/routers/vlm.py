"""POST /vlm/infer — risk-scene analysis pipeline."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_vlm_scheduler, get_vlm_service
from app.schemas.vlm import (
    RuleDraftRequest,
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


# ── 감시 항목(RuleSpec) 편집 — VLM 서버 프록시 ───────────────────────────────
# draft/approve/reset 은 QWEN(GPU)을 쓰므로, 홈페이지는 분석 토글 OFF 상태에서만
# 이 버튼들을 활성화한다(단일 GPU 경합 방지). 서버는 VLM 응답 상태를 그대로 전달한다.
def _relay(status: int, data: dict) -> dict:
    if status >= 400:
        raise HTTPException(status_code=status, detail=data.get("detail", data))
    return data


@router.get("/rules", summary="현재 5개 감시 항목 요약")
async def rules_list(service: VlmService = Depends(get_vlm_service)) -> dict:
    return _relay(*(await service.rules_list()))


@router.post("/rules/preset/expert-safety", summary="기업 시연용 전용 5종 preset 적용")
async def expert_safety_preset(
    service: VlmService = Depends(get_vlm_service),
) -> dict:
    """기존 사용자 재배정 항목을 명시적으로 전용 5종 preset으로 교체한다."""
    return _relay(*(await service.restore_expert_safety_preset()))


@router.post("/rules/{slot}/draft", summary="자연어 감시 항목 초안 컴파일(미적용)")
async def rule_draft(
    slot: str, body: RuleDraftRequest, service: VlmService = Depends(get_vlm_service)
) -> dict:
    return _relay(*(await service.rule_draft(slot, body.text)))


@router.post("/rules/{slot}/approve", summary="초안 승인·적용 + 슬롯 카운트 리셋")
async def rule_approve(slot: str, service: VlmService = Depends(get_vlm_service)) -> dict:
    return _relay(*(await service.rule_approve(slot)))


@router.post("/rules/{slot}/discard", summary="대기 중 초안 폐기")
async def rule_discard(slot: str, service: VlmService = Depends(get_vlm_service)) -> dict:
    return _relay(*(await service.rule_discard(slot)))


@router.post("/rules/{slot}/reset", summary="슬롯을 내장 기본 항목으로 복원")
async def rule_reset(slot: str, service: VlmService = Depends(get_vlm_service)) -> dict:
    return _relay(*(await service.rule_reset(slot)))
