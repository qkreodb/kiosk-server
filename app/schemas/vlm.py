"""DTOs for POST /vlm/infer — the risk-scene analysis pipeline.

Mirrors the right-hand side of 001.png: the VLM returns 탐지 / 위험 경고 텍스트,
which fan out into a TTS branch (speaker) and a DB-count branch (warning light).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class VlmInferRequest(BaseModel):
    """Trigger payload from the kiosk for a connected camera."""

    camera_id: str = Field(default="CAM-03", examples=["CAM-03"])
    process_code: str | None = Field(default=None, examples=["PRC-19"])
    # Optional override frame reference; when omitted the server uses the latest
    # Shared Dir frame for the camera.
    frame_ref: str | None = Field(default=None)
    # Jetson 파일시스템의 프레임 폴더 절대 경로. 생략 시 설정값(KIOSK_VLM_FRAME_DIR).
    # 주로 테스트/특정 폴더 지정용 오버라이드.
    frame_dir: str | None = Field(
        default=None, examples=["/home/ds/Desktop/vlm_test/frames_448_30"]
    )


class BehaviorDelta(BaseModel):
    """Result of parsing one detected behavior into a category + DB increment."""

    id: str = Field(examples=["helmet_off"])
    name: str = Field(examples=["모자(안전모) 벗는 행동"])
    grade: str = Field(examples=["위험"])
    matched_label: str = Field(description="이 카테고리에 매칭된 원본 탐지 라벨")
    increment: int = Field(description="이번 추론으로 더해진 횟수", examples=[1])
    count: int = Field(description="반영 후 누적 횟수", examples=[3])


class WarningLightSignal(BaseModel):
    """Control signal generated for the 경광등 from the cumulative count."""

    state: str = Field(description="off / green / yellow_blink / red_blink")
    label: str = Field(description="한글 제어 신호", examples=["노란색 볼 깜빡임"])
    trigger_count: int = Field(description="신호 산정에 사용된 누적 카운트")
    caution_threshold: int
    danger_threshold: int
    dispatched: bool = Field(description="경광등으로 신호 전송 여부")


class TtsDispatch(BaseModel):
    """Status of the TTS (Edge TTS -> speaker) branch."""

    status: str = Field(description="synthesized / stubbed / skipped / failed")
    text: str = Field(description="음성 변환된 위험 경고 텍스트")
    voice: str
    audio_path: str | None = Field(default=None, description="생성된 오디오 파일 경로")
    detail: str | None = None


class VlmInferResponse(BaseModel):
    """Combined result returned to the kiosk."""

    camera_id: str
    process_code: str | None = None
    source: str = Field(description="vlm / mock — 응답 출처")

    detection: str = Field(description="감지된 행동 라벨 요약", examples=["모자(안전모) 벗는 행동, 사다리 혼자 올라가는 행동"])
    detection_labels: list[str] = Field(description="감지된 행동 라벨 목록")
    scene_description: str = Field(default="", description="VLM 장면 설명 원문(vlm_description)")
    warning_text: str = Field(examples=["안전모를 착용하고 단독 사다리 작업을 중지하세요"])

    behaviors: list[BehaviorDelta] = Field(description="파싱 & DB 반영 결과")
    warning_light: WarningLightSignal
    tts: TtsDispatch
