"""Edge TTS wrapper — the "TTS 텍스트 추출 → Edge TTS 음성 변환" branch.

Converts the VLM's "위험 경고 텍스트" to speech audio. The actual playback to a
physical speaker is the actuator's job (see :mod:`app.integrations.actuators`);
this module only produces the audio bytes/file. Runs headless: if ``edge-tts``
is unavailable or synthesis fails, it degrades to a stub so the pipeline never
breaks.
"""

from __future__ import annotations

import time
from pathlib import Path

from pydantic import BaseModel

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class TtsResult(BaseModel):
    status: str          # synthesized / stubbed / skipped / failed
    text: str
    voice: str
    audio_path: str | None = None
    detail: str | None = None


class TtsService:
    """Synthesize Korean speech from text via Edge TTS."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.tts_enabled
        self._voice = settings.tts_voice
        self._out_dir = settings.tts_output_dir

    async def synthesize(self, text: str) -> TtsResult:
        text = (text or "").strip()
        if not text:
            return TtsResult(status="skipped", text="", voice=self._voice,
                             detail="빈 경고 텍스트")

        if not self._enabled:
            return TtsResult(status="stubbed", text=text, voice=self._voice,
                             detail="TTS 비활성화 (KIOSK_TTS_ENABLED=false)")

        try:
            import edge_tts  # imported lazily so the dep is optional at runtime
        except ImportError:
            logger.warning("edge-tts not installed; TTS stubbed.")
            return TtsResult(status="stubbed", text=text, voice=self._voice,
                             detail="edge-tts 미설치")

        try:
            self._out_dir.mkdir(parents=True, exist_ok=True)
            out_path = self._out_dir / f"warning_{int(time.time() * 1000)}.mp3"
            communicate = edge_tts.Communicate(text, self._voice)
            await communicate.save(str(out_path))
            logger.info("TTS synthesized -> %s", out_path)
            return TtsResult(status="synthesized", text=text, voice=self._voice,
                             audio_path=str(out_path))
        except Exception as exc:  # noqa: BLE001 — network/codec/etc.
            logger.warning("TTS synthesis failed (%s); stubbing.", exc.__class__.__name__)
            return TtsResult(status="failed", text=text, voice=self._voice,
                             detail=f"{exc.__class__.__name__}: {exc}")
