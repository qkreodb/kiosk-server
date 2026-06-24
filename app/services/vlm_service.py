"""Orchestrates the full POST /vlm/infer pipeline (right side of 001.png).

Flow:
  1. Call the external VLM Server's /analyze (client + offline mock fallback).
  2. BRANCH A — TTS: ``tts_message`` -> Edge TTS -> speaker (actuator).
  3. BRANCH B — DB:  ``action`` 키 -> 불안전행동 카테고리로 매핑 ->
     increment counts in the DB -> read resulting count ->
     generate a warning-light control signal from configurable thresholds ->
     dispatch to the warning light (actuator).
  4. Combine everything into one response DTO.
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
    VLM_DETECT_ACTIONS,
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

    @staticmethod
    def _resolve_focus(
        focus_keys: list[str] | None,
    ) -> tuple[str | None, list[dict[str, str]] | None]:
        """체크된 focus_keys → VLM /analyze 의 (focus 문자열, detect_actions).

        선택된 키에 해당하는 detect_actions 만 추려 감지를 그 행동들로 좁히고,
        focus 문자열은 라벨을 이어 붙여 프롬프트 강조용으로 보낸다.
        선택이 없으면 (None, None) → 클라이언트가 4대 행동 전체로 폴백.
        """
        if not focus_keys:
            return None, None
        keyset = set(focus_keys)
        selected = [a for a in VLM_DETECT_ACTIONS if a["key"] in keyset]
        if not selected:
            return None, None
        focus_str = ", ".join(a["label"] for a in selected)
        return focus_str, selected

    async def infer(
        self,
        camera_id: str,
        process_code: str | None = None,
        frame_ref: str | None = None,
        frame_dir: str | None = None,
        focus_keys: list[str] | None = None,
    ) -> VlmInferResponse:
        code = process_code or "PRC-19"

        # 1) Call the VLM Server's /analyze (or offline mock).
        #    체크된 감시 대상이 있으면 focus/detect_actions 로 좁혀 보낸다.
        focus_str, detect_actions = self._resolve_focus(focus_keys)
        vlm = await self._vlm.analyze(
            frame_dir, focus=focus_str, detect_actions=detect_actions
        )

        # 2) BRANCH A — TTS -> speaker.
        #    재생은 백그라운드 스레드(fire-and-forget)로 — 오디오 재생 시간 동안
        #    /vlm/infer 응답과 이벤트 루프가 막히지 않도록 한다(실시간 재생 유지).
        tts_result = await self._tts.synthesize(vlm.warning_text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play_async(tts_result.audio_path, tts_result.text)
        tts = TtsDispatch(**tts_result.model_dump())

        # 3) BRANCH B — map detected behaviors & DB-increment, read resulting counts.
        #    구조화된 action 키가 있으면 직접 매핑, 없으면 자유텍스트 키워드 폴백.
        if vlm.action_keys:
            matches = categories_from_action_keys(vlm.action_keys)
        else:
            matches = match_categories(split_detection(vlm.detection))
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

        # 경광등은 "조회 결과" 기준 — 이번 라운드 감지분이 아니라 4대 행동의
        # 누적 카운트 중 최대값을 사용한다. 그래야 다른 행동만 감지된 라운드에도
        # 단계가 유지되고, 초기화(reset) 전까지 떨어지지 않는다.
        all_counts = self._repo.get_behavior_counts(code)
        trigger_count = max(all_counts.values(), default=0) if all_counts else 0
        state = self._warning_light_state(trigger_count)
        label = WARNING_LIGHT_LABEL[state]
        dispatched = False
        led_dispatch: dict | None = None
        if state is not WarningLightState.OFF:
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

        # 4) Combine.
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
