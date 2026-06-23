# 실물 경광등(LED) 제어 구현 (2026-06-23)

## 1. 목적 / 배경

최종 목표는 **VLM이 불안전행동을 탐지하면 누적 count에 따라 경광등(LED)을 켜는 것**이다.
다만 현재 VLM 개발자가 자리를 비워 VLM 연동을 진행할 수 없으므로,

1. **파이프라인(점등 진입점)은 미리 준비**해 두고,
2. **시연/검증용으로 직접 점등할 수 있는 버튼**을 키오스크에 추가했다.

키오스크 "불안전행동 감시 신호등" 카드의 **관심 / 주의 / 경고 / 위험** 4개 칸을
클릭 버튼으로 구성하여, 누르면 해당 심각도의 LED가 점등된다. VLM 연동이 완료되면
같은 백엔드 엔드포인트(`POST /led/trigger`)를 VLM 탐지 후처리에서 호출하면 된다.

---

## 2. 외부 LED 제어 모듈 통합

`C:\workspace\warning_light_control` 의 ST80EL-USB HID 제어 코드를 그대로 재사용한다.
해당 모듈 README의 권장사항("The main server can copy or import this module")에 따라
**저장소 자체 완결성**을 위해 패키지를 kiosk-server 루트로 복사했다.

```
warning_light_control/
  __init__.py          # 공개 API 재노출
  payloads.py          # count → 심각도/신호 페이로드 생성 (build_warning_light_payload)
  hid_controller.py    # ST80EL-USB HID 패킷 인코딩/전송 (ST80ELHidController)
  README.md            # 원본 문서 (이벤트 코드/심각도 규칙/HID 통합)
```

> `hidapi` 는 Jetson 전용 의존성(시스템 라이브러리 필요)이라 `requirements.txt` 에
> 추가하지 않았다. `hid_controller.py` 가 **지연 import**하므로, 미설치 환경에서는
> 자동으로 시뮬레이션 모드로 폴백한다(아래 4절 참고).

---

## 3. 심각도 레벨 ↔ count ↔ 신호 매핑

`warning_light_control` 의 심각도 규칙(`SEVERITY_RULES`)을 그대로 사용한다.
각 칸은 의도한 신호가 정확히 나오도록 **대표 count**로 변환된다.

| 키오스크 칸 | level | 대표 count | LED 색 | 모드 | 동작 |
| --- | --- | ---: | --- | --- | --- |
| 관심 | `interest` | 2 | 초록(G) | blink | 초록 점멸 5초 |
| 주의 | `caution` | 4 | 노랑(Y) | blink | 노랑 점멸 5초 |
| 경고 | `warning` | 6 | 빨강(R) | blink | 빨강 점멸 5초 |
| 위험 | `danger` | 8 | 순차 | sequence | 초록→노랑→빨강 순차 점멸 루프 5초 |

> **UI 색상 vs LED 색상 차이 주의**: 키오스크에서 "경고" 칸은 주황색으로 표시되지만,
> 실물 경광등에는 주황 램프가 없어 **빨강 점멸**로 동작한다(하드웨어가 G/Y/R 3색).
> 각 버튼의 `title`(툴팁)에 실제 LED 동작을 명시해 두었다.

---

## 4. 백엔드 변경사항

| 파일 | 변경 내용 |
| --- | --- |
| `warning_light_control/` | 외부 LED 제어 패키지 복사 (신규) |
| `app/core/config.py` | LED 설정 추가: `led_dry_run`, `led_vendor_id`, `led_product_id` |
| `app/services/led_service.py` | LED 점등 서비스 (신규) — 페이로드 생성 + HID 전송 오케스트레이션 |
| `app/api/routers/led.py` | `POST /led/trigger`, `POST /led/off` 라우터 (신규) |
| `app/api/deps.py` | `get_led_service()` 의존성 제공자 추가 |
| `app/main.py` | `led.router` 등록 |

### 핵심 설계 (`led_service.py`)

- **즉시 응답**: 실물 점등(`apply()`)은 blink/sequence 루프로 약 5초간 blocking이므로,
  **백그라운드 데몬 스레드**에서 실행하고 HTTP 응답은 즉시 반환한다.
- **중복 방지**: 프로세스 전역 비차단 락으로 보호. 점등 중 재요청 시 `409` 반환.
- **Graceful 폴백**: `led_dry_run=False`라도 hidapi 미설치/장치 미연결이면 `500`이
  아니라 `simulated` 상태로 폴백해 시연이 끊기지 않는다.

### 설정 (`.env`)

```bash
# 실물 경광등 LED (ST80EL-USB HID)
# false: 실제 장치로 전송 시도(장치 없으면 simulated로 자동 폴백)
# true : 항상 페이로드만 반환(HID 미접근)
KIOSK_LED_DRY_RUN=false
KIOSK_LED_VENDOR_ID=1240    # 0x04D8
KIOSK_LED_PRODUCT_ID=59196  # 0xE73C
```

