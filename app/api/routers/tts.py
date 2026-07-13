"""POST /tts/demo — 하드코딩 경고문 TTS 합성 및 스피커 재생 (VLM 미연동 데모용)."""

from __future__ import annotations

import asyncio
import random

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_app_settings
from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.actuators import SpeakerActuator
from app.integrations.tts import TtsService

router = APIRouter(prefix="/tts", tags=["tts"])
logger = get_logger(__name__)

# VLM 없이 데모용으로 재생할 하드코딩 경고 메시지 목록
_DEMO_MESSAGES = [
    "안전모를 착용하세요. 안전모는 머리 부상을 예방하는 필수 보호구입니다.",
    "설비에서 손을 떼주세요. 가동 중인 설비에 접근하면 위험합니다.",
    "위험지역에 무단으로 접근하지 마세요. 즉시 안전구역으로 이동하세요.",
    "사다리 작업 시 반드시 보조 작업자를 배치하세요. 혼자 올라가면 위험합니다.",
]


class TtsDemoResponse(BaseModel):
    status: str
    text: str
    voice: str
    audio_path: str | None = None
    detail: str | None = None


@router.post("/demo", response_model=TtsDemoResponse, summary="TTS 데모 재생 (하드코딩)")
async def tts_demo(
    settings: Settings = Depends(get_app_settings),
) -> TtsDemoResponse:
    """하드코딩 경고 메시지를 Edge TTS로 합성 후 스피커로 재생한다 (VLM 미연동 데모용)."""
    text = random.choice(_DEMO_MESSAGES)
    tts = TtsService(settings)
    result = await tts.synthesize(text)

    if result.audio_path:
        speaker = SpeakerActuator(settings.speaker_alsa_device)
        # playsound는 블로킹 호출이므로 스레드 풀에서 실행
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, speaker.play, result.audio_path, result.text)

    return TtsDemoResponse(
        status=result.status,
        text=result.text,
        voice=result.voice,
        audio_path=result.audio_path,
        detail=result.detail,
    )
