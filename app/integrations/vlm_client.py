"""Client for the external VLM Server's ``/analyze`` endpoint (PORT 8000).

IMPORTANT: this is only a *client*. The VLM itself (Qwen2.5-VL on the Jetson
Thor) is NOT implemented here. If the server is unreachable or errors, we return
an empty result (no detection) so the kiosk pipeline keeps running without
raising a false alarm.

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
KEY_UNKNOWN_LABELS = "unknown_labels"
KEY_TTS = "tts_message"
KEY_DESCRIPTION = "description"
KEY_RULE_LABELS = "rule_labels"


class VlmResult(BaseModel):
    """Normalized VLM result consumed by the pipeline."""

    action_keys: list[str] = Field(
        default_factory=list, description="감지된 action 키 (예: helmet_off)"
    )
    unknown_action_keys: list[str] = Field(
        default_factory=list,
        description="판정 불가라 이번 사이클에서 상태를 갱신하지 않을 action 키",
    )
    detection: str = Field(default="", description="감지 라벨을 합친 요약 텍스트")
    warning_text: str = Field(default="", description="TTS 경고 메시지(tts_message)")
    scene_description: str = Field(default="", description="VLM 장면 설명 원문")
    source: str = Field(default="vlm", description="결과 출처")
    # 슬롯 키별 현재 RuleSpec 표시명
    rule_labels: dict[str, str] = Field(default_factory=dict)
    raw: dict = Field(default_factory=dict)


class VlmClient:
    """Async HTTP client for the VLM Server's /analyze."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.vlm_analyze_url
        self._prompt_url = settings.vlm_prompt_url
        self._rules_url = settings.vlm_rules_url
        self._frame_dir = settings.vlm_frame_dir
        self._timeout = settings.vlm_timeout_seconds

    async def analyze(
        self,
        dir_path: str | None = None,
        labels: list[str] | None = None,
        process_name: str | None = None,
    ) -> VlmResult:
        """Call the VLM Server's /analyze; on any failure, return an empty result.

        ``dir_path`` is a directory on the *Jetson* filesystem holding frames.
        When omitted, the configured ``vlm_frame_dir`` is used.
        ``labels``: 분석 대상으로 선택된 행동 키 목록(불안전행동 감시 신호등 체크).
        None이면 필드를 생략해 서버 기본값(전체 라벨)을 사용하고, 빈 목록이면
        명시적으로 분석 라벨 없음으로 보낸다.
        ``process_name``: 해당 카메라(CAM-1)의 공정명. VLM 서버가 위험 스냅샷 파일명
        (``공정_위반_시각.png``)에 사용한다. 값이 있으면 ``process_name`` 으로 함께 보낸다.
        """
        payload: dict = {"dir_path": dir_path or self._frame_dir}
        if labels is not None:
            payload["labels"] = labels
        if process_name:
            payload["process_name"] = process_name
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._url, json=payload)
                resp.raise_for_status()
                data = resp.json()
            return self._normalize(data, source="vlm")
        except Exception as exc:  # noqa: BLE001 — VLM 장애 시 무탐지로 처리(거짓경보 방지)
            logger.warning(
                "VLM Server unreachable/failed at %s (%s); 이번 사이클은 무탐지 처리.",
                self._url,
                exc.__class__.__name__,
            )
            return VlmResult(source="vlm")

    # 응답에서 답변 텍스트를 찾을 후보 키(우선순위 순). /prompt 응답 스키마가
    # 확정되지 않아 흔한 키들을 순서대로 탐색한다.
    _PROMPT_TEXT_KEYS = ("response", "answer", "text", "result", "message", "description")

    async def prompt(self, path: str, prompt: str) -> dict:
        """VLM 서버의 /prompt 자유 질의. 실패 시 ok=False 로 파이프라인을 유지한다.

        Request body::  {"path": "<프레임 폴더>", "prompt": "<사용자 입력>"}
        Returns::       {"ok": bool, "text": str, "raw": dict, "detail": str|None}
        """
        payload = {"path": path, "prompt": prompt}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._prompt_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:  # noqa: BLE001 — VLM 장애 시 빈 응답(모달은 계속 재시도)
            logger.warning(
                "VLM /prompt unreachable/failed at %s (%s)",
                self._prompt_url,
                exc.__class__.__name__,
            )
            return {"ok": False, "text": "", "raw": {}, "detail": str(exc)}

        text = ""
        if isinstance(data, str):
            text = data.strip()
            data = {"response": data}
        elif isinstance(data, dict):
            for key in self._PROMPT_TEXT_KEYS:
                val = data.get(key)
                if isinstance(val, str) and val.strip():
                    text = val.strip()
                    break
        else:
            data = {"response": data}
        return {"ok": True, "text": text, "raw": data, "detail": None}


    async def list_rules(self) -> dict:
        """VLM 서버의 5개 감시 규칙과 승인 상태를 조회한다."""
        return await self._rule_request("GET", self._rules_url)


    async def draft_rule(self, key: str, text: str) -> dict:
        """새 감시 항목 전체를 VLM 서버에 RuleSpec 초안으로 제출한다."""
        return await self._rule_request(
            "POST",
            self._rules_url + "/" + key + "/draft",
            {"text": text},
        )


    async def approve_rule(self, key: str, text: str) -> dict:
        """승인된 새 RuleSpec을 VLM 서버에 적용한다."""
        return await self._rule_request(
            "POST",
            self._rules_url + "/" + key + "/approve",
            {"text": text},
        )


    async def discard_rule(self, key: str) -> dict:
        """승인 대기 중인 감시 규칙 초안을 폐기한다."""
        return await self._rule_request(
            "POST",
            self._rules_url + "/" + key + "/discard",
        )


    async def _rule_request(
        self,
        method: str,
        url: str,
        payload: dict | None = None,
    ) -> dict:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(method, url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning(
                "VLM rule API failed at %s (%s)",
                url,
                exc.__class__.__name__,
            )
            raise RuntimeError(str(exc)) from exc
        if not isinstance(data, dict):
            raise RuntimeError("VLM rule API가 JSON object를 반환하지 않았습니다.")
        return data


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
    def _extract_unknown_action_keys(cls, data: dict) -> list[str]:
        """현행 VLM의 unknown_labels를 알려진 action 키 목록으로 정규화한다."""
        value = data.get(KEY_UNKNOWN_LABELS)
        return cls._dedupe_known(value) if isinstance(value, list) else []

    @classmethod
    def _normalize(cls, data: dict, source: str) -> VlmResult:
        if not isinstance(data, dict):
            data = {}
        action_keys = cls._extract_action_keys(data)
        unknown_action_keys = cls._extract_unknown_action_keys(data)
        rule_labels = {
            str(key): str(value).strip()
            for key, value in data.get(KEY_RULE_LABELS, {}).items()
            if str(key) in VLM_ACTION_KEY_MAP and str(value).strip()
        } if isinstance(data.get(KEY_RULE_LABELS), dict) else {}
        # detection 요약 = 현재 RuleSpec 표시명을 우선 사용한다.
        from app.domain.constants import CATEGORY_BY_ID  # 지역 import (순환 방지)

        labels = [
            rule_labels.get(k, CATEGORY_BY_ID[VLM_ACTION_KEY_MAP[k]].name)
            for k in action_keys
        ]
        return VlmResult(
            action_keys=action_keys,
            unknown_action_keys=unknown_action_keys,
            rule_labels=rule_labels,
            detection=", ".join(labels),
            warning_text=str(data.get(KEY_TTS, "")).strip(),
            scene_description=str(data.get(KEY_DESCRIPTION, "")).strip(),
            source=source,
            raw=data,
        )