> Jetson에 장치가 연결돼 있으면 **별도 설정 없이** 그대로 실물 LED가 동작한다.
> 개발 PC(hidapi 없음)에서는 자동으로 `simulated` 응답이 온다.

---

## 5. API 명세

### `POST /led/trigger` — 경광등 점등

요청:
```json
{ "level": "danger", "dry_run": null }
```
- `level`: `interest` | `caution` | `warning` | `danger` (필수)
- `dry_run`: 생략 시 서버 기본값(`KIOSK_LED_DRY_RUN`) 사용. `true`면 HID 미전송.

응답(예: danger, 장치 없는 개발 PC):
```json
{
  "level": "danger",
  "severity": "위험",
  "signal": { "color": "R", "mode": "sequence", "duration_ms": 5000,
              "sequence": ["G", "Y", "R"], "sequence_step_ms": 500 },
  "hid": {
    "vendor_id": "0x4d8", "product_id": "0xe73c",
    "on_command": ["0x00","0x57","0x00","0x01","0x00","0x00","0x00","0x00"],
    "off_command": ["0x00","0x57","0x00","0x00","0x00","0x00","0x00","0x00"]
  },
  "payload": { ... },
  "status": "simulated",
  "detail": "hidapi is not installed. ..."
}
```

`status` 값:
- `sent` — 실물 HID로 전송(백그라운드 점등 시작)
- `simulated` — 장치/hidapi 없어 폴백(페이로드만, 실제 미점등)
- `dry_run` — 요청/설정상 의도적 미전송

오류:
- `422` — 알 수 없는 level / level 누락
- `409` — 이미 점등 동작 중(실물 모드)

### `POST /led/off` — 경광등 소등

```json
{ "dry_run": null }
```

### HID 패킷 형식 (ST80EL-USB)

```
[ReportID, Write(0x57), SoundGroup(0x00), Red, Amber, Green, Blue, White]
램프 채널 값: 0=OFF, 1=BLINK, 2=ON
```
예) 주의(노랑 blink) → `[0x00, 0x57, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]` (Amber=1)

---

## 6. 프론트엔드 변경사항 (`kiosk.html`)

- **신호등 카드 헤더의 4개 칸을 `<button>`으로 변경** (`.bhm-col-btn`).
  - 관심/주의/경고/위험 각각 `onclick="triggerLed('<level>', this)"`.
  - 헤더에 "칸 클릭 → 경광등 점등" 안내 문구 추가.
  - 칸 색상(초록/노랑/주황/빨강)은 기존 디자인 유지, 클릭 시 해당 색으로 글로우.
- **`triggerLed(level, btn)` 함수** (백엔드 연동 스크립트 내):
  - `POST /led/trigger` 호출.
  - 응답 `status`에 따라 상단 연결 배지에 "경광등 OO 점등 중… / 시뮬 / dry-run" 표시.
  - 실물 점등(`sent`) 시 신호 지속시간(약 5초)만큼 4개 버튼 잠금(중복 클릭 방지),
    그 외에는 1.2초 후 복구.

---

## 7. 검증 결과

개발 PC(hidapi 미설치)에서 `POST /led/trigger` 4개 레벨 모두 정상 응답:

| level | status | color/mode | on_command (HID) |
| --- | --- | --- | --- |
| interest | simulated | G / blink | `00 57 00 00 00 01 00 00` |
| caution | simulated | Y / blink | `00 57 00 00 01 00 00 00` |
| warning | simulated | R / blink | `00 57 00 01 00 00 00 00` |
| danger | simulated | R / sequence | `00 57 00 01 00 00 00 00` |

- 잘못된 level / level 누락 → `422` ✓
- `dry_run=true` → `dry_run` ✓
- `POST /led/off` → `simulated` ✓ (장치 없음)
- 프론트: 4개 버튼이 `interest/caution/warning/danger` 로 정확히 매핑, `/led/trigger` 호출 확인 ✓

> Jetson 실물 장치 점등 검증은 hidapi 설치 + ST80EL-USB 연결 후
> `KIOSK_LED_DRY_RUN=false`(기본값) 상태에서 각 버튼 클릭으로 수행한다.

---

## 8. 향후 VLM 연동 지점

VLM 탐지 후처리(`app/services/vlm_service.py`)에서 누적 count를 읽어
`LedService.trigger(level)` 또는 `POST /led/trigger` 를 호출하면, 시연 버튼과
**동일한 경로**로 실물 경광등이 동작한다. 즉 본 작업으로 출력단 파이프라인은 완성됐고,
남은 것은 VLM 탐지 결과 → 레벨 산출 → 호출 연결뿐이다.

