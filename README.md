# Kiosk Main Server (PORT 8080)

FastAPI backend for the industrial **safety & health monitoring kiosk** — the
**"Kiosk Back section (PORT 8080)"** from the architecture diagram (`001.png`).

It serves the existing 1080×1920 kiosk frontend (`kiosk.html`) by:

1. Querying the **Shared DB** (mocked here, behind a swappable repository interface).
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

### Smoke test (no external servers needed)

```bash
.\.venv\Scripts\python.exe smoke_test.py
```

Runs every endpoint through FastAPI's `TestClient` using the **offline VLM mock**
(`KIOSK_VLM_FORCE_MOCK=true`) and prints a `[PASS]` line per endpoint.

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
  repositories/           # base interface + mock impl + factory (DB seam)
  integrations/           # vlm_client, tts, shared_dir, actuators (all stubbable)
  services/               # business logic incl. VLM pipeline orchestration
  api/routers/            # space, sensor, modal, cctv, vlm, health
mock_data/                # JSON fixtures simulating Shared DB rows
docs/진행상황.md          # Korean progress document
```

## What is mocked (and where the real piece plugs in)

| Concern        | Mock today                                   | Real swap-in point |
|----------------|----------------------------------------------|--------------------|
| Shared DB      | `repositories/mock_repository.py` (+fixtures) | Implement `KioskRepository`, select it in `repositories/factory.py` |
| VLM Server     | `integrations/vlm_client.py` offline stub    | Set `KIOSK_VLM_BASE_URL`; client posts to real `/infer` |
| TTS playback   | Edge TTS file synth; speaker = log stub       | `integrations/actuators.py::SpeakerActuator.play` |
| Warning light  | `actuators.py::WarningLightActuator` log stub | GPIO/relay/serial write |
| Shared Dir     | placeholder JPEG when empty                   | Point `KIOSK_SHARED_DIR` at the real frame dir |

All configuration lives in `app/core/config.py` (env prefix `KIOSK_`); see `.env.example`.

> **Note on TTS in offline/headless environments:** when `KIOSK_TTS_ENABLED=true`, the
> server attempts real Edge TTS synthesis (needs internet). With no network it reports
> `tts.status = "failed"` and the pipeline still completes — set `KIOSK_TTS_ENABLED=false`
> to skip synthesis entirely (`"stubbed"`).
