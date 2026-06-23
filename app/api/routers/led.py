"""POST /led/trigger, POST /led/off — 실물 경광등(LED) 제어.

최종적으로는 VLM 탐지 파이프라인이 호출하지만, VLM 연동 전 시연을 위해 키오스크의
신호등 카드 4개 칸(관심/주의/경고/위험) 버튼이 ``/led/trigger`` 를 직접 호출한다.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_led_service
from app.services.led_service import LedService

router = APIRouter(prefix="/led", tags=["led"])

LedLevel = Literal["interest", "caution", "warning", "danger"]


class LedTriggerRequest(BaseModel):
    level: LedLevel = Field(
        description="심각도 레벨 (관심/주의/경고/위험)",
        examples=["danger"],
    )
    dry_run: bool | None = Field(
        default=None,
        description="true면 HID 전송 없이 페이로드만 반환. 생략 시 서버 기본값(KIOSK_LED_DRY_RUN).",
    )


class LedOffRequest(BaseModel):
    dry_run: bool | None = None


@router.post("/trigger", summary="경광등 점등 (심각도 레벨)")
async def trigger(
    body: LedTriggerRequest,
    service: LedService = Depends(get_led_service),
) -> dict:
    """선택한 심각도 레벨에 해당하는 색/패턴으로 경광등을 점등한다."""
    return service.trigger(body.level, body.dry_run)


@router.post("/off", summary="경광등 소등")
async def off(
    body: LedOffRequest | None = None,
    service: LedService = Depends(get_led_service),
) -> dict:
    return service.off((body or LedOffRequest()).dry_run)


@router.get("/devices", summary="HID 장치 진단 (경광등 인식 여부)")
async def devices(
    service: LedService = Depends(get_led_service),
) -> dict:
    """연결된 HID 장치 목록과 대상 경광등(ST80EL-USB) 인식 여부를 반환한다.

    불이 안 켜질 때 원인 진단용:
    - ``hidapi: false`` → hidapi 미설치 (Jetson에 설치 필요)
    - ``match_count: 0`` → 장치 미연결/드라이버 문제
    - 매칭되는데 /led/trigger 가 503 → 권한 문제(udev 규칙 또는 sudo)
    """
    return service.devices()
