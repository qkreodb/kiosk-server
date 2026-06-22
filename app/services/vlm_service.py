"""Orchestrates the full POST /vlm/infer pipeline (right side of 001.png).

Flow:
  1. Call the external VLM Server (client + offline mock fallback).
  2. BRANCH A — TTS: "위험 경고 텍스트" -> Edge TTS -> speaker (actuator).
  3. BRANCH B — DB:  "탐지" -> parse into unsafe-behavior categories ->
     increment counts in the (mocked) DB -> read resulting count ->
     generate a warning-light control signal from configurable thresholds ->
     dispatch to the warning light (actuator).
  4. Combine everything into one response DTO.
"""

from __future__ import annotations

import re

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import (
    BEHAVIOR_CATEGORIES,
    CATEGORY_BY_ID,
    WARNING_LIGHT_LABEL,
    UnsafeBehavior,
    WarningLightState,
)
from app.integrations.actuators import SpeakerActuator, WarningLightActuator
from app.integrations.tts import TtsService
from app.integrations.vlm_client import VlmClient
from app.repositories.base import KioskRepository
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


def match_categories(labels: list[str]) -> list[tuple[UnsafeBehavior, str]]:
    """Map each label to an unsafe-behavior category via keyword matching.

    Returns a list of (category_id, matched_label). A label that matches no
    category is ignored (logged). Each category counts at most once per call.
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
    ) -> None:
        self._repo = repo
        self._vlm = vlm_client
        self._tts = tts
        self._speaker = speaker
        self._light = warning_light
        self._settings = settings

    def _warning_light_state(self, count: int) -> WarningLightState:
        if count >= self._settings.light_danger_threshold:
            return WarningLightState.RED_BLINK
        if count >= self._settings.light_caution_threshold:
            return WarningLightState.YELLOW_BLINK
        if count >= 1:
            return WarningLightState.GREEN
        return WarningLightState.OFF

    async def infer(
        self,
        camera_id: str,
        process_code: str | None = None,
        frame_ref: str | None = None,
    ) -> VlmInferResponse:
        code = process_code or "PRC-19"

        # 1) Call the VLM Server (or offline mock).
        vlm = await self._vlm.infer(camera_id, code, frame_ref)
        labels = split_detection(vlm.detection)

        # 2) BRANCH A — TTS -> speaker.
        tts_result = await self._tts.synthesize(vlm.warning_text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play(tts_result.audio_path, tts_result.text)
        tts = TtsDispatch(**tts_result.model_dump())

        # 3) BRANCH B — parse & DB-increment, then read resulting counts.
        matches = match_categories(labels)
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

        # Warning-light control signal from the highest resulting count this round.
        trigger_count = max((d.count for d in deltas), default=0)
        state = self._warning_light_state(trigger_count)
        label = WARNING_LIGHT_LABEL[state]
        dispatched = False
        if state is not WarningLightState.OFF:
            dispatched = self._light.dispatch(state, label, trigger_count)

        warning_light = WarningLightSignal(
            state=state.value,
            label=label,
            trigger_count=trigger_count,
            caution_threshold=self._settings.light_caution_threshold,
            danger_threshold=self._settings.light_danger_threshold,
            dispatched=dispatched,
        )

        # 4) Combine.
        return VlmInferResponse(
            camera_id=camera_id,
            process_code=code,
            source=vlm.source,
            detection=vlm.detection,
            detection_labels=labels,
            warning_text=vlm.warning_text,
            behaviors=deltas,
            warning_light=warning_light,
            tts=tts,
        )
