from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

from .payloads import SignalColor, SignalMode, WarningLightPayload


DEFAULT_VENDOR_ID = 0x04D8
DEFAULT_PRODUCT_ID = 0xE73C

REPORT_ID = 0x00
WRITE_COMMAND = 0x57
SOUND_GROUP_NONE = 0x00

LAMP_OFF = 0
LAMP_BLINK = 1
LAMP_ON = 2


class HidDevice(Protocol):
    def write(self, data: bytes) -> int:
        ...

    def close(self) -> None:
        ...


class CommandEncoder(Protocol):
    def encode_on(self, payload: WarningLightPayload) -> bytes:
        ...

    def encode_lamp(self, color: str, mode: str) -> bytes:
        ...

    def encode_off(self) -> bytes:
        ...


class ST80ELCommandEncoder:
    """Encode warning-light payloads into ST80EL-USB HID reports.

    Packet format:
    [ReportID, Write, SoundGroup, Red, Amber, Green, Blue, White]

    Lamp channel values:
    0 = OFF, 1 = BLINK, 2 = ON
    """

    def encode_on(self, payload: WarningLightPayload) -> bytes:
        return self.encode_lamp(payload.signal.color, payload.signal.mode)

    def encode_lamp(self, color: str, mode: str) -> bytes:
        value = LAMP_BLINK if mode in {SignalMode.BLINK.value, SignalMode.SEQUENCE.value} else LAMP_ON
        red = value if color == SignalColor.RED.value else LAMP_OFF
        amber = value if color == SignalColor.YELLOW.value else LAMP_OFF
        green = value if color == SignalColor.GREEN.value else LAMP_OFF
        return self._packet(red=red, amber=amber, green=green)

    def encode_off(self) -> bytes:
        return self._packet()

    def _packet(
        self,
        red: int = LAMP_OFF,
        amber: int = LAMP_OFF,
        green: int = LAMP_OFF,
        blue: int = LAMP_OFF,
        white: int = LAMP_OFF,
    ) -> bytes:
        return bytes(
            [
                REPORT_ID,
                WRITE_COMMAND,
                SOUND_GROUP_NONE,
                red,
                amber,
                green,
                blue,
                white,
            ]
        )


@dataclass
class ST80ELHidController:
    device: HidDevice
    encoder: CommandEncoder

    def apply(self, payload: WarningLightPayload) -> None:
        if payload.signal.mode == SignalMode.SEQUENCE.value:
            self._apply_sequence(payload)
            return

        if payload.signal.mode == SignalMode.BLINK.value:
            self._apply_blink(payload)
            return

        self._write(self.encoder.encode_on(payload))
        time.sleep(payload.signal.duration_ms / 1000)
        self.off()

    def off(self) -> None:
        self._write(self.encoder.encode_off())

    def close(self) -> None:
        self.device.close()

    def _write(self, command: bytes) -> None:
        written = self.device.write(command)
        # 플랫폼별 hidapi write() 반환값 차이:
        #   * Linux  : 정확히 len(command) 반환
        #   * Windows: 출력 리포트를 장치 리포트 길이로 자동 패딩 → len(command)보다
        #              큰 값(예: 17)을 반환. 이는 정상 동작이다.
        # 따라서 "정확히 일치"가 아니라 "요청한 바이트 수 이상 기록"을 성공으로 본다.
        # 음수(-1 등)는 hidapi 의 실패 신호.
        if written < len(command):
            raise IOError(f"HID write failed: wrote {written} bytes (expected >= {len(command)})")

    def _apply_blink(self, payload: WarningLightPayload) -> None:
        try:
            self._write(self.encoder.encode_lamp(payload.signal.color, SignalMode.BLINK.value))
            time.sleep(payload.signal.duration_ms / 1000)
        finally:
            self.off()

    def _apply_sequence(self, payload: WarningLightPayload) -> None:
        sequence = payload.signal.sequence or []
        if not sequence:
            raise ValueError("sequence mode requires at least one signal color")

        step_seconds = (payload.signal.sequence_step_ms or 500) / 1000
        deadline = time.monotonic() + (payload.signal.duration_ms / 1000)
        try:
            index = 0
            while time.monotonic() < deadline:
                color = sequence[index % len(sequence)]
                self._write(self.encoder.encode_lamp(color, SignalMode.BLINK.value))
                time.sleep(min(step_seconds, max(0, deadline - time.monotonic())))
                index += 1
        finally:
            self.off()


def open_hid_device(
    vendor_id: int = DEFAULT_VENDOR_ID,
    product_id: int = DEFAULT_PRODUCT_ID,
) -> HidDevice:
    hid = _import_hid()

    device = hid.device()
    try:
        device.open(vendor_id, product_id)
    except OSError as exc:
        raise RuntimeError(
            f"failed to open HID device VID={vendor_id:#06x}, PID={product_id:#06x}. "
            "Check that the device is connected, the IDs match, and the process has "
            "permission to access /dev/hidraw*. Try running the test server with sudo "
            "once to confirm whether this is a permission issue."
        ) from exc
    return device


def list_hid_devices() -> list[dict[str, Any]]:
    hid = _import_hid()
    return [
        {
            "vendor_id": hex(device.get("vendor_id", 0)),
            "product_id": hex(device.get("product_id", 0)),
            "manufacturer": device.get("manufacturer_string"),
            "product": device.get("product_string"),
            "path": _decode_path(device.get("path")),
            "interface_number": device.get("interface_number"),
            "usage_page": device.get("usage_page"),
            "usage": device.get("usage"),
        }
        for device in hid.enumerate()
    ]


def _import_hid():
    try:
        import hid
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "hidapi is not installed. Install system packages "
            "(`sudo apt-get install pkg-config libusb-1.0-0-dev libudev-dev`) "
            "and then "
            "run `.venv/bin/pip install hidapi==0.14.0.post4`."
        ) from exc

    return hid


def _decode_path(path) -> str | None:
    if path is None:
        return None
    if isinstance(path, bytes):
        return path.decode(errors="replace")
    return str(path)
