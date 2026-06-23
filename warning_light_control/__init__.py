"""Warning light payload and HID control helpers."""

from .payloads import (
    EVENT_DEFINITIONS,
    DEFAULT_DEVICE,
    EventCode,
    SignalMode,
    SignalColor,
    SeverityLevel,
    WarningLightDevice,
    WarningLightPayload,
    build_warning_light_payload,
    resolve_severity,
)

__all__ = [
    "EVENT_DEFINITIONS",
    "DEFAULT_DEVICE",
    "EventCode",
    "SignalMode",
    "SignalColor",
    "SeverityLevel",
    "WarningLightDevice",
    "WarningLightPayload",
    "build_warning_light_payload",
    "resolve_severity",
]
