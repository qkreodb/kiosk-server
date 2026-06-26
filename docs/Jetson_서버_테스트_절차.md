# Jetson 실서버 테스트 절차 (git clone → 웹 동작 확인) — 2026-06-23

Jetson(Thor, aarch64 Ubuntu)에서 kiosk-server를 **git에서 내려받아** 직접 띄우고,
브라우저로 키오스크 웹을 열어 실제 동작을 확인하는 전체 절차.

> **이 Jetson IP = `172.16.0.62`**, **DB명 = `dasol`** (아래 명령/URL에 반영됨).

> 한눈 요약: **clone → venv+설치 → .env 작성 → (DB/LED/TTS 준비) → uvicorn 실행 →
> 브라우저로 `http://172.16.0.62:8080/kiosk.html`**. 프론트는 백엔드가 직접 서빙하므로
> 별도 정적 서버가 필요 없다.

권장: **2단계로 진행**한다.
- **1단계(빠른 확인)**: mock 모드로 띄워 웹/화면/버튼이 뜨는지 먼저 확인 (DB·VLM 없이).
- **2단계(실연동)**: VLM·LED·실센서 DB를 차례로 켜며 실제 동작 확인.

---

## 0. 사전 확인 (Jetson에 이미 있는 것)

| 항목 | 확인 명령 | 비고 |
|---|---|---|
| Python 3.12 | `python3.12 --version` | 없으면 `sudo apt install python3.12 python3.12-venv` |
| git | `git --version` | |
| VLM 서버 | `curl -s http://localhost:8000/health` | Jetson에서 이미 구동 중이어야 함(`/analyze` 보유 빌드) |
| 경광등(LED) | `lsusb \| grep -i 04d8` | `04d8:e73c` 보이면 연결됨 |
| 스피커 | 유선 연결 | TTS는 **이 Jetson의 오디오 출력**으로 나온다 |
| DB(선택) | `mysql -uroot -p -e "SHOW DATABASES;"` | `dasol` 사용 시. 없으면 mock 폴백 |

---

## 1. 클론 + 브랜치

```bash
cd ~                      # 원하는 작업 경로
git clone https://github.com/qkreodb/kiosk-server.git
cd kiosk-server
git checkout develop-kiosk
git pull origin develop-kiosk
```

> `kiosk-hardware`(센서/RTSP 수집 서버)도 쓰려면 같은 상위 폴더에 함께 두면
> 기본 프레임 경로(`../kiosk-hardware/frames`)가 맞는다.

---

## 2. 가상환경 + 의존성 설치

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

`requirements.txt` 에는 **hidapi(LED)** 가 없다(플랫폼별 설치). LED를 쓸 거면 4단계에서 따로 설치.

---

## 3. `.env` 작성

저장소에는 `.env` 가 없다(개인 설정/비밀번호라 git 제외). 템플릿에서 복사 후 수정한다.

```bash
cp .env.example .env
nano .env      # 또는 vi
```

Jetson 기준 핵심 값:

```bash
# VLM 은 같은 Jetson에서 도므로 localhost
KIOSK_VLM_BASE_URL=http://localhost:8000
KIOSK_VLM_ANALYZE_PATH=/analyze
KIOSK_VLM_FRAME_DIR=/home/ds/Desktop/vlm_test/frames_448_30   # 실제 프레임 폴더로
KIOSK_VLM_FORCE_MOCK=false                                    # 실제 VLM 사용

# 데이터 소스: 1단계는 mock, 2단계에서 mysql
KIOSK_REPOSITORY=mock
KIOSK_DB_HOST=127.0.0.1
KIOSK_DB_PORT=3306
KIOSK_DB_USER=root
KIOSK_DB_PASSWORD=ekthf123          # 실제 비밀번호 (이 파일은 git에 안 올라감)
KIOSK_DB_NAME=dasol

# 공유 프레임 폴더(라이브 CCTV용)
KIOSK_SHARED_DIR=../kiosk-hardware/frames

# 실물 경광등 점등
KIOSK_LED_DRY_RUN=false

# 경광등 임계값 (현재 기본 1/2/3/4 = 데모용. 운영은 3/6/9/12 권장)
KIOSK_LIGHT_INTEREST_THRESHOLD=1
KIOSK_LIGHT_CAUTION_THRESHOLD=2
KIOSK_LIGHT_WARNING_THRESHOLD=3
KIOSK_LIGHT_DANGER_THRESHOLD=4
```

---

## 4. (LED 쓸 때) hidapi 설치 + 권한

```bash
# 시스템 라이브러리
sudo apt-get install -y pkg-config libusb-1.0-0-dev libudev-dev
# venv 에 설치
pip install hidapi==0.14.0.post4
```

`/dev/hidraw*` 접근 권한 — 둘 중 하나:

```bash
# (권장) udev 규칙: sudo 없이 일반 실행 가능
sudo cp warning_light_control/99-warning-light.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
# 경광등 USB를 뺐다 다시 연결

# (임시) sudo 로 서버 실행 — 4단계 udev 생략 시
```

확인: `curl -s http://localhost:8000/health` 와 별개로, 서버 띄운 뒤
`curl -s http://localhost:8080/led/devices` 로 `hidapi:true`, `match_count:1` 확인.
자세히는 [[LED_테스트_가이드]](LED_테스트_가이드.md) B절 참고.

---

## 5. (TTS 쓸 때) 오디오 백엔드

`playsound` 는 Linux에서 GStreamer 를 사용한다. 소리가 안 나면:

