"""Client for the external VLM Server's ``/analyze`` endpoint (PORT 8000).

IMPORTANT: this is only a *client*. The VLM itself (Qwen2.5-VL on the Jetson
Thor) is NOT implemented here. When the real server is offline — or when
``KIOSK_VLM_FORCE_MOCK`` is set — we fall back to a deterministic stub so the
kiosk's /vlm/infer pipeline always works in local dev.

Request body::

    {"dir_path": "/path/to/frames"}

Response (current VLM Server schema)::

    {
      "request_id": "string",
      "detected": true,
      "labels": ["cone_touch", "fence_crossing"],
      "tts_message": "string",
      "raw": "{\"cone_touch\": \"true\", \"helmet_off\": \"true\", ...}",
      "elapsed_sec": 0
    }

탐지 키는 ``labels`` (키 리스트) 에서 읽는다. 구버전 호환을 위해 ``action``
(쉼표 구분 문자열) 과 ``raw`` (키→"true"/"false" 문자열 dict) 도 폴백으로
지원한다. 이 키들은 ``VLM_ACTION_KEY_MAP`` 으로 키오스크의 불안전행동
카테고리에 1:1 매핑된다(see app/domain/constants.py).
Used fields: ``labels``/``action``/``raw`` (count +1), ``tts_message`` (TTS 알림).
"""

from __future__ import annotations

import json
import random

import httpx
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import VLM_ACTION_KEY_MAP

logger = get_logger(__name__)

# Response keys exactly as the VLM Server's /analyze emits them.
KEY_ACTION = "action"        # 레거시: 쉼표 구분 문자열
KEY_LABELS = "labels"        # 현행: 탐지 키 리스트
KEY_RAW = "raw"              # 폴백: 키→"true"/"false" (dict 또는 JSON 문자열)
KEY_TTS = "tts_message"
KEY_DESCRIPTION = "description"


class VlmResult(BaseModel):
    """Normalized VLM result consumed by the pipeline."""

    action_keys: list[str] = Field(
        default_factory=list, description="감지된 action 키 (예: helmet_off)"
    )
    detection: str = Field(default="", description="감지 라벨을 합친 요약 텍스트")
    warning_text: str = Field(default="", description="TTS 경고 메시지(tts_message)")
    scene_description: str = Field(default="", description="VLM 장면 설명 원문")
    source: str = Field(default="vlm", description="vlm / mock")
    raw: dict = Field(default_factory=dict)


# 오프라인 개발용 스텁 시나리오 (action 키 기반).
_MOCK_SCENES: list[dict] = [
    {
        KEY_ACTION: "helmet_off,ladder_alone",
        KEY_TTS: "안전모를 착용하지 않은 상태로 단독 사다리 작업을 하고 있어 위험합니다. 안전모를 착용하고 사다리 작업을 중단하십시오",
        KEY_DESCRIPTION: "작업자가 안전모 없이 사다리에 단독으로 올라가 있습니다.",
    },
    {
        KEY_ACTION: "cone_touch,helmet_off",
        KEY_TTS: "안전모 미착용 상태로 라바콘을 접촉하고 있어 위험합니다. 라바콘에서 떨어지고 안전모를 착용하십시오",
        KEY_DESCRIPTION: "작업자가 통제용 라바콘에 손을 대고 있으며 안전모를 쓰지 않았습니다.",
    },
    {
        KEY_ACTION: "fence_crossing,safety_vest",
        KEY_TTS: "안전 고리 미착용 상태로 위험 펜스를 넘고 있어 위험합니다. 즉시 펜스를 넘지 말고 안전 고리를 체결하십시오",
        KEY_DESCRIPTION: "작업자가 안전 고리를 걸지 않은 채 위험 구역의 펜스를 넘고 있습니다.",
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
    ) -> VlmResult:
        """Call the VLM Server's /analyze; on any failure, return a stub result.

        ``dir_path`` is a directory on the *Jetson* filesystem holding frames.
        When omitted, the configured ``vlm_frame_dir`` is used.
        """
        if self._force_mock:
            logger.info("VLM forced mock mode; skipping network call.")
            return self._mock_result()

        payload: dict = {"dir_path": dir_path or self._frame_dir}
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
    def _dedupe_known(parts: list[str]) -> list[str]:
        """Keep only known action keys, in order, without duplicates."""
        keys: list[str] = []
        for part in parts:
            key = str(part).strip()
            if key and key in VLM_ACTION_KEY_MAP and key not in keys:
                keys.append(key)
        return keys

    @staticmethod
    def _truthy_keys_from_raw(raw: object) -> list[str]:
        """``raw`` dict(또는 JSON 문자열)에서 값이 truthy 인 키만 추출."""
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (ValueError, TypeError):
                return []
        if not isinstance(raw, dict):
            return []
        out: list[str] = []
        for key, val in raw.items():
            truthy = val.strip().lower() == "true" if isinstance(val, str) else bool(val)
            if truthy:
                out.append(key)
        return out

    @classmethod
    def _extract_action_keys(cls, data: dict) -> list[str]:
        """탐지 키 추출: labels(현행) → action(레거시) → raw(폴백) 순.

        ``labels``(또는 레거시 ``action``)가 응답에 존재하면 그것이 정답이다.
        값이 비어 있으면 "탐지 없음"을 의미하므로 raw 폴백으로 넘어가지 않는다
        (raw 에 safety_vest 처럼 위반이 아닌 키가 true 로 남아 오탐되는 것 방지).
        raw 폴백은 labels·action 키가 아예 없는 응답에서만 사용한다.
        """
        if isinstance(data.get(KEY_LABELS), list):
            return cls._dedupe_known(data[KEY_LABELS])
        if data.get(KEY_ACTION) is not None:
            return cls._dedupe_known(str(data[KEY_ACTION]).replace("、", ",").split(","))
        return cls._dedupe_known(cls._truthy_keys_from_raw(data.get(KEY_RAW)))

    @classmethod
    def _normalize(cls, data: dict, source: str) -> VlmResult:
        if not isinstance(data, dict):
            data = {}
        action_keys = cls._extract_action_keys(data)
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