---

## 9. 문제 해결 — 버튼을 눌러도 불이 안 켜질 때 (2026-06-23 보강)

### 원인 분석

증상: Jetson(Ubuntu)에서 버튼을 눌러도 경광등이 켜지지 않음. 원본 코드는
**sudo로 실행**해서 제어에 성공했었음.

근본 원인은 **권한 문제**였다. ST80EL-USB는 `/dev/hidraw*` 장치 파일로 접근하는데,
일반 사용자 권한으로는 열 수 없어 `open_hid_device()` 가 실패한다. 원본 테스트
서버를 sudo로 띄웠을 때만 성공했던 것이 바로 이 때문이다.

> 제어 로직(HID 패킷 인코딩/전송)은 주신 `warning_light_control` 모듈을 **그대로
> 재사용**하므로 "코드대로 안 따라서"는 원인이 아니다. 다만 초기 통합 코드가 장치
> 열기 실패를 조용히 `simulated` 로 폴백해 **권한 오류가 화면에 드러나지 않았다.**
> 이를 아래와 같이 수정했다.

### 수정 내용

- **오류 구분**: `hidapi 미설치`(개발 PC) 와 `장치 열기 실패`(권한/연결)를 분리.
  - hidapi 미설치 → 종전처럼 `simulated`(개발 환경, 시연 계속 가능)
  - hidapi 있는데 장치 열기 실패 → **HTTP 503** + 권한/연결 안내 메시지로 **명확히 노출**
- **진단 엔드포인트 추가**: `GET /led/devices`
- **프론트**: 503 응답 시 서버가 보낸 사유를 상단 배지에 그대로 표시.
- **Windows 호환 수정**: `hid_controller.py::_write()` 의 바이트 수 검사를
  `written != len` → `written < len` 으로 완화. Windows hidapi는 리포트를 자동
  패딩해 더 큰 값(예 17/8)을 반환하므로 종전 검사로는 Windows에서 점등이 실패했다
  (`partial HID write` 오류). Linux/Windows 양쪽 동작 확인.

> **환경별 테스트 방법은 [`docs/LED_테스트_가이드.md`](LED_테스트_가이드.md) 참고**
> (Windows: 권한 불필요 / Jetson: udev·sudo 필요). 단계별 명령과 진단표 포함.

### 진단 절차 (Jetson에서)

```bash
curl -s http://localhost:8080/led/devices | python3 -m json.tool
```

| 응답 | 의미 | 조치 |
| --- | --- | --- |
| `"hidapi": false` | 실행 중인 서버의 venv에 hidapi 없음 | venv에 hidapi 설치(아래) |
| `"match_count": 0` | hidapi는 있으나 장치 미인식 | USB 연결/케이블/전원 확인, `lsusb` 확인 |
| 매칭되는데 `/led/trigger`가 **503** | 장치는 보이나 열기 실패 = **권한 문제** | udev 규칙 또는 sudo (아래) |

### 해결 ① — hidapi를 서버 venv에 설치 (먼저 확인)

```bash
sudo apt-get install -y pkg-config libusb-1.0-0-dev libudev-dev
.venv/bin/pip install hidapi==0.14.0.post4
```

> 시스템 전역이 아니라 **kiosk-server가 실행하는 venv**에 설치해야 한다.
> `GET /led/devices` 가 `hidapi: false` 면 이 단계가 누락된 것.

### 해결 ② — 권한 (둘 중 하나)

**(A) udev 규칙 — 권장.** sudo 없이 일반 권한으로 실행 가능.

```bash
sudo cp warning_light_control/99-warning-light.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
# 경광등 USB를 뽑았다 다시 연결 (규칙 확실히 적용)
```

규칙 내용(VID `04d8`, PID `e73c` → `MODE=0666`):
```
KERNEL=="hidraw*", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="e73c", MODE="0666"
SUBSYSTEM=="usb", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="e73c", MODE="0666"
```

**(B) sudo로 서버 실행 — 빠른 임시 방법.** (원본이 동작했던 방식)

```bash
sudo .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

> 단, 웹 서버 전체를 root로 띄우는 것은 권장되지 않으므로 시연 후에는 (A) udev로
> 전환하는 편이 안전하다.

### 검증

권한 적용 후:
```bash
curl -s -X POST http://localhost:8080/led/trigger \
  -H "Content-Type: application/json" -d '{"level":"warning"}'
# → "status": "sent" 이면 실물 점등 시작 (빨강 점멸 5초)
```
키오스크에서 "경고" 칸 클릭 → 상단 배지 "경광등 경고 점등 중…" + 실물 점등이면 성공.
권한 미적용 시에는 배지에 503 권한 안내 메시지가 표시된다.
