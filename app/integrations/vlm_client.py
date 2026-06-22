"""Client for the external VLM Server's ``/infer`` endpoint (PORT 8000).

IMPORTANT: this is only a *client*. The VLM itself (Qwen2.5 VLM/LLM on the
Jetson Thor) is NOT implemented here. When the real server is offline — or when
``KIOSK_VLM_FORCE_MOCK`` is set — we fall back to a deterministic stub so the
kiosk's /vlm/infer pipeline always works in local dev.

The VLM returns a flat JSON of key:value, conceptually::

    {
      "탐지": "안전모 미착용, 단독 사다리 작업",
      "위험 경고 텍스트": "안전모를 착용하고 단독 사다리 작업을 중지하세요"
    }
"""

from __future__ import annotations

import random

import httpx
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Korean keys exactly as the VLM Server emits them.
KEY_DETECTION = "탐지"
KEY_WARNING = "위험 경고 텍스트"


class VlmResult(BaseModel):
    """Normalized VLM result consumed by the pipeline."""

    detection: str = Field(default="")
    warning_text: str = Field(default="")
    source: str = Field(default="vlm", description="vlm / mock")
    raw: dict = Field(default_factory=dict)


# A small bank of realistic stub scenes for offline dev.
_MOCK_SCENES: list[dict[str, str]] = [
    {
        KEY_DETECTION: "안전모 미착용, 단독 사다리 작업",
        KEY_WARNING: "안전모를 착용하고 단독 사다리 작업을 중지하세요",
    },
    {
        KEY_DETECTION: "설비 임의 조작, 안전모 미착용",
        KEY_WARNING: "설비에서 손을 떼고 안전모를 착용하세요",
    },
    {
        KEY_DETECTION: "위험지역 무단횡단",
        KEY_WARNING: "통제구역 출입을 중지하고 우회 통로를 이용하세요",
    },
    {
        KEY_DETECTION: "사다리 단독작업, 보안경 미착용",
        KEY_WARNING: "사다리 작업 시 보조자를 배치하고 보안경을 착용하세요",
    },
]


class VlmClient:
    """Async HTTP client + offline mock for the VLM Server."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.vlm_infer_url
        self._timeout = settings.vlm_timeout_seconds
        self._force_mock = settings.vlm_force_mock

    async def infer(
        self,
        camera_id: str,
        process_code: str | None = None,
        frame_ref: str | None = None,
    ) -> VlmResult:
        """Call the VLM Server; on any failure, return a stub result."""
        if self._force_mock:
            logger.info("VLM forced mock mode; skipping network call.")
            return self._mock_result()

        payload = {
            "camera_id": camera_id,
            "process_code": process_code,
            "frame_ref": frame_ref,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._url, json=payload)
                resp.raise_for_status()
                data = resp.json()
            return self._normalize(data, source="vlm")
        except Exception as exc:  # noqa: BLE001 — any error -> graceful fallback
            logger.warning(
                "VLM Server unreachable at %s (%s); using offline mock.",
                self._url,
                exc.__class__.__name__,
            )
            return self._mock_result()

    @staticmethod
    def _normalize(data: dict, source: str) -> VlmResult:
        return VlmResult(
            detection=str(data.get(KEY_DETECTION, "")).strip(),
            warning_text=str(data.get(KEY_WARNING, "")).strip(),
            source=source,
            raw=data if isinstance(data, dict) else {},
        )

    def _mock_result(self) -> VlmResult:
        scene = random.choice(_MOCK_SCENES)
        return self._normalize(scene, source="mock")
