"""Domain enums and constants shared across the server.

The single source of truth for:
  * the 4 unsafe-behavior ("불안전행동") categories the kiosk monitors, and
  * the warning-light ("경광등") states the /vlm/infer pipeline can emit.

Category names match the labels rendered by the kiosk frontend
(``kiosk.html`` slide 0 of the 불안전행동 감시 신호등 card), so counts produced
here line up 1:1 with what the UI displays.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class BehaviorGrade(str, Enum):
    """Severity grade shown as a colored lamp next to each behavior."""

    NORMAL = "정상"   # green
    CAUTION = "주의"  # amber
    DANGER = "위험"   # red


class UnsafeBehavior(str, Enum):
    """Stable identifiers for the 4 unsafe-behavior categories."""

    HELMET_OFF = "helmet_off"
    TOUCH_EQUIPMENT = "touch_equipment"
    UNAUTHORIZED_CROSSING = "unauthorized_crossing"
    LADDER_ALONE = "ladder_alone"


@dataclass(frozen=True)
class BehaviorCategory:
    """Static metadata for one unsafe-behavior category.

    ``keywords`` are matched against the VLM "탐지" (detection) text to decide
    which categories to increment. Keep them lowercase; matching is
    case-insensitive and substring-based.
    """

    id: UnsafeBehavior
    name: str           # Korean label shown in the kiosk UI.
    base_grade: BehaviorGrade
    keywords: tuple[str, ...] = field(default_factory=tuple)


# Order here is the order the frontend lists them in slide 0.
BEHAVIOR_CATEGORIES: tuple[BehaviorCategory, ...] = (
    BehaviorCategory(
        id=UnsafeBehavior.HELMET_OFF,
        name="모자(안전모) 벗는 행동",
        base_grade=BehaviorGrade.DANGER,
        keywords=("안전모", "헬멧", "모자", "helmet"),
    ),
    BehaviorCategory(
        id=UnsafeBehavior.TOUCH_EQUIPMENT,
        name="스피커(설비) 만지는 행동",
        base_grade=BehaviorGrade.CAUTION,
        keywords=("설비", "스피커", "기계", "장비", "만지"),
    ),
    BehaviorCategory(
        id=UnsafeBehavior.UNAUTHORIZED_CROSSING,
        name="위험지역 무단횡단 행동",
        base_grade=BehaviorGrade.NORMAL,
        keywords=("무단횡단", "위험지역", "통제구역", "출입"),
    ),
    BehaviorCategory(
        id=UnsafeBehavior.LADDER_ALONE,
        name="사다리 혼자 올라가는 행동",
        base_grade=BehaviorGrade.NORMAL,
        keywords=("사다리", "단독", "혼자", "ladder"),
    ),
)

# Convenience lookups.
CATEGORY_BY_ID: dict[UnsafeBehavior, BehaviorCategory] = {
    c.id: c for c in BEHAVIOR_CATEGORIES
}


# VLM Server(`POST /analyze`)의 LLM 단계가 반환하는 ``action`` 키를 키오스크의
# 불안전행동 카테고리로 직접 매핑한다. 키는 VLM 서버의 DEFAULT_DETECT_ACTIONS
# 및 README 표와 1:1 로 일치한다(자유텍스트 키워드 매칭 불필요).
#   hat_action         안전모 미착용 또는 벗는 행동
#   touch_action       스피커를 만지는 행동
#   dangerInOut_action 금지 구역 출입
#   ladder_action      사다리를 올라가거나 단독 사다리 작업
VLM_ACTION_KEY_MAP: dict[str, UnsafeBehavior] = {
    "hat_action": UnsafeBehavior.HELMET_OFF,
    "touch_action": UnsafeBehavior.TOUCH_EQUIPMENT,
    "dangerInOut_action": UnsafeBehavior.UNAUTHORIZED_CROSSING,
    "ladder_action": UnsafeBehavior.LADDER_ALONE,
}

# 키오스크가 `/analyze` 요청 시 함께 보내는 detect_actions(키+라벨). 키오스크가
# 매핑의 단일 소유자가 되도록 명시적으로 전달한다(VLM 서버 기본값과 동일).
VLM_DETECT_ACTIONS: list[dict[str, str]] = [
    {"key": "hat_action", "label": "안전모를 착용하지 않았거나 벗는 행동"},
    {"key": "touch_action", "label": "스피커를 만지는 행동"},
    {"key": "dangerInOut_action", "label": "금지 구역에 출입하는 행동"},
    {"key": "ladder_action", "label": "사다리를 올라가거나 단독 사다리 작업"},
]


class WarningLightState(str, Enum):
    """Discrete states the warning light (경광등) can be driven to.

    누적 카운트 임계값(3/6/9/12)에 따라 관심→주의→경고→위험으로 단계가 오른다.
    """

    OFF = "off"                    # 0~2회   — 소등
    GREEN = "green"                # 3~5회   — 관심 (초록 점등)
    YELLOW_BLINK = "yellow_blink"  # 6~8회   — 주의 (노란색 깜빡임)
    RED_BLINK = "red_blink"        # 9~11회  — 경고 (빨간색 깜빡임)
    SEQUENCE = "sequence"          # 12회+   — 위험 (초록→노랑→빨강 순차 점멸)


# Human-readable Korean control-signal label per state.
WARNING_LIGHT_LABEL: dict[WarningLightState, str] = {
    WarningLightState.OFF: "소등",
    WarningLightState.GREEN: "녹색 점등 (관심)",
    WarningLightState.YELLOW_BLINK: "노란색 깜빡임 (주의)",
    WarningLightState.RED_BLINK: "빨간색 깜빡임 (경고)",
    WarningLightState.SEQUENCE: "순차 점멸 (위험)",
}

# 경광등 상태 → 실물 LED(led_service) 레벨. OFF 는 점등하지 않는다.
WARNING_STATE_TO_LED_LEVEL: dict[WarningLightState, str] = {
    WarningLightState.GREEN: "interest",
    WarningLightState.YELLOW_BLINK: "caution",
    WarningLightState.RED_BLINK: "warning",
    WarningLightState.SEQUENCE: "danger",
}
