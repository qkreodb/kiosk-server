# 경광등(LED) 테스트 가이드 — Windows / Jetson 단계별 (2026-06-23)

키오스크 신호등 카드의 **관심/주의/경고/위험 칸**을 클릭하면 실물 경광등
(Q-Light ST80EL-USB)이 점등된다. 이 문서는 **Windows(개발/시연 PC)** 와
**Jetson(Ubuntu, 실배포)** 두 환경에서 테스트하는 방법을 단계별로 정리한다.

---

## 0. 공통 — 왜 환경마다 다른가

LED는 USB **HID 장치**라 `hidapi`(파이썬 `hid` 모듈)로 제어한다. 환경 차이는 두 가지뿐:

| 구분 | Windows | Jetson(Ubuntu) |
| --- | --- | --- |
| 장치 접근 권한 | **불필요** (관리자 권한 없이 됨) | `/dev/hidraw*` 접근 권한 필요 → **udev 규칙 또는 sudo** |
| hidapi 설치 | `pip install` (wheel, 빌드 불필요) | 시스템 라이브러리 설치 후 `pip install` |

> 핵심: **두 환경 모두 hidapi가 venv에 설치돼 있어야** 한다. 설치가 안 되어 있으면
> 서버는 점등 대신 `simulated`(시뮬레이션) 응답만 내고 불은 켜지지 않는다.

진단은 어디서나 동일하게 이 한 줄로 시작한다:
```bash
curl -s http://localhost:8080/led/devices
```
| 응답 | 의미 | 조치 |
| --- | --- | --- |
| `"hidapi": false` | venv에 hidapi 없음 | 설치(1단계) |
| `"match_count": 0` | hidapi 있으나 경광등 미인식 | USB 연결 확인 |
| `"match_count": 1` 인데 클릭 시 503 | 장치는 보이나 열기 실패 = **권한** | (Jetson) udev/sudo |

---

## A. Windows에서 테스트 (sudo/관리자 불필요)

> 검증 완료: 본 PC에서 hidapi 설치 + 장치 연결 상태로 `관심/경고` 클릭 시
> `status: sent` + 실물 점등(점등 시작→완료 로그) 정상 확인됨.

### A-1. hidapi 설치 (최초 1회)
```powershell
# 프로젝트 루트(C:\workspace\kiosk-server)에서
.\.venv\Scripts\pip.exe install hidapi==0.14.0.post4
```
- Windows용 미리 빌드된 wheel이 설치되므로 별도 빌드 도구가 필요 없다.

### A-2. 경광등 USB 연결
- ST80EL-USB(Q-Light)를 USB 포트에 연결한다. Windows가 자동으로 HID 드라이버를
  잡으며 **관리자 권한이 필요 없다.**
- 인식 확인:
  ```powershell
  .\.venv\Scripts\python.exe -c "import hid; print([(hex(d['vendor_id']),hex(d['product_id']),d['product_string']) for d in hid.enumerate() if d['vendor_id']==0x04D8])"
  ```
  → `('0x4d8', '0xe73c', 'Q-Light Lamp HID Device')` 가 보이면 정상.

### A-3. 서버 실행 (일반 권한)
```powershell
# 백엔드 (PORT 8080)
.\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8080
```
- `.env` 의 `KIOSK_LED_DRY_RUN=false` (기본값) 인지 확인. `true`면 점등 안 됨.

### A-4. 키오스크 열기 + 점등
- 프론트(별도 터미널): `.\.venv\Scripts\python.exe -m http.server 8090`
- 브라우저: `http://localhost:8090/kiosk.html`
- "불안전행동 감시 신호등" 카드의 **관심/주의/경고/위험** 칸 클릭.
  - 상단 배지에 `경광등 OO 점등 중…` 표시 + 실물 점등(약 5초)되면 성공.

### A-5. (참고) curl로 직접 점등
```powershell
# 경고(빨강 점멸 5초)
Invoke-RestMethod -Uri http://localhost:8080/led/trigger -Method POST `
  -ContentType "application/json" -Body '{"level":"warning"}'
# → status: sent 이면 점등 시작
```

---

## B. Jetson(Ubuntu)에서 테스트

### B-1. hidapi 설치 (최초 1회)
```bash
sudo apt-get install -y pkg-config libusb-1.0-0-dev libudev-dev
.venv/bin/pip install hidapi==0.14.0.post4
```
> 시스템 전역이 아니라 **서버가 실행되는 venv**에 설치해야 한다.

### B-2. 경광등 USB 연결 + 인식 확인
```bash
lsusb | grep -i 04d8        # 04d8:e73c 가 보이면 연결됨
```

### B-3. 권한 설정 — 둘 중 하나 (Windows와 다른 핵심 단계)

**(B-3-A) udev 규칙 — 권장.** sudo 없이 일반 권한으로 실행 가능.
```bash
sudo cp warning_light_control/99-warning-light.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
# 경광등 USB를 뽑았다 다시 연결
```

**(B-3-B) sudo로 서버 실행 — 빠른 임시 방법.**
```bash
sudo .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### B-4. 서버 실행 + 점등
```bash
# (udev 적용 시) 일반 권한으로 실행
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```
- 키오스크에서 각 칸 클릭 → 실물 점등 확인.
- 권한이 없으면 클릭 시 배지에 **503 권한 안내 메시지**가 뜬다 → B-3 수행.

---

## C. 레벨 ↔ 동작 (공통)

| 칸 | LED 색 | 패턴 |
| --- | --- | --- |
| 관심 | 초록 | 점멸 5초 |
| 주의 | 노랑 | 점멸 5초 |
| 경고 | 빨강 | 점멸 5초 |
| 위험 | 초록→노랑→빨강 | 순차 점멸 루프 5초 |

> "경고"는 UI에선 주황으로 보이지만 실물엔 주황 램프가 없어 **빨강**으로 점등된다.

---

## D. 자주 막히는 지점

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| 클릭해도 배지가 `시뮬(장치 없음)` | venv에 hidapi 미설치 | A-1 / B-1 |
| `/led/devices` 가 `match_count: 0` | 경광등 USB 미연결/인식 실패 | 케이블·포트 변경, 재연결 |
| (Jetson) 클릭 시 `503` | `/dev/hidraw*` 권한 없음 | B-3 (udev 또는 sudo) |
| 항상 `dry_run` 응답 | `KIOSK_LED_DRY_RUN=true` | `.env` 에서 `false` 로 |
| 점등은 됐다는데 불이 안 들어옴 | 경광등 전원/배선 | 장치 자체 전원 확인 |

---

## E. 참고 — 크로스플랫폼 write 수정 이력

초기 통합 시 Windows에서 `partial HID write: 17/8 bytes` 오류로 점등이 실패했다.
Windows hidapi는 출력 리포트를 장치 리포트 길이(17B)로 자동 패딩하고 그 길이를
반환하는데, 원본 `_write()` 가 `written != len(command)` 로 엄격히 검사해
정상 동작을 오류로 처리했기 때문이다(Linux는 정확히 8을 반환해 통과).

→ `warning_light_control/hid_controller.py::_write()` 를 **"요청한 바이트 수 이상
기록되면 성공"**(`written < len(command)` 일 때만 실패)으로 수정했다. Windows/Linux
양쪽에서 동작한다. 원본 모듈을 별도로 유지한다면 이 수정을 함께 반영할 것.
