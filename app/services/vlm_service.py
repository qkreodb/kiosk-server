"""Orchestrates the full POST /vlm/infer pipeline (right side of 001.png).

Flow:
  1. Call the external VLM Server's /analyze (장애 시 unknown 처리).
  2. ``action``/``labels`` 키 -> 불안전행동 카테고리로 매핑(탐지 여부 판단).
  3. BRANCH A — TTS: 탐지된 행동이 있을 때만 ``tts_message`` -> Edge TTS -> speaker.
     이상 없음(탐지 0건)이면 음성 안내를 울리지 않는다(시연 시 음성 겹침 방지).
  4. BRANCH B — DB:  매핑된 카테고리의 카운트를 증가 -> 결과 카운트 조회 ->
     임계값 기반 경광등 제어 신호 생성 -> 경광등(actuator)으로 전송.
  5. Combine everything into one response DTO.
"""

from __future__ import annotations

import re
import time

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import (
    BEHAVIOR_CATEGORIES,
    CATEGORY_BY_ID,
    VLM_ACTION_KEY_MAP,
    WARNING_LIGHT_LABEL,
    WARNING_STATE_TO_LED_LEVEL,
    UnsafeBehavior,
    WarningLightState,
)
from app.integrations.actuators import SpeakerActuator, WarningLightActuator
from app.integrations.tts import TtsService
from app.integrations.vlm_client import VlmClient
from app.repositories.base import KioskRepository
from app.services.led_service import LedService
from app.services.threshold_store import LightThresholdStore
from app.schemas.vlm import (
    BehaviorDelta,
    TtsDispatch,
    VlmInferResponse,
    VlmPromptResponse,
    VlmVehicleSafetyResponse,
    WarningLightSignal,
)

logger = get_logger(__name__)

# Detection labels are comma / 、/ semicolon separated.
_SPLIT_RE = re.compile(r"[,、;/]+")


def split_detection(detection: str) -> list[str]:
    """Split raw 탐지 text into discrete labels."""
    return [p.strip() for p in _SPLIT_RE.split(detection or "") if p.strip()]


def categories_from_action_keys(
    action_keys: list[str],
    rule_labels: dict[str, str] | None = None,
) -> list[tuple[UnsafeBehavior, str]]:
    """Map VLM /analyze ``action`` keys directly to categories.

    Returns (category_id, matched_label) pairs. ``matched_label`` is the current
    감시 항목 표시명: 슬롯이 자연어로 재배정됐으면 ``rule_labels``의 동적 이름을,
    없으면 내장 카테고리 한글 이름을 쓴다. Each category counts at most once.
    """
    rule_labels = rule_labels or {}
    matched: list[tuple[UnsafeBehavior, str]] = []
    seen: set[UnsafeBehavior] = set()
    for key in action_keys:
        cat_id = VLM_ACTION_KEY_MAP.get(key)
        if cat_id is None or cat_id in seen:
            continue
        matched.append((cat_id, rule_labels.get(key) or CATEGORY_BY_ID[cat_id].name))
        seen.add(cat_id)
    return matched


