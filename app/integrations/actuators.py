"""Physical-output actuators behind a clean interface — all stubbed.

Two outputs from the /vlm/infer pipeline land here:
  * Speaker (스피커)       — plays the TTS audio produced by the TTS branch.
  * Warning light (경광등) — receives the generated control signal.

Real deployments would drive audio playback and a GPIO/relay/serial device.
Here both are stubbed (log only) so the server runs headless. Swap these
implementations for real device I/O without touching services/routers.
"""

from __future__ import annotations

import threading

from app.core.logging import get_logger
from app.domain.constants import WarningLightState

logger = get_logger(__name__)


class SpeakerActuator:
    """Outputs synthesized audio to the speaker via playsound."""

    def play(self, audio_path: str | None, text: str) -> bool:
        """Play audio, blocking until playback finishes.

        주의: blocking 호출이므로 async 요청 핸들러(예: /vlm/infer)에서 직접 호출하면
        오디오 재생 시간만큼 이벤트 루프가 멈춘다. 요청 경로에서는 ``play_async`` 사용.
        """
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

    def play_async(self, audio_path: str | None, text: str) -> None:
        """Fire-and-forget 실시간 재생: 백그라운드 데몬 스레드에서 ``play`` 실행.

        호출 즉시 반환하므로 요청 핸들러/이벤트 루프를 막지 않고, 오디오는 실시간으로
        재생된다(헤드리스 환경 운영 정책: 실시간 재생).
        """
        if not audio_path:
            logger.warning("[SPEAKER] no audio file; cannot play: '%s'", text)
            return
        threading.Thread(
            target=self.play, args=(audio_path, text), daemon=True
        ).start()


class WarningLightActuator:
    """Sends the control signal to the warning light / beacon (stubbed)."""

    def dispatch(self, state: WarningLightState, label: str, count: int) -> bool:
        logger.info(
            "[경광등] control signal -> state=%s label='%s' (count=%d)",
            state.value, label, count,
        )
        # Real impl: GPIO/relay/serial write. Always "succeeds" in stub.
        return True
