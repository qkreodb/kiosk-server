# Warning Light Control

Standalone warning-light payload and HID control helpers for the main server.

This directory is intentionally not wired into the hardware server runtime. The
main server can copy or import this module after it reads accumulated event
counts from the DB.

## Event Codes

| code | meaning |
| --- | --- |
| `helmet_off` | 모자 벗는 행동 |
| `speaker_touch` | 스피커를 만지는 행동 |
| `restricted_area_entry` | 금지 구역에 출입하는 행동 |
| `solo_ladder_climb` | 사다리를 혼자 올라가는 행동 |

## Severity Rules

| count | level | label | signal |
| ---: | --- | --- | --- |
| 2+ | `interest` | 관심 | green ON/OFF, 5s |
| 4+ | `caution` | 주의 | amber ON/OFF, 5s |
| 6+ | `warning` | 경고 | red ON/OFF, 5s |
| 8+ | `danger` | 위험 | green -> amber -> red blink loop, 5s |

Counts below 2 return `None`, which means no warning-light command is needed.

## Generate a Payload

```bash
python3 -m warning_light_control.example
```

Example:

```json
{
  "device": {
    "type": "warning_light",
    "model": "ST80EL-USB",
    "target_id": "default"
  },
  "event": {
    "code": "restricted_area_entry",
    "name": "금지 구역에 출입하는 행동",
    "count": 8
  },
  "severity": {
    "level": "danger",
    "label": "위험",
    "threshold": 8
  },
  "signal": {
    "color": "R",
    "mode": "sequence",
    "duration_ms": 5000,
    "blink_interval_ms": 500,
    "sequence_step_ms": 500,
    "sequence": [
      "G",
      "Y",
      "R"
    ]
  }
}
```

Tune the danger color-change interval in `payloads.py`:

```python
NORMAL_SIGNAL_DURATION_MS = 5000
NORMAL_BLINK_ON_MS = 500
NORMAL_BLINK_OFF_MS = 300
DANGER_SEQUENCE_STEP_MS = 500
```

`NORMAL_BLINK_ON_MS` and `NORMAL_BLINK_OFF_MS` control the ON and OFF phases
for interest/caution/warning. With the values above, the lamp repeats 0.5s ON
and 0.3s OFF for 5 seconds.

Smaller values switch colors faster. For example, `300` changes color about
every 0.3 seconds.

## HID Integration

Install dependencies on the Jetson:

```bash
sudo apt-get install pkg-config libusb-1.0-0-dev libudev-dev
.venv/bin/pip install hidapi==0.14.0.post4
```

The `ST80ELCommandEncoder` converts the payload into this ST80EL-USB HID packet:

```text
[ReportID, Write, SoundGroup, Red, Amber, Green, Blue, White]
```

The current encoder keeps `SoundGroup` at `0x00`, so it does not intentionally
select the buzzer sound group. Lamp channel values are:

```text
0 = OFF
1 = BLINK
2 = ON
```

```python
from warning_light_control import EventCode, build_warning_light_payload
from warning_light_control.hid_controller import (
    ST80ELCommandEncoder,
    ST80ELHidController,
    open_hid_device,
)

device = open_hid_device()
controller = ST80ELHidController(device=device, encoder=ST80ELCommandEncoder())
payload = build_warning_light_payload(EventCode.RESTRICTED_AREA_ENTRY, 8)

if payload is not None:
    controller.apply(payload)
```

Defaults:

```text
VID = 0x04D8
PID = 0xE73C
```

If the Jetson reports different IDs in `lsusb` or `hid.enumerate()`, pass them
to `open_hid_device(vendor_id=..., product_id=...)`.

## Test Console

Run the standalone test console:

```bash
uvicorn warning_light_control.test_app:app --reload --port 8090
```

Open `http://127.0.0.1:8090`.

The page starts in `dry run` mode. In dry-run mode, button clicks only show the
payload and HID bytes that would be sent. Turn off `dry run` on the Jetson to
write to the connected ST80EL-USB device.

The test console allows only one real HID command at a time. This prevents
button clicks from overlapping ON/OFF loops and making the lamp appear to run
with inconsistent timing.
