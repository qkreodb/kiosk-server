from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any


class EventCode(StrEnum):
    HELMET_OFF = "helmet_off"
    SPEAKER_TOUCH = "speaker_touch"
    RESTRICTED_AREA_ENTRY = "restricted_area_entry"
    SOLO_LADDER_CLIMB = "solo_ladder_climb"


class SeverityLevel(StrEnum):
    NORMAL = "normal"
    INTEREST = "interest"
    CAUTION = "caution"
    WARNING = "warning"
    DANGER = "danger"


class SignalColor(StrEnum):
    GREEN = "G"
    YELLOW = "Y"
    RED = "R"


class SignalMode(StrEnum):
    STEADY = "steady"
    BLINK = "blink"
    SEQUENCE = "sequence"


NORMAL_SIGNAL_DURATION_MS = 5000
NORMAL_BLINK_ON_MS = 150
NORMAL_BLINK_OFF_MS = 150
DANGER_SEQUENCE_STEP_MS = 500


@dataclass(frozen=True)
class WarningLightDevice:
    type: str = "warning_light"
    model: str = "ST80EL-USB"
    target_id: str = "default"


@dataclass(frozen=True)
class EventDefinition:
    code: EventCode
    name: str


@dataclass(frozen=True)
class EventPayload:
    code: str
    name: str
    count: int


@dataclass(frozen=True)
class SeverityPayload:
    level: str
    label: str
    threshold: int


@dataclass(frozen=True)
class SignalPayload:
    color: str
    mode: str
    duration_ms: int
    blink_interval_ms: int | None = None
    blink_on_ms: int | None = None
    blink_off_ms: int | None = None
    sequence: list[str] | None = None
    sequence_step_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if data["blink_interval_ms"] is None:
            data.pop("blink_interval_ms")
        if data["blink_on_ms"] is None:
            data.pop("blink_on_ms")
        if data["blink_off_ms"] is None:
            data.pop("blink_off_ms")
        if data["sequence"] is None:
            data.pop("sequence")
        if data["sequence_step_ms"] is None:
            data.pop("sequence_step_ms")
        return data


@dataclass(frozen=True)
class WarningLightPayload:
    device: WarningLightDevice
    event: EventPayload
    severity: SeverityPayload
    signal: SignalPayload

    def to_dict(self) -> dict[str, Any]:
        return {
            "device": asdict(self.device),
            "event": asdict(self.event),
            "severity": asdict(self.severity),
            "signal": self.signal.to_dict(),
        }


EVENT_DEFINITIONS: dict[EventCode, EventDefinition] = {
    EventCode.HELMET_OFF: EventDefinition(
        code=EventCode.HELMET_OFF,
        name="모자 벗는 행동",
    ),
    EventCode.SPEAKER_TOUCH: EventDefinition(
        code=EventCode.SPEAKER_TOUCH,
        name="스피커를 만지는 행동",
    ),
    EventCode.RESTRICTED_AREA_ENTRY: EventDefinition(
        code=EventCode.RESTRICTED_AREA_ENTRY,
        name="금지 구역에 출입하는 행동",
    ),
    EventCode.SOLO_LADDER_CLIMB: EventDefinition(
        code=EventCode.SOLO_LADDER_CLIMB,
        name="사다리를 혼자 올라가는 행동",
    ),
}

DEFAULT_DEVICE = WarningLightDevice()

SEVERITY_RULES: tuple[tuple[int, SeverityLevel, str, SignalColor, SignalMode, int], ...] = (
    (8, SeverityLevel.DANGER, "위험", SignalColor.RED, SignalMode.SEQUENCE, 5000),
    (6, SeverityLevel.WARNING, "경고", SignalColor.RED, SignalMode.BLINK, NORMAL_SIGNAL_DURATION_MS),
    (4, SeverityLevel.CAUTION, "주의", SignalColor.YELLOW, SignalMode.BLINK, NORMAL_SIGNAL_DURATION_MS),
    (2, SeverityLevel.INTEREST, "관심", SignalColor.GREEN, SignalMode.BLINK, NORMAL_SIGNAL_DURATION_MS),
)


def resolve_severity(count: int) -> tuple[SeverityPayload, SignalPayload] | None:
    if count < 0:
        raise ValueError("count must be greater than or equal to 0")

    for threshold, level, label, color, mode, duration_ms in SEVERITY_RULES:
        if count >= threshold:
            blink_interval_ms = (
                NORMAL_BLINK_ON_MS + NORMAL_BLINK_OFF_MS
                if mode == SignalMode.BLINK
                else 500
                if mode == SignalMode.SEQUENCE
                else None
            )
            blink_on_ms = NORMAL_BLINK_ON_MS if mode == SignalMode.BLINK else None
            blink_off_ms = NORMAL_BLINK_OFF_MS if mode == SignalMode.BLINK else None
            sequence = (
                [SignalColor.GREEN.value, SignalColor.YELLOW.value, SignalColor.RED.value]
                if mode == SignalMode.SEQUENCE
                else None
            )
            sequence_step_ms = DANGER_SEQUENCE_STEP_MS if mode == SignalMode.SEQUENCE else None
            return (
                SeverityPayload(
                    level=level.value,
                    label=label,
                    threshold=threshold,
                ),
                SignalPayload(
                    color=color.value,
                    mode=mode.value,
                    duration_ms=duration_ms,
                    blink_interval_ms=blink_interval_ms,
                    blink_on_ms=blink_on_ms,
                    blink_off_ms=blink_off_ms,
                    sequence=sequence,
                    sequence_step_ms=sequence_step_ms,
                ),
            )

    return None


def build_warning_light_payload(
    event_code: EventCode | str,
    count: int,
    device: WarningLightDevice = DEFAULT_DEVICE,
) -> WarningLightPayload | None:
    event_code = EventCode(event_code)
    resolved = resolve_severity(count)
    if resolved is None:
        return None

    severity, signal = resolved
    event = EVENT_DEFINITIONS[event_code]
    return WarningLightPayload(
        device=device,
        event=EventPayload(
            code=event.code.value,
            name=event.name,
            count=count,
        ),
        severity=severity,
        signal=signal,
    )
