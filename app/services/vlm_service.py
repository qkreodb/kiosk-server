"""Orchestrates the full POST /vlm/infer pipeline (right side of 001.png).

Flow:
  1. Call the external VLM Server's /analyze (client + offline mock fallback).
  2. ``action``/``labels`` 키 -> 불안전행동 카테고리로 매핑(탐지 여부 판단).
  3. BRANCH A — TTS: 탐지된 행동이 있을 때만 ``tts_message`` -> Edge TTS -> speaker.
     이상 없음(탐지 0건)이면 음성 안내를 울리지 않는다(시연 시 음성 겹침 방지).
  4. BRANCH B — DB:  매핑된 카테고리의 카운트를 증가 -> 결과 카운트 조회 ->
     임계값 기반 경광등 제어 신호 생성 -> 경광등(actuator)으로 전송.
  5. Combine everything into one response DTO.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import (
    BEHAVIOR_CATEGORIES,
    CATEGORY_BY_ID,
    VLM_ACTION_KEY_MAP,
    WARNING_LIGHT_LABEL,
    WARNING_STATE_TO_LED_LEVEL,
    UnsafeBehavior,
    WarningLightState,
)
from app.integrations.actuators import SpeakerActuator, WarningLightActuator
from app.integrations.tts import TtsService
from app.integrations.vlm_client import VlmClient
from app.repositories.base import KioskRepository
from app.services.led_service import LedService
from app.schemas.vlm import (
    BehaviorDelta,
    TtsDispatch,
    VlmInferResponse,
    WarningLightSignal,
)

logger = get_logger(__name__)

# Detection labels are comma / 、/ semicolon separated.
_SPLIT_RE = re.compile(r"[,、;/]+")


def split_detection(detection: str) -> list[str]:
    """Split raw 탐지 text into discrete labels."""
    return [p.strip() for p in _SPLIT_RE.split(detection or "") if p.strip()]


def categories_from_action_keys(
    action_keys: list[str],
) -> list[tuple[UnsafeBehavior, str]]:
    """Map VLM /analyze ``action`` keys directly to categories.

    Returns (category_id, matched_label) pairs. ``matched_label`` is the
    category's Korean name. Each category counts at most once per call.
    """
    matched: list[tuple[UnsafeBehavior, str]] = []
    seen: set[UnsafeBehavior] = set()
    for key in action_keys:
        cat_id = VLM_ACTION_KEY_MAP.get(key)
        if cat_id is None or cat_id in seen:
            continue
        matched.append((cat_id, CATEGORY_BY_ID[cat_id].name))
        seen.add(cat_id)
    return matched


def match_categories(labels: list[str]) -> list[tuple[UnsafeBehavior, str]]:
    """Fallback: map free-text labels to categories via keyword matching.

    Used only when the VLM returns no structured ``action`` keys (e.g. legacy
    /infer text or an unexpected response). Returns (category_id, matched_label)
    pairs; an unmatched label is ignored (logged). Each category counts once.
    """
    matched: list[tuple[UnsafeBehavior, str]] = []
    seen: set[UnsafeBehavior] = set()
    for label in labels:
        low = label.lower()
        for cat in BEHAVIOR_CATEGORIES:
            if cat.id in seen:
                continue
            if any(kw.lower() in low for kw in cat.keywords):
                matched.append((cat.id, label))
                seen.add(cat.id)
                break
        else:
            logger.info("No behavior category matched label: %r", label)
    return matched


class VlmService:
    def __init__(
        self,
        repo: KioskRepository,
        vlm_client: VlmClient,
        tts: TtsService,
        speaker: SpeakerActuator,
        warning_light: WarningLightActuator,
        settings: Settings,
        led: LedService | None = None,
    ) -> None:
        self._repo = repo
        self._vlm = vlm_client
        self._tts = tts
        self._speaker = speaker
        self._light = warning_light
        self._settings = settings
        self._led = led

    def _warning_light_state(self, count: int) -> WarningLightState:
        """누적 카운트 → 경광등 단계 (임계값 3/6/9/12)."""
        if count >= self._settings.light_danger_threshold:    # 12+ 위험
            return WarningLightState.SEQUENCE
        if count >= self._settings.light_warning_threshold:   # 9~11 경고
            return WarningLightState.RED_BLINK
        if count >= self._settings.light_caution_threshold:   # 6~8 주의
            return WarningLightState.YELLOW_BLINK
        if count >= self._settings.light_interest_threshold:  # 3~5 관심
            return WarningLightState.GREEN
        return WarningLightState.OFF                          # 0~2 소등

    def _trigger_led(self, state: WarningLightState) -> dict | None:
        """경광등 상태에 맞춰 실물 LED(led_service)를 점등. 실패해도 분석은 계속.

        OFF 는 점등하지 않는다(진행 중인 신호를 끊지 않기 위해 소등도 보내지 않음).
        LED가 이미 동작 중(409)이거나 장치 문제(503)면 분석 응답을 깨지 않고 상태만 기록.
        """
        if self._led is None:
            return None
        level = WARNING_STATE_TO_LED_LEVEL.get(state)
        if level is None:
            return None
        try:
            res = self._led.trigger(level)
            return {"level": level, "status": res.get("status")}
        except HTTPException as exc:
            logger.info("[LED] 자동 점등 보류(level=%s): %s", level, exc.detail)
            return {"level": level, "status": "skipped", "detail": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[LED] 자동 점등 실패(level=%s): %s", level, exc)
            return {"level": level, "status": "error", "detail": str(exc)}

    async def infer(
        self,
        camera_id: str,
        process_code: str | None = None,
        frame_ref: str | None = None,
        frame_dir: str | None = None,
    ) -> VlmInferResponse:
        code = process_code or "PRC-19"

        # 재생 세대값을 분석 시작 시점에 캡처 — 분석 중 flush_tts()(예: CCTV 모달 종료)가
        # 호출되면 이 요청의 늦은 TTS 재생은 폐기된다.
        play_epoch = self._speaker.current_epoch()

        # 1) Call the VLM Server's /analyze (or offline mock).
        vlm = await self._vlm.analyze(frame_dir)

        # 2) 탐지된 불안전행동 매핑 (TTS 발동 여부 판단에도 사용).
        #    구조화된 action 키가 있으면 직접 매핑, 없으면 자유텍스트 키워드 폴백.
        if vlm.action_keys:
            matches = categories_from_action_keys(vlm.action_keys)
        else:
            matches = match_categories(split_detection(vlm.detection))
        detected = bool(matches)

        # 3) BRANCH A — TTS -> speaker.
        #    이상 없음(탐지된 행동 없음)이면 음성 안내를 울리지 않는다 — 시연 시
        #    안전 상황에도 안내가 나와 음성이 겹치는 문제를 방지.
        #    재생은 백그라운드 스레드(fire-and-forget)로 — 오디오 재생 시간 동안
        #    /vlm/infer 응답과 이벤트 루프가 막히지 않도록 한다(실시간 재생 유지).
        tts_text = vlm.warning_text if detected else ""
        tts_result = await self._tts.synthesize(tts_text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play_async(tts_result.audio_path, tts_result.text, epoch=play_epoch)
        tts = TtsDispatch(**tts_result.model_dump())

        # 4) BRANCH B — DB-increment per detected behavior, read resulting counts.
        labels = [label for _, label in matches]
        deltas: list[BehaviorDelta] = []
        for cat_id, matched_label in matches:
            new_count = self._repo.increment_behavior(code, cat_id.value, 1)
            cat = CATEGORY_BY_ID[cat_id]
            deltas.append(
                BehaviorDelta(
                    id=cat.id.value,
                    name=cat.name,
                    grade=cat.base_grade.value,
                    matched_label=matched_label,
                    increment=1,
                    count=new_count,
                )
            )

        # 경광등 발동 규칙:
        #  1) 안전 결과(이번 사이클 탐지 없음)면 카운트가 높아도 절대 울리지 않는다.
        #     트리거는 반드시 "이번 사이클에 VLM 탐지가 존재"할 때만 발동한다.
        #  2) 다중 탐지 우선순위: 한 번에 여러 행동이 탐지되면, 그중 카운트가 가장
        #     높은 항목의 단계를 경광등에 반영한다(예: A=5, B=15 → 15의 점멸).
        has_detection = bool(deltas)
        trigger_count = max((d.count for d in deltas), default=0)
        state = (
            self._warning_light_state(trigger_count)
            if has_detection
            else WarningLightState.OFF
        )
        label = WARNING_LIGHT_LABEL[state]
        dispatched = False
        led_dispatch: dict | None = None
        if has_detection and state is not WarningLightState.OFF:
            dispatched = self._light.dispatch(state, label, trigger_count)
            # 실물 경광등(LED) 자동 점등 — 실패해도 분석 응답은 유지.
            led_dispatch = self._trigger_led(state)

        warning_light = WarningLightSignal(
            state=state.value,
            label=label,
            trigger_count=trigger_count,
            interest_threshold=self._settings.light_interest_threshold,
            caution_threshold=self._settings.light_caution_threshold,
            warning_threshold=self._settings.light_warning_threshold,
            danger_threshold=self._settings.light_danger_threshold,
            dispatched=dispatched,
            led=led_dispatch,
        )

        # 5) Combine.
        return VlmInferResponse(
            camera_id=camera_id,
            process_code=code,
            source=vlm.source,
            detection=vlm.detection,
            detection_labels=labels,
            scene_description=vlm.scene_description,
            warning_text=vlm.warning_text,
            behaviors=deltas,
            warning_light=warning_light,
            tts=tts,
        )

    def flush_tts(self) -> None:
        """대기 중인 TTS를 폐기(현재 재생 중인 건 끝까지 재생). CCTV 모달 종료 시 호출."""
        self._speaker.flush()
