"""Client for the external VLM Server's ``/analyze`` endpoint (PORT 8000).

IMPORTANT: this is only a *client*. The VLM itself (Qwen2.5-VL on the Jetson
Thor) is NOT implemented here. When the real server is offline — or when
``KIOSK_VLM_FORCE_MOCK`` is set — we fall back to a deterministic stub so the
kiosk's /vlm/infer pipeline always works in local dev.

The server runs a VLM→LLM 2-stage pipeline and returns structured JSON::

    {
      "request_id": "a1b2c3d4",
      "action": "hat_action,ladder_action",   # comma-separated detected keys
      "tts_message": "안전모를 착용하고 사다리 작업을 중단하십시오",
      "vlm_description": "...장면 설명 원문...",
      "elapsed_sec": 3.456
    }

``action`` keys map 1:1 to the kiosk's unsafe-behavior categories via
``VLM_ACTION_KEY_MAP`` (see app/domain/constants.py), so no fragile keyword
matching on free text is needed.
"""

from __future__ import annotations

import random

import httpx
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import VLM_ACTION_KEY_MAP, VLM_DETECT_ACTIONS

logger = get_logger(__name__)

# Response keys exactly as the VLM Server's /analyze emits them.
KEY_ACTION = "action"
KEY_TTS = "tts_message"
KEY_DESCRIPTION = "vlm_description"


class VlmResult(BaseModel):
    """Normalized VLM result consumed by the pipeline."""

    action_keys: list[str] = Field(
        default_factory=list, description="감지된 action 키 (예: hat_action)"
    )
    detection: str = Field(default="", description="감지 라벨을 합친 요약 텍스트")
    warning_text: str = Field(default="", description="TTS 경고 메시지(tts_message)")
    scene_description: str = Field(default="", description="VLM 장면 설명 원문")
    source: str = Field(default="vlm", description="vlm / mock")
    raw: dict = Field(default_factory=dict)


# 오프라인 개발용 스텁 시나리오 (action 키 기반).
_MOCK_SCENES: list[dict] = [
    {
        KEY_ACTION: "hat_action,ladder_action",
        KEY_TTS: "안전모를 착용하지 않은 상태로 단독 사다리 작업을 하고 있어 위험합니다. 안전모를 착용하고 사다리 작업을 중단하십시오",
        KEY_DESCRIPTION: "작업자가 안전모 없이 사다리에 단독으로 올라가 있습니다.",
    },
    {
        KEY_ACTION: "touch_action,hat_action",
        KEY_TTS: "안전모 미착용 상태로 설비(스피커)를 만지고 있어 위험합니다. 설비에서 손을 떼고 안전모를 착용하십시오",
        KEY_DESCRIPTION: "작업자가 가동 중인 설비에 손을 대고 있으며 안전모를 쓰지 않았습니다.",
    },
    {
        KEY_ACTION: "dangerInOut_action",
        KEY_TTS: "금지 구역에 출입하고 있어 위험합니다. 통제구역 출입을 중단하십시오",
        KEY_DESCRIPTION: "작업자가 통제선을 넘어 금지 구역으로 진입하고 있습니다.",
    },
    {
        KEY_ACTION: "",
        KEY_TTS: "",
        KEY_DESCRIPTION: "작업자가 보호구를 착용하고 정상적으로 작업하고 있습니다.",
    },
]


class VlmClient:
    """Async HTTP client + offline mock for the VLM Server's /analyze."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.vlm_analyze_url
        self._frame_dir = settings.vlm_frame_dir
        self._timeout = settings.vlm_timeout_seconds
        self._force_mock = settings.vlm_force_mock

    async def analyze(
        self,
        dir_path: str | None = None,
        focus: str | None = None,
        detect_actions: list[dict[str, str]] | None = None,
    ) -> VlmResult:
        """Call the VLM Server's /analyze; on any failure, return a stub result.

        ``dir_path`` is a directory on the *Jetson* filesystem holding 15~30
        frames. When omitted, the configured ``vlm_frame_dir`` is used.
        ``focus`` is an optional natural-language hint (체크된 감시 대상 라벨)
        appended to the VLM prompt. ``detect_actions`` narrows detection to the
        selected behaviors; when omitted, all 4 categories are used.
        """
        if self._force_mock:
            logger.info("VLM forced mock mode; skipping network call.")
            return self._mock_result()

        payload: dict = {
            "dir_path": dir_path or self._frame_dir,
            "detect_actions": detect_actions or VLM_DETECT_ACTIONS,
        }
        if focus:
            payload["focus"] = focus
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._url, json=payload)
                resp.raise_for_status()
                data = resp.json()
            return self._normalize(data, source="vlm")
        except Exception as exc:  # noqa: BLE001 — any error -> graceful fallback
            logger.warning(
                "VLM Server unreachable/failed at %s (%s); using offline mock.",
                self._url,
                exc.__class__.__name__,
            )
            return self._mock_result()

    @staticmethod
    def _parse_action_keys(action: str) -> list[str]:
        """Split the comma-separated ``action`` string into known keys."""
        keys: list[str] = []
        for part in (action or "").replace("、", ",").split(","):
            key = part.strip()
            if key and key in VLM_ACTION_KEY_MAP and key not in keys:
                keys.append(key)
        return keys

    @classmethod
    def _normalize(cls, data: dict, source: str) -> VlmResult:
        if not isinstance(data, dict):
            data = {}
        action_keys = cls._parse_action_keys(str(data.get(KEY_ACTION, "")))
        # detection 요약 = 감지된 카테고리 한글 이름들을 합친 것.
        from app.domain.constants import CATEGORY_BY_ID  # 지역 import (순환 방지)

        labels = [CATEGORY_BY_ID[VLM_ACTION_KEY_MAP[k]].name for k in action_keys]
        return VlmResult(
            action_keys=action_keys,
            detection=", ".join(labels),
            warning_text=str(data.get(KEY_TTS, "")).strip(),
            scene_description=str(data.get(KEY_DESCRIPTION, "")).strip(),
            source=source,
            raw=data,
        )

    def _mock_result(self) -> VlmResult:
        scene = random.choice(_MOCK_SCENES)
        return self._normalize(scene, source="mock")
