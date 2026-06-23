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
    """Outputs synthesized audio to the speaker via playsound (blocking)."""

    def play(self, audio_path: str | None, text: str) -> bool:
        if not audio_path:
            logger.warning("[SPEAKER] no audio file; cannot play: '%s'", text)
            return False
        try:
            from playsound import playsound  # noqa: PLC0415
            logger.info("[SPEAKER] playing: %s ('%s')", audio_path, text)
            playsound(audio_path)  # blocking — waits until playback finishes
            logger.info("[SPEAKER] playback complete.")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("[SPEAKER] playback failed (%s): %s", exc.__class__.__name__, exc)
            return False


class WarningLightActuator:
    """Sends the control signal to the warning light / beacon (stubbed)."""

    def dispatch(self, state: WarningLightState, label: str, count: int) -> bool:
        logger.info(
            "[경광등] control signal -> state=%s label='%s' (count=%d)",
            state.value, label, count,
        )
        # Real impl: GPIO/relay/serial write. Always "succeeds" in stub.
        return True
