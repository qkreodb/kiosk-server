# Kiosk Main Server (PORT 8080)

FastAPI backend for the industrial **safety & health monitoring kiosk** — the
**"Kiosk Back section (PORT 8080)"** from the architecture diagram (`001.png`).

It serves the existing 1080×1920 kiosk frontend (`kiosk.html`) by:

1. Querying the **Shared DB** (MySQL on the Jetson, behind a swappable repository interface).
2. Reading the latest **30fps frame** from the **Shared Dir** (written by the Hardware Server).
3. Calling the external **VLM Server** `/infer` endpoint and post-processing the result
   (**TTS → speaker** + **DB count → warning-light control signal**).

> This repo implements **only** the Kiosk Main Server. The Hardware Server (8081) and
> VLM Server (8000) are external — only a **client** to the VLM `/infer` endpoint exists here.

---

## Quick start

```bash
# 1) Create a venv and install deps
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux

# 2) (optional) copy env defaults
copy .env.example .env        # Windows
# cp .env.example .env         # macOS/Linux

# 3) Run on PORT 8080
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080
# or: python -m app.main
```

- Swagger UI: <http://localhost:8080/docs>
- Health:     <http://localhost:8080/health>

### Real sensor DB mode

To show the temperature/humidity and Galaxy Watch heart-rate values written by
`kiosk-hardware`, run with the shared MariaDB settings:

```powershell
$env:KIOSK_REPOSITORY="mysql"
$env:KIOSK_DB_HOST="127.0.0.1"
$env:KIOSK_DB_PORT="3306"
$env:KIOSK_DB_USER="root"
$env:KIOSK_DB_PASSWORD="ekthf123"
$env:KIOSK_DB_NAME="dasol"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080
```

The kiosk screen reads these backend endpoints:

```text
GET /sensor/temp-humid
GET /sensor/watch
```

### Live CCTV frame mode

The center-hall CCTV marker reads the MJPEG feed from `GET /cctv/stream`.
Start the RTSP frame collector in the hardware repo so it keeps writing
fresh `../kiosk-hardware/frames/frame_*.jpg` files:

```powershell
cd ..\kiosk-hardware
..\.venv\Scripts\python.exe rtsp_frame.py
```

---

## Endpoints

| Method | Path                  | Purpose |
|--------|-----------------------|---------|
| GET    | `/health`             | Liveness + active config summary |
| GET    | `/space-name`         | 공정 정보: 이름/코드, 4개 불안전행동 카운트, 온습도, CCTV (`?process_code=PRC-19`) |
| GET    | `/sensor/temp-humid`  | 온습도 센서 데이터 (`?process_code=` optional) |
| GET    | `/sensor/watch`       | 갤럭시워치 심박 데이터 (정상/주의/위험) |
| GET    | `/modal/msds`         | MSDS 화학물질 목록 + 상세 |
| GET    | `/modal/risk`         | 위험성평가 표 + 요약 (`?process_code=PRC-19`) |
| GET    | `/cctv/frame`         | Shared Dir 최신 프레임 (JPEG). 없으면 placeholder |
| GET    | `/cctv/stream`        | 연속 MJPEG-over-HTTP 스트림 (보너스) |
| POST   | `/vlm/infer`          | VLM 위험장면 분석 파이프라인 |

### `POST /vlm/infer` pipeline

`{ "camera_id": "CAM-03", "process_code": "PRC-19" }` →

1. Call VLM Server `/infer` (offline → built-in mock).
2. **Branch A**: `위험 경고 텍스트` → Edge TTS → speaker actuator (stubbed playback).
3. **Branch B**: `탐지` → parse into the 4 불안전행동 categories → increment DB counts →
   read resulting count → generate **경광등** control signal from thresholds → dispatch.
4. Return detection, labels, warning text, behavior deltas+counts, warning-light signal, TTS status.

Example: when a category's cumulative count reaches the caution threshold (default **3**),
the signal becomes **`노란색 볼 깜빡임`** (yellow beacon blinking) — matching the diagram.

---

## Architecture

```
router → Pydantic validation → service → repository / integration → response DTO
```

```
app/
  main.py                 # app factory, CORS, routers, lifespan, /health
  core/config.py          # all settings from env/.env (one place)
  core/logging.py
  domain/constants.py     # 4 불안전행동 categories, 경광등 states
  schemas/                # Pydantic DTOs per domain
  repositories/           # base interface + SqlRepository (MySQL) + factory (DB seam)
  integrations/           # vlm_client, tts, shared_dir, actuators
  services/               # business logic incl. VLM pipeline orchestration
  api/routers/            # space, sensor, modal, cctv, vlm, health
docs/진행상황.md          # Korean progress document
```

## External dependencies (operational build)

| Concern        | Implementation                                | Configuration |
|----------------|-----------------------------------------------|---------------|
| Shared DB      | `repositories/sql_repository.py` (MySQL on Jetson) | `KIOSK_DB_*` — boot fails if unreachable |
| VLM Server     | `integrations/vlm_client.py` HTTP client      | `KIOSK_VLM_BASE_URL`; client posts to real `/analyze` |
| TTS playback   | Edge TTS file synth → `actuators.py::SpeakerActuator.play` (playsound) | `KIOSK_TTS_*` |
| Warning light  | `actuators.py::WarningLightActuator` signal + `led_service` (HID) | `KIOSK_LED_*` |
| Shared Dir     | `integrations/shared_dir.py` (latest frame)   | `KIOSK_SHARED_DIR` → real frame dir |

데이터 중 ERD에 컬럼이 없는 항목(MSDS·위험성평가·워치 명부)은 `repositories/dummy_data.py`
에서 고정값으로 제공한다.

All configuration lives in `app/core/config.py` (env prefix `KIOSK_`); see `.env.example`.

> **Note on TTS in offline/headless environments:** when `KIOSK_TTS_ENABLED=true`, the
> server attempts real Edge TTS synthesis (needs internet). With no network it reports
> `tts.status = "failed"` and the pipeline still completes — set `KIOSK_TTS_ENABLED=false`
> to skip synthesis entirely (`"stubbed"`).
