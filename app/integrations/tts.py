"""TTS wrapper — VLM의 "위험 경고 텍스트"를 음성으로 합성한다.

합성 엔진은 두 가지를 지원한다(``KIOSK_TTS_ENGINE``):
  * ``piper`` — 오프라인 로컬 합성(폐쇄망 기본). `piper` 실행파일 + ko_KR 음성
    모델(.onnx)로 인터넷 없이 동작한다. VLM 이 매번 다른 문장을 줘도 로컬 합성.
  * ``edge``  — Edge TTS(MS Azure). 온라인 필요. 폐쇄망에선 실패 → 스텁.

실제 스피커 재생은 actuator 의 몫이고(:mod:`app.integrations.actuators`), 이 모듈은
오디오 파일만 만든다. Headless: 엔진/모델이 없거나 합성이 실패하면 스텁으로 강등해
파이프라인이 절대 끊기지 않는다.
"""

from __future__ import annotations

import asyncio
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
    """텍스트 → 한국어 음성 합성(Piper 오프라인 우선, Edge 폴백 선택)."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.tts_enabled
        self._engine = (settings.tts_engine or "piper").strip().lower()
        self._out_dir = settings.tts_output_dir
        # Edge 전용
        self._voice = settings.tts_voice
        # Piper 전용
        self._piper_binary = settings.piper_binary
        self._piper_model = Path(settings.piper_model_path)
        self._piper_config = (
            Path(settings.piper_config_path) if settings.piper_config_path else None
        )

    async def synthesize(self, text: str) -> TtsResult:
        text = (text or "").strip()
        if not text:
            return TtsResult(status="skipped", text="", voice=self._voice_label,
                             detail="빈 경고 텍스트")

        if not self._enabled:
            return TtsResult(status="stubbed", text=text, voice=self._voice_label,
                             detail="TTS 비활성화 (KIOSK_TTS_ENABLED=false)")

        if self._engine == "edge":
            return await self._synthesize_edge(text)
        return await self._synthesize_piper(text)

    @property
    def _voice_label(self) -> str:
        """결과에 표기할 보이스 이름(엔진별)."""
        return self._piper_model.name if self._engine == "piper" else self._voice

    # ---- Piper (오프라인) -------------------------------------------------
    async def _synthesize_piper(self, text: str) -> TtsResult:
        voice = self._voice_label
        if not self._piper_model.exists():
            logger.warning("Piper 음성 모델 없음(%s); TTS 스텁.", self._piper_model)
            return TtsResult(status="stubbed", text=text, voice=voice,
                             detail=f"Piper 모델 없음: {self._piper_model}")

        self._out_dir.mkdir(parents=True, exist_ok=True)
        out_path = self._out_dir / f"warning_{int(time.time() * 1000)}.wav"
        cmd = [self._piper_binary, "--model", str(self._piper_model),
               "--output_file", str(out_path)]
        if self._piper_config:
            cmd += ["--config", str(self._piper_config)]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate(text.encode("utf-8"))
        except FileNotFoundError:
            # `piper` 실행파일이 PATH 에 없음 → 설치 안내 후 스텁.
            logger.warning(
                "piper 실행파일을 찾을 수 없음(%s). `pip install piper-tts` 필요; TTS 스텁.",
                self._piper_binary,
            )
            return TtsResult(status="stubbed", text=text, voice=voice,
                             detail=f"piper 실행파일 없음: {self._piper_binary}")
        except Exception as exc:  # noqa: BLE001 — 어떤 실패든 파이프라인은 유지
            logger.warning("Piper 합성 실패(%s); 스텁.", exc.__class__.__name__)
            return TtsResult(status="failed", text=text, voice=voice,
                             detail=f"{exc.__class__.__name__}: {exc}")

        if proc.returncode != 0 or not out_path.exists():
            detail = (stderr or b"").decode("utf-8", "ignore").strip()[:200]
            logger.warning("Piper 합성 실패(rc=%s): %s", proc.returncode, detail)
            return TtsResult(status="failed", text=text, voice=voice,
                             detail=detail or f"piper rc={proc.returncode}")

        logger.info("TTS(piper) synthesized -> %s", out_path)
        return TtsResult(status="synthesized", text=text, voice=voice,
                         audio_path=str(out_path))

    # ---- Edge TTS (온라인) ------------------------------------------------
    async def _synthesize_edge(self, text: str) -> TtsResult:
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
            logger.info("TTS(edge) synthesized -> %s", out_path)
            return TtsResult(status="synthesized", text=text, voice=self._voice,
                             audio_path=str(out_path))
        except Exception as exc:  # noqa: BLE001 — network/codec/etc.
            logger.warning("TTS synthesis failed (%s); stubbing.", exc.__class__.__name__)
            return TtsResult(status="failed", text=text, voice=self._voice,
                             detail=f"{exc.__class__.__name__}: {exc}")
