"""DTOs for POST /vlm/infer — the risk-scene analysis pipeline.

Mirrors the right-hand side of 001.png: the VLM returns 탐지 / 위험 경고 텍스트,
which fan out into a TTS branch (speaker) and a DB-count branch (warning light).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class RuleDraftRequest(BaseModel):
    """홈페이지에서 입력한 자연어 감시 항목 문장."""

    text: str = Field(min_length=1, examples=["안전화 미착용"])


class VlmInferRequest(BaseModel):
    """Trigger payload from the kiosk for a connected camera."""

    camera_id: str = Field(default="CAM-1", examples=["CAM-1"])
    process_code: str | None = Field(default=None, examples=["PRC-19"])
    frame_ref: str | None = Field(default=None)
    # Jetson 파일시스템의 프레임 폴더 절대 경로. 생략 시 설정값(KIOSK_VLM_FRAME_DIR).
    frame_dir: str | None = Field(
        default=None, examples=["/home/ds/Desktop/vlm_test/frames_448_30"]
    )
    # 분석 대상 라벨(불안전행동 감시 신호등에서 체크된 행동 키). VLM 서버에 그대로
    # 전달돼 해당 라벨만 탐지하게 한다. None/생략이면 라벨 제약 없이(서버 기본) 분석.
    labels: list[str] | None = Field(
        default=None, examples=[["slot_2", "slot_1", "slot_3"]]
    )


class VlmPromptRequest(BaseModel):
    """POST /vlm/prompt — 신규 CCTV 모달의 자유 프롬프트 질의.

    ``path`` 를 생략하면 ``camera_id`` 의 DB frame_dir → 설정 기본값 순으로 해석한다.
    """

    camera_id: str = Field(default="CAM-2", examples=["CAM-2"])
    path: str | None = Field(default=None, examples=["/home/ds/Desktop/frames/cam2"])
    prompt: str = Field(min_length=1, examples=["현재 장면에서 위험 요소를 설명해줘"])


class TtsDispatch(BaseModel):
    """Status of the TTS (Piper/Edge -> speaker) branch."""

    status: str = Field(description="synthesized / stubbed / skipped / failed")
    text: str = Field(description="음성 변환된 텍스트")
    voice: str
    audio_path: str | None = Field(default=None, description="생성된 오디오 파일 경로")
    detail: str | None = None


class VlmPromptResponse(BaseModel):
    """VLM /prompt 응답(정규화). ``text`` 가 키오스크 자막 큐로 들어간다."""

    camera_id: str
    path: str = Field(description="실제 VLM 서버로 전달된 프레임 폴더 경로")
    prompt: str
    ok: bool = Field(description="VLM 서버 호출 성공 여부")
    text: str = Field(default="", description="VLM 답변 텍스트(자막 표시용)")
    detail: str | None = Field(default=None, description="실패 시 원인")
    tts: TtsDispatch = Field(description="답변을 읽어준 음성 합성/재생 결과")


class BehaviorDelta(BaseModel):
    """Result of parsing one detected behavior into a category + DB increment."""

    id: str = Field(examples=["slot_1"])
    name: str = Field(examples=["감시항목 1"])
    grade: str = Field(examples=["위험"])
    matched_label: str = Field(description="이 카테고리에 매칭된 원본 탐지 라벨")
    increment: int = Field(description="이번 추론으로 더해진 횟수", examples=[1])
    count: int = Field(description="반영 후 누적 횟수", examples=[3])


class WarningLightSignal(BaseModel):
    """Control signal generated for the 경광등 from the cumulative count."""

    state: str = Field(description="off / green / yellow_blink / red_blink / sequence")
    label: str = Field(description="한글 제어 신호", examples=["노란색 깜빡임 (주의)"])
    trigger_count: int = Field(description="신호 산정에 사용된 누적 카운트")
    interest_threshold: int = Field(description="관심(초록) 임계값", examples=[3])
    caution_threshold: int = Field(description="주의(노랑) 임계값", examples=[6])
    warning_threshold: int = Field(description="경고(빨강) 임계값", examples=[9])
    danger_threshold: int = Field(description="위험(순차) 임계값", examples=[12])
    dispatched: bool = Field(description="경광등(stub)으로 신호 전송 여부")
    led: dict | None = Field(
        default=None, description="실물 LED 자동 점등 결과 {level, status}"
    )


class VlmInferResponse(BaseModel):
    """Combined result returned to the kiosk."""

    camera_id: str
    process_code: str | None = None
    source: str = Field(description="vlm / mock — 응답 출처")

    detection: str = Field(description="감지된 행동 라벨 요약", examples=["안전모 미착용, 사다리 단독 이용"])
    detection_labels: list[str] = Field(description="감지된 행동 라벨 목록")
    scene_description: str = Field(default="", description="VLM 장면 설명 원문(vlm_description)")
    warning_text: str = Field(examples=["안전모를 착용하고 단독 사다리 작업을 중지하세요"])

    behaviors: list[BehaviorDelta] = Field(description="파싱 & DB 반영 결과")
    warning_light: WarningLightSignal
    tts: TtsDispatch