def match_categories(labels: list[str]) -> list[tuple[UnsafeBehavior, str]]:
    """Fallback: map free-text labels to categories via keyword matching.

    Used only when the VLM returns no structured ``action`` keys (e.g. legacy
    /infer text or an unexpected response). Returns (category_id, matched_label)
    pairs; an unmatched label is ignored (logged). Each category counts once.
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
        led: LedService | None = None,
        cooldown_state: dict[tuple[str, str, str], float] | None = None,
        thresholds: LightThresholdStore | None = None,
        debounce_state: dict | None = None,
        vehicle_cooldown_state: dict[tuple[str, str], float] | None = None,
    ) -> None:
        self._repo = repo
        self._vlm = vlm_client
        self._tts = tts
        self._speaker = speaker
        self._light = warning_light
        self._settings = settings
        self._led = led
        # 경광등·신호등 공용 런타임 기준치. 없으면 Settings(부팅값)로 폴백.
        self._thresholds = thresholds
        # (카메라,공정,행동)별 플리커 디바운스 상태:
        # {(camera_id, code, cat): {"state": bool, "streak": int}}.
        # 요청마다 새 VlmService 가 생기므로 요청 간 공유 dict 를 주입받아 상태를 유지한다.
        self._debounce_state: dict = debounce_state if debounce_state is not None else {}
        # 행동별 독립 쿨다운 타이머. (camera_id, process_code, category_id)
        # -> 만료 monotonic 시각. 카메라가 다른 카메라의 경고를 간섭하지 않는다.
        # 5가지 불안전행동 각각이 상호 간섭 없이 독립적으로 디바운싱된다(동시에 여러
        # 행동이 감지돼도 각자의 만료 시각만 본다). 타임스탬프 기반이라 해제할 타이머
        # 핸들이 없어 자원 누수가 없고, 키는 카메라·공정당 행동 수만큼만 유지된다.
        #
        # ⚠ VlmService 는 요청마다 새로 생성되므로(deps.get_vlm_service), 이 dict 를
        # 인스턴스 안에서 만들면 매 요청 초기화되어 쿨다운이 동작하지 않는다. 따라서
        # 요청 간 공유되는 캐시 dict 를 주입받아 상태를 유지한다(없으면 단독 dict).
        self._cooldown_until: dict[tuple[str, str, str], float] = (
            cooldown_state if cooldown_state is not None else {}
        )
        # (카메라, 차량번호) -> 만료 monotonic 시각. 같은 차량에 대고 계속 반복해서
        # 말하지 않기 위한 타이머로, 위와 같은 이유로 요청 간 공유 dict 를 주입받는다.
        # 차량번호가 바뀌면 키가 달라지므로 새 차량은 대기 없이 즉시 경고한다.
        self._vehicle_cooldown_until: dict[tuple[str, str], float] = (
            vehicle_cooldown_state if vehicle_cooldown_state is not None else {}
        )

    def _resolve_camera(self, camera_id: str) -> dict | None:
        """camera_id 로 DB cctv_info 행을 찾는다(공정·frame_dir 해석용).

        프론트는 "CAM-1" 형태, DB cam_id 는 cctv_id(정수 문자열)라 숫자만 뽑아 매칭한다.
        조회 실패/미연결 시 None → 호출부가 설정 기본값으로 폴백한다.
        """
        m = re.search(r"\d+", camera_id or "")
        if not m:
            return None
        try:
            return self._repo.get_camera(m.group())
        except Exception as exc:  # noqa: BLE001 — 조회 실패해도 분석은 계속(폴백)
            logger.warning("[VLM] 카메라 조회 실패(%s): %s", camera_id, exc)
            return None

    def _threshold(self, key: str) -> int:
        """런타임 기준치(store). store 미주입 시 Settings(부팅값)로 폴백."""
        if self._thresholds is not None:
            return self._thresholds.get()[key]
        return getattr(self._settings, f"light_{key}_threshold")

    def _warning_light_state(self, count: int) -> WarningLightState:
        """누적 카운트 → 경광등 단계 (관심<주의<경고<위험 기준치)."""
        if count >= self._threshold("danger"):    # 위험(순차 점멸)
            return WarningLightState.SEQUENCE
        if count >= self._threshold("warning"):   # 경고(빨강)
            return WarningLightState.RED_BLINK
        if count >= self._threshold("caution"):   # 주의(노랑)
            return WarningLightState.YELLOW_BLINK
        if count >= self._threshold("interest"):  # 관심(초록)
            return WarningLightState.GREEN
        return WarningLightState.OFF              # 소등

    def _trigger_led(self, state: WarningLightState) -> dict | None:
        """경광등 상태에 맞춰 실물 LED(led_service)를 점등. 실패해도 분석은 계속.

        OFF 는 점등하지 않는다(진행 중인 신호를 끊지 않기 위해 소등도 보내지 않음).
        LED가 이미 동작 중(409)이거나 장치 문제(503)면 분석 응답을 깨지 않고 상태만 기록.
        """
        if self._led is None:
            return None
        level = WARNING_STATE_TO_LED_LEVEL.get(state)
        if level is None:
            return None
        try:
            res = self._led.trigger(level)
            return {"level": level, "status": res.get("status")}
        except HTTPException as exc:
            logger.info("[LED] 자동 점등 보류(level=%s): %s", level, exc.detail)
            return {"level": level, "status": "skipped", "detail": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[LED] 자동 점등 실패(level=%s): %s", level, exc)
            return {"level": level, "status": "error", "detail": str(exc)}

    def _stabilize(
        self,
        camera_id: str,
        code: str,
        matches: list[tuple[UnsafeBehavior, str]],
        analyzed_ids: set,
        rule_labels: dict[str, str] | None = None,
    ) -> list[tuple[UnsafeBehavior, str]]:
        """raw 감지(matches)를 (카메라,공정,행동)별 대칭 디바운스로 안정화한다.

        같은 결과(위반/정상)가 ``behavior_debounce_frames`` 회 '연속'돼야 상태를 켜거나
        끈다. 한두 프레임 튀는 플리커는 흡수되고, 진짜 변화는 그 횟수만큼 지연 후 반영된다.
        이번 사이클에 분석하지 않은 행동(analyzed_ids 밖)은 기존 상태를 그대로 유지한다.
        반환은 안정화된 위반 행동 목록((cat_id, 라벨))으로, 이후 카운트/TTS/경광등이 이걸 쓴다.
        """
        need = max(1, int(self._settings.behavior_debounce_frames))
        rule_labels = rule_labels or {}
        raw_label = {cid: lbl for cid, lbl in matches}

        def _name(cid: UnsafeBehavior) -> str:
            # 이번 사이클 매칭 이름 > VLM 동적 표시명 > 내장 카테고리 이름.
            return raw_label.get(cid) or rule_labels.get(cid.value) or CATEGORY_BY_ID[cid].name

        stable: list[tuple[UnsafeBehavior, str]] = []
        for cat in BEHAVIOR_CATEGORIES:
            cid = cat.id
            key = (camera_id, code, cid.value)
            if cid not in analyzed_ids:
                # 이번에 판정 안 한 행동 → 상태 유지(확정된 위반이면 계속 통과).
                entry = self._debounce_state.get(key)
                if entry and entry["state"]:
                    stable.append((cid, _name(cid)))
                continue
            raw = cid in raw_label
            entry = self._debounce_state.get(key)
            if entry is None:
                entry = {"state": False, "streak": 0}
                self._debounce_state[key] = entry
            if raw == entry["state"]:
                entry["streak"] = 0          # 현재 상태와 같음 → 연속 카운터 리셋
            else:
                entry["streak"] += 1         # 반대 결과 연속
                if entry["streak"] >= need:  # need 회 연속이면 상태 전환
                    entry["state"] = raw
                    entry["streak"] = 0
            if entry["state"]:
                stable.append((cid, _name(cid)))
        return stable

    # ── 감시 항목(RuleSpec) 프록시 + 슬롯 상태 리셋 ──────────────────────────
    async def rules_list(self) -> tuple[int, dict]:
        return await self._vlm.rules_request("GET", "/rules")

    async def rule_draft(self, slot: str, text: str) -> tuple[int, dict]:
        return await self._vlm.rules_request("POST", f"/rules/{slot}/draft", {"text": text})

    async def rule_discard(self, slot: str) -> tuple[int, dict]:
        return await self._vlm.rules_request("POST", f"/rules/{slot}/discard")

    def _reset_slot_state(self, slot: str) -> None:
        """재배정/리셋된 슬롯의 옛 카운트·디바운스·쿨다운을 정리한다.

        옛 의미의 누적치가 새 의미와 섞이지 않도록 전역 카운트를 0으로 만들고,
        해당 슬롯의 디바운스/쿨다운 상태를 모든 공정에서 제거한다(다음 사이클부터
        새 의미로 처음부터 안정화).
        """
        try:
            self._repo.reset_behavior_column(slot)
        except Exception:  # noqa: BLE001 — DB 미가용 시에도 규칙 적용은 진행
            logger.warning("슬롯 카운트 리셋 실패(무시): %s", slot)
        for key in [k for k in self._debounce_state if k[-1] == slot]:
            self._debounce_state.pop(key, None)
        for key in [k for k in self._cooldown_until if k[-1] == slot]:
            self._cooldown_until.pop(key, None)

    async def rule_approve(self, slot: str) -> tuple[int, dict]:
        status, data = await self._vlm.rules_request("POST", f"/rules/{slot}/approve")
        if status == 200:
            self._reset_slot_state(slot)
        return status, data

    async def rule_reset(self, slot: str) -> tuple[int, dict]:
        status, data = await self._vlm.rules_request("POST", f"/rules/{slot}/reset")
        if status == 200:
            self._reset_slot_state(slot)
        return status, data

    async def restore_expert_safety_preset(self) -> tuple[int, dict]:
        """기업 시연용 전용 4종 preset을 적용하고 모든 슬롯 상태를 비운다."""
        status, data = await self._vlm.rules_request(
            "POST", "/rules/preset/expert-safety"
        )
        if status == 200:
            for slot in VLM_ACTION_KEY_MAP:
                self._reset_slot_state(slot)
        return status, data

    async def infer(
        self,
        camera_id: str,
        process_code: str | None = None,
        frame_ref: str | None = None,
        frame_dir: str | None = None,
        labels: list[str] | None = None,
        process_name: str | None = None,
    ) -> VlmInferResponse:
        # 카메라 기준으로 공정·프레임폴더·공정명 자동 해석(요청에 없을 때). 각 카메라가
        # 자기 소속 공정(process_code/process_name)과 프레임 폴더(frame_dir)를 DB
        # cctv_info 에서 가져오므로, 프론트는 camera_id 만 보내면 된다(드롭다운 의존 제거).
        if process_code is None or frame_dir is None or process_name is None:
            cam = self._resolve_camera(camera_id)
            if cam:
                if process_code is None:
                    process_code = cam.get("process_code") or None
                if frame_dir is None:
                    frame_dir = cam.get("frame_dir") or None
                if process_name is None:
                    # get_camera 는 공정명을 label 로 준다(미연결 시 "CCTV N" 폴백).
                    process_name = cam.get("label") or None

        code = process_code or "PRC-19"

        # 재생 세대값을 분석 시작 시점에 캡처 — 분석 중 flush_tts()(예: CCTV 모달 종료)가
        # 호출되면 이 요청의 늦은 TTS 재생은 폐기된다.
        play_epoch = self._speaker.current_epoch()

        # 1) Call the VLM Server's /analyze (장애 시 unknown 결과).
        #    labels: 신호등에서 체크된 분석 대상 행동 키만 VLM 서버로 전달.
        #    process_name: 이 카메라의 공정명(위험 스냅샷 파일명 규칙에 사용).
        vlm = await self._vlm.analyze(frame_dir, labels=labels, process_name=process_name)

        # 2) 탐지된 불안전행동 매핑 (TTS 발동 여부 판단에도 사용).
        #    구조화된 action 키가 있으면 직접 매핑, 없으면 자유텍스트 키워드 폴백.
        if labels == []:
            # 감시 라벨을 하나도 선택하지 않은 요청은 서버 응답과 무관하게
            # 불안전행동을 반영하지 않는다.
            matches = []
        elif vlm.action_keys:
            matches = categories_from_action_keys(vlm.action_keys, vlm.rule_labels)
        else:
            matches = match_categories(split_detection(vlm.detection))

        # 2-a) 플리커 억제: (카메라,공정,행동)별로 같은 판정이 N회 연속돼야 위반 상태를 켜거나 끈다.
        #      한 프레임 튀는 노이즈를 흡수한다(진짜 변화는 N프레임 지연 후 반영). 이번에
        #      분석한 행동만 상태를 갱신하고, 안 본 행동은 기존 상태를 유지한다.
        if labels is not None:
            # 명시적으로 선택된 감시항목만 이번 요청의 연계 범위로 삼는다.
            # 선택되지 않은 슬롯의 디바운스 상태는 보존하더라도, 현재 요청의
            # DB/TTS/경광등 계산에는 다시 섞이지 않아야 한다.
            selected_ids = {VLM_ACTION_KEY_MAP.get(k) for k in labels}
            selected_ids.discard(None)
            if labels and not selected_ids:
                selected_ids = {cat.id for cat in BEHAVIOR_CATEGORIES}
            analyzed_ids = set(selected_ids)
        else:
            selected_ids = {cat.id for cat in BEHAVIOR_CATEGORIES}
            analyzed_ids = set(selected_ids)
        # unknown은 정상(false)이 아니다. 이 사이클의 상태 전환/해제 근거에서
        # 제외해 _stabilize()가 기존 상태를 유지하도록 한다.
        unknown_ids = {
            VLM_ACTION_KEY_MAP[key]
            for key in vlm.unknown_action_keys
            if key in VLM_ACTION_KEY_MAP
        }
        uncertain_labels = [
            label
            for cat_id, label in categories_from_action_keys(
                vlm.unknown_action_keys, vlm.rule_labels
            )
            if cat_id in selected_ids
        ]
        # UI용 이번 응답의 확정 판정은 안정화 상태와 분리한다. unknown일 때 이전
        # 안정 탐지를 재표시하지 않도록, 명확한 이번-cycle evidence만 전달한다.
        cycle_matches = [
            (cat_id, label)
            for cat_id, label in matches
            if cat_id in selected_ids and cat_id not in unknown_ids
        ]
        if labels == []:
            cycle_decision = "not_requested"
            cycle_detection = ""
        elif cycle_matches:
            cycle_decision = "detected"
            cycle_detection = ", ".join(label for _, label in cycle_matches)
        elif unknown_ids:
            cycle_decision = "unclear"
            cycle_detection = ""
        else:
            cycle_decision = "not_detected"
            cycle_detection = ""
        analyzed_ids -= unknown_ids
        matches = self._stabilize(camera_id, code, matches, analyzed_ids, vlm.rule_labels)
        if labels is not None:
            # _stabilize()는 미분석 슬롯의 기존 안정 상태를 보존한다. 하지만
            # 체크박스로 분석 범위를 제한한 요청에서는 그 상태를 현재 연계에
            # 사용하지 않는다. 재선택 시에는 기존 슬롯 카운트를 그대로 이어간다.
            matches = [(cat_id, label) for cat_id, label in matches if cat_id in selected_ids]

        # 2-b) 행동별 독립 쿨다운(디바운스) 적용.
        #    같은 행동이 쿨다운 중이면 이번 사이클에서는 무시(allowed에서 제외)하여
        #    DB 카운트·TTS·경광등을 발동하지 않는다. 쿨다운이 풀린(또는 처음인) 행동만
        #    allowed 로 통과시키고 즉시 해당 행동의 타이머를 재가동한다. 각 행동의
        #    만료 시각이 독립이므로 A가 쿨다운 중이어도 B는 곧바로 통과한다.
        now = time.monotonic()
        cooldown = self._settings.behavior_cooldown_seconds
        allowed: list[tuple[UnsafeBehavior, str]] = []
        for cat_id, matched_label in matches:
            # unknown은 기존 안정 상태를 응답에는 유지하지만, 최신 증거가 없으므로
            # DB/TTS/경광등의 반복 부작용은 실행하지 않는다.
            if cat_id in unknown_ids:
                logger.info(
                    "[unknown] %s — 기존 안정 상태는 유지하지만 카운트/TTS/경광등 무시",
                    cat_id.value,
                )
                continue
            key = (camera_id, code, cat_id.value)
            if self._cooldown_until.get(key, 0.0) > now:
                logger.info(
                    "[쿨다운] %s 디바운스 — 카운트/TTS/경광등 무시(만료까지 %.1fs)",
                    cat_id.value,
                    self._cooldown_until[key] - now,
                )
                continue
            allowed.append((cat_id, matched_label))
            if cooldown > 0:
                self._cooldown_until[key] = now + cooldown

        # 3) BRANCH A — TTS -> speaker.
        #    이상 없음(통과한 행동 없음 — 미탐지이거나 전부 쿨다운 중)이면 음성 안내를
        #    울리지 않는다 — 시연 시 안전 상황·연속 감지에서 음성이 겹치는 문제를 방지.
        #    재생은 백그라운드 스레드(fire-and-forget)로 — 오디오 재생 시간 동안
        #    /vlm/infer 응답과 이벤트 루프가 막히지 않도록 한다(실시간 재생 유지).
        tts_text = vlm.warning_text if allowed else ""
        tts_result = await self._tts.synthesize(tts_text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play_async(tts_result.audio_path, tts_result.text, epoch=play_epoch)
        tts = TtsDispatch(**tts_result.model_dump())

        # 4) BRANCH B — DB-increment per allowed behavior (쿨다운 통과분만), read counts.
        labels = [label for _, label in matches]
        deltas: list[BehaviorDelta] = []
        for cat_id, matched_label in allowed:
            new_count = self._repo.increment_behavior(code, cat_id.value, 1)
            cat = CATEGORY_BY_ID[cat_id]
            deltas.append(
                BehaviorDelta(
                    id=cat.id.value,
                    # 재배정된 슬롯은 동적 표시명(matched_label)을 UI/알림에 노출한다.
                    name=matched_label or cat.name,
                    grade=cat.base_grade.value,
                    matched_label=matched_label,
                    increment=1,
                    count=new_count,
                )
            )

        # 경광등 발동 규칙:
        #  1) 안전 결과(이번 사이클 탐지 없음, 또는 탐지돼도 전부 쿨다운 중)면 카운트가
        #     높아도 절대 울리지 않는다. 트리거는 반드시 "이번 사이클에 쿨다운을 통과한
        #     VLM 탐지가 존재"할 때만 발동한다(deltas 가 곧 쿨다운 통과분).
        #  2) 다중 탐지 우선순위: 한 번에 여러 행동이 탐지되면, 그중 카운트가 가장
        #     높은 항목의 단계를 경광등에 반영한다(예: A=5, B=15 → 15의 점멸).
        has_detection = bool(deltas)
        trigger_count = max((d.count for d in deltas), default=0)
        state = (
            self._warning_light_state(trigger_count)
            if has_detection
            else WarningLightState.OFF
        )
        label = WARNING_LIGHT_LABEL[state]
        dispatched = False
        led_dispatch: dict | None = None
        if has_detection and state is not WarningLightState.OFF:
            dispatched = self._light.dispatch(state, label, trigger_count)
            # 실물 경광등(LED) 자동 점등 — 실패해도 분석 응답은 유지.
            led_dispatch = self._trigger_led(state)

        warning_light = WarningLightSignal(
            state=state.value,
            label=label,
            trigger_count=trigger_count,
            interest_threshold=self._threshold("interest"),
            caution_threshold=self._threshold("caution"),
            warning_threshold=self._threshold("warning"),
            danger_threshold=self._threshold("danger"),
            dispatched=dispatched,
            led=led_dispatch,
        )

        # 5) Combine. UI에는 원시 VLM 문구가 아니라 안정화된 결과만 보낸다.
        # 원시 문구는 result/checks 불일치, 디바운스 대기, unknown 상태에서도 "미착용"을
        # 남길 수 있어 실제 행동 상태와 달라진다. labels는 바로 위 _stabilize()의 결과다.
        stable_detection = ", ".join(labels)
        return VlmInferResponse(
            camera_id=camera_id,
            process_code=code,
            source=vlm.source,
            detection=stable_detection,
            detection_labels=labels,
            uncertain_labels=uncertain_labels,
            cycle_decision=cycle_decision,
            cycle_detection=cycle_detection,
            scene_description=vlm.scene_description,
            warning_text=tts_text,
            behaviors=deltas,
            warning_light=warning_light,
            tts=tts,
        )

    async def prompt(
        self,
        camera_id: str,
        prompt: str,
        path: str | None = None,
    ) -> VlmPromptResponse:
        """자유 프롬프트 질의(신규 CCTV 모달) — VLM /prompt 프록시.

        분석 파이프라인(카운트·TTS·경광등)과 무관하게, 사용자가 입력한 프롬프트를
        해당 카메라의 프레임 폴더와 함께 VLM 서버로 전달하고 답변 텍스트만 돌려준다.
        ``path`` 미지정 시 카메라의 DB frame_dir → 설정 기본값 순으로 해석한다.
        """
        if path is None:
            cam = self._resolve_camera(camera_id)
            if cam:
                path = cam.get("frame_dir") or None
        path = path or self._settings.vlm_frame_dir

        # 재생 세대값을 질의 시작 시점에 캡처 — CCTV 모달 종료(flush_tts) 시 이 요청의
        # 늦은 TTS 재생은 폐기된다(infer()와 동일 패턴).
        play_epoch = self._speaker.current_epoch()

        result = await self._vlm.prompt(path, prompt)
        answer_text = str(result.get("text") or "")

        tts_result = await self._tts.synthesize(answer_text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play_async(tts_result.audio_path, tts_result.text, epoch=play_epoch)

        return VlmPromptResponse(
            camera_id=camera_id,
            path=path,
            prompt=prompt,
            ok=bool(result.get("ok")),
            text=answer_text,
            detail=result.get("detail"),
            tts=TtsDispatch(**tts_result.model_dump()),
        )

    async def vehicle_safety(
        self,
        camera_id: str,
        path: str | None = None,
    ) -> VlmVehicleSafetyResponse:
        """중앙 CCTV 점검 1회 — 사람 → 차량번호 + 안전모 → 경고 음성.

        판정은 VLM 서버(/vehicle-safety)가 하고, 여기서는 발화 정책만 담당한다:
        경고 문구가 있을 때만, 그리고 같은 차량번호가 쿨다운 중이 아닐 때만 재생한다.
        번호를 못 읽었거나 판정이 불확실한 사이클은 조용히 넘어간다(VLM 이 이미
        ``tts_message`` 를 비워서 보낸다).

        분석 카운트·경광등 파이프라인과는 무관하다 — 이 기능은 경고 음성 전용이다.
        """
        if path is None:
            cam = self._resolve_camera(camera_id)
            if cam:
                path = cam.get("frame_dir") or None
        path = path or self._settings.vlm_frame_dir

        # 재생 세대값을 질의 시작 시점에 캡처 — 모달 종료(flush_tts) 시 이 요청의
        # 늦은 TTS 재생은 폐기된다(infer()/prompt()와 동일 패턴).
        play_epoch = self._speaker.current_epoch()

        result = await self._vlm.vehicle_safety(path)
        if not result.get("ok"):
            return VlmVehicleSafetyResponse(
                camera_id=camera_id,
                path=path,
                ok=False,
                reason="vlm_error",
                detail=result.get("detail"),
            )

        data = result.get("data") or {}
        reason = str(data.get("reason") or "")
        plate = data.get("plate") or None
        text = str(data.get("tts_message") or "")

        response = VlmVehicleSafetyResponse(
            camera_id=camera_id,
            path=path,
            ok=True,
            reason=reason,
            person=data.get("person"),
            plate=plate,
            helmet_violation=data.get("helmet_violation"),
            text=text,
        )
        if not text:
            return response

        # 같은 차량번호로 연속 경고하지 않는다. 쿨다운 중이면 문구는 화면 자막으로
        # 남기되 음성만 생략한다.
        now = time.monotonic()
        key = (camera_id, plate or "")
        if now < self._vehicle_cooldown_until.get(key, 0.0):
            response.detail = "쿨다운 중 — 음성 생략"
            return response
        self._vehicle_cooldown_until[key] = (
            now + self._settings.vehicle_tts_cooldown_seconds
        )

        tts_result = await self._tts.synthesize(text)
        if tts_result.status in {"synthesized", "stubbed"}:
            self._speaker.play_async(tts_result.audio_path, tts_result.text, epoch=play_epoch)
            response.spoken = True
        response.tts = TtsDispatch(**tts_result.model_dump())
        logger.info("[VEHICLE] %s | plate=%s | 발화=%s", camera_id, plate, response.spoken)
        return response

    def flush_tts(self) -> None:
        """대기 중인 TTS를 폐기(현재 재생 중인 건 끝까지 재생). CCTV 모달 종료 시 호출."""
        self._speaker.flush()
