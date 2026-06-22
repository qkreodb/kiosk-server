"""Physical-output actuators behind a clean interface — all stubbed.

Two outputs from the /vlm/infer pipeline land here:
  * Speaker (스피커)       — plays the TTS audio produced by the TTS branch.
  * Warning light (경광등) — receives the generated control signal.

Real deployments would drive audio playback and a GPIO/relay/serial device.
Here both are stubbed (log only) so the server runs headless. Swap these
implementations for real device I/O without touching services/routers.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.domain.constants import WarningLightState

logger = get_logger(__name__)


class SpeakerActuator:
    """Outputs synthesized audio to the speaker (stubbed)."""

    def play(self, audio_path: str | None, text: str) -> bool:
        if audio_path:
            logger.info("[SPEAKER] play audio file: %s ('%s')", audio_path, text)
        else:
            logger.info("[SPEAKER] (stub) announce: '%s'", text)
        # Real impl: dispatch to an audio backend. Always "succeeds" in stub.
        return True


class WarningLightActuator:
    """Sends the control signal to the warning light / beacon (stubbed)."""

    def dispatch(self, state: WarningLightState, label: str, count: int) -> bool:
        logger.info(
            "[경광등] control signal -> state=%s label='%s' (count=%d)",
            state.value, label, count,
        )
        # Real impl: GPIO/relay/serial write. Always "succeeds" in stub.
        return True
