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


class WarningLightState(str, Enum):
    """Discrete states the warning light (경광등) can be driven to."""

    OFF = "off"
    GREEN = "green"             # steady green — normal
    YELLOW_BLINK = "yellow_blink"  # 노란색 깜빡임 — caution
    RED_BLINK = "red_blink"     # 빨간색 깜빡임 — danger


# Human-readable Korean control-signal label per state (matches diagram wording,
# e.g. count == 3 -> "노란색 볼 깜빡임").
WARNING_LIGHT_LABEL: dict[WarningLightState, str] = {
    WarningLightState.OFF: "소등",
    WarningLightState.GREEN: "녹색 점등",
    WarningLightState.YELLOW_BLINK: "노란색 볼 깜빡임",
    WarningLightState.RED_BLINK: "빨간색 볼 깜빡임",
}