```bash
sudo apt-get install -y python3-gi gstreamer1.0-tools gstreamer1.0-plugins-good gstreamer1.0-alsa
# 스피커가 기본 출력 장치인지 확인
aplay -l            # 장치 목록
speaker-test -t wav -c 2   # 테스트음
```

TTS(Edge TTS)는 **인터넷 연결**이 필요하다(Microsoft 서버 합성).

---

## 6. (mysql 모드) DB 준비 — 2단계에서만

`KIOSK_REPOSITORY=mysql` 로 쓸 때만. dasol DB가 이미 있으면 생략.

```bash
# 스키마/시드 적재(처음 한 번)
mysql -uroot -p dasol < db/schema.sql
mysql -uroot -p dasol < db/seed.sql
# 연결 점검
mysql -uroot -p dasol -e "SELECT COUNT(*) FROM process;"
```

DB가 없거나 연결 실패하면 서버는 **자동으로 mock 으로 폴백**(경고 로그)하므로 웹 자체는 뜬다.

---

## 7. 서버 실행

```bash
source .venv/bin/activate     # (새 터미널이면)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
# udev 생략하고 LED를 sudo로 쓸 경우:
#   sudo .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

기동 로그에 `repo=... | vlm=http://localhost:8000/analyze | shared_dir=...` 가 보이면 정상.
`--host 0.0.0.0` 이라 다른 PC에서도 접속 가능.

---

## 8. 브라우저로 웹 확인

- **Jetson 본체**: `http://localhost:8080/kiosk.html`
- **다른 PC/태블릿**: `http://172.16.0.62:8080/kiosk.html`  (이 Jetson IP)

> 프론트는 접속한 호스트의 `:8080` 을 API로 자동 인식하므로, IP로 열면 그 IP의 백엔드를 부른다.
> 별도 포트(:8090) 정적 서버 필요 없음.

먼저 API 단독 확인:
```bash
curl -s http://localhost:8080/health
curl -s http://localhost:8080/         # {"kiosk":"/kiosk.html", ...}
```

---

## 9. 동작 확인 체크리스트

| # | 확인 | 방법 | 정상 |
|---|---|---|---|
| 9-1 | 페이지 로드 | 브라우저로 `/kiosk.html` | 상단 배지 "백엔드 연결됨", 신호등 행렬 표시 |
| 9-2 | 경광등 수동 | 신호등 카드 **관심/주의/경고/위험 칸 클릭** | 실물 LED 색상 점등(약 5초). DB·VLM 무관하게 동작 |
| 9-3 | VLM 분석 | CCTV 모달 **[분석]** 버튼 | 오버레이에 탐지/경고/경광등/음성 표시. `source=vlm` |
| 9-4 | TTS | [분석] 시 경고문 존재하면 | 유선 스피커로 음성 재생, 오버레이 "🔊 재생 중" |
| 9-5 | 자동 LED | [분석] 반복 → 카운트 임계값(1/2/3/4) 도달 | 단계별 실물 LED 점등 |
| 9-6 | 센서 | `curl /sensor/temp-humid`, `/sensor/watch` | (mysql 모드) 실측값, (mock) 더미값 |
| 9-7 | 라이브 CCTV | 중앙 전시홀 CCTV | `kiosk-hardware`의 `rtsp_frame.py` 가 프레임 기록 중이면 MJPEG 표시 |

> **카운트가 안 올라가 LED가 안 켜질 때**: 현재 프레임을 VLM이 미감지(`action=""`)하면 카운트가
> 안 오른다. 빠른 시연은 `.env` 의 `KIOSK_VLM_FORCE_MOCK=true`(가짜 감지 생성)로 [분석]마다
> 카운트 +1 → 단계 상승 확인. 상세: [[데모_임시설정_정리]](데모_임시설정_정리.md).

---

## 10. 자주 막히는 지점

| 증상 | 원인 | 해결 |
|---|---|---|
| 페이지는 뜨는데 배지 "오프라인" | 백엔드 미기동/포트 차단 | 7단계 재확인, 방화벽 `sudo ufw allow 8080` |
| LED 안 켜짐(수동도) | hidapi 미설치/권한 | 4단계(udev 또는 sudo), `/led/devices` 로 진단 |
| LED 응답 `simulated` | venv에 hidapi 없음 | `pip install hidapi` |
| LED 응답 503 | `/dev/hidraw*` 권한 | udev 규칙 적용 또는 sudo 실행 |
| [분석] `source=mock` | VLM 연결 실패 | `KIOSK_VLM_BASE_URL`, `curl localhost:8000/health` |
| 자동 LED 단계 안 오름 | VLM 미감지(action="") | FORCE_MOCK=true 또는 감지되는 프레임 |
| TTS 무음 | 오디오 백엔드/스피커/인터넷 | 5단계, `speaker-test`, 인터넷 확인 |
| 센서 더미만 | DB 미연결 → mock 폴백 | 6단계, 서버 기동 로그의 repository=mock 경고 확인 |
| CCTV 검은 화면 | 프레임 폴더 비어있음 | `kiosk-hardware/rtsp_frame.py` 실행, `KIOSK_SHARED_DIR` 확인 |

---

## 11. 참고 문서
- [[하드웨어_통합_병합]](하드웨어_통합_병합.md) — kiosk-hardware 연동 병합 내역
- [[LED_테스트_가이드]](LED_테스트_가이드.md) — 경광등 환경별 상세
- [[진행상황]](진행상황.md) — 전체 기능/엔드포인트
- [[데모_임시설정_정리]](데모_임시설정_정리.md) — 데모용 설정 원복 체크리스트
