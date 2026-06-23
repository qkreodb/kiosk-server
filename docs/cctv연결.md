# 중앙 전시홀 실시간 CCTV 연동 (RTSP → MJPEG)

키오스크의 **중앙 전시홀** 아이콘을 클릭하면 IP 카메라의 **RTSP 실시간 영상**이
모달에 송출된다. 이 문서는 그 연동 방식과 코드 위치, 설정, 추후 확장(프레임 단위
VLM 분석) 방향을 정리한다.

작성일: 2026-06-23

---

## 1. 왜 이렇게 했나 (배경)

- 원래 계획은 하드웨어 서버(PORT 8081)가 Shared Dir 에 기록한 30fps 프레임을
  키오스크가 읽어 보여주는 것이었다(`/cctv/frame`, `/cctv/stream`).
- 그 파이프라인이 아직 준비 전이라, **당장 화면에 띄우기 위해** IP 카메라의
  RTSP 스트림을 키오스크 서버가 **직접 디코딩**해 중계하도록 했다.
- **브라우저는 RTSP 를 직접 재생할 수 없다.** 그래서 서버가
  `RTSP → JPEG 프레임 → MJPEG(multipart/x-mixed-replace)` 로 변환해
  `<img>` 태그로 흘려보낸다.
- 이 구조는 **프레임 단위**로 영상을 다루므로, 추후 같은 프레임을 그대로
  VLM 분석에 넘기기 쉽다(아래 6장).

```
[IP 카메라]  --RTSP-->  [키오스크 서버 8080]  --MJPEG over HTTP-->  [브라우저 <img>]
 172.16.0.243           OpenCV(FFmpeg) 디코딩        /cctv/live
   /stream1             → JPEG 재인코딩
```

---

## 2. 카메라 정보 / RTSP URL

| 항목     | 값              |
| -------- | --------------- |
| IP       | `172.16.0.243`  |
| Port     | `554` (RTSP 기본) |
| ID       | `admin`         |
| Password | `ekthf123`      |
| Stream   | `stream1`       |

조립되는 RTSP URL:

```
rtsp://admin:ekthf123@172.16.0.243:554/stream1
```

> ⚠ **보안**: 데모를 위해 기본값을 코드(`app/core/config.py`)에 넣어 두었지만,
> 운영 시에는 비밀번호를 저장소에 커밋하지 말고 `.env` 의
> `KIOSK_CCTV_PASSWORD`(또는 전체 `KIOSK_CCTV_RTSP_URL`)로만 두는 것을 권장한다.

---

## 3. 동작 흐름

### 프론트엔드 (`kiosk.html`)

1. **사업장(현장) 온습도 현황** 카드에서 상단 토글의 **CCTV** 버튼을 누르면
   천장 카메라 마커들이 표시된다(`switchSiteView('cctv', …)`).
2. **중앙 전시홀** 카메라 마커(`CAM-05 · 중앙 전시홀`)를 클릭하면
   `openCCTVFor('CAM-05 · 중앙 전시홀')` 가 호출된다.
3. `openCCTVFor()` 는 `isCentralCctv(region)` 로 중앙 전시홀을 식별하고,
   YouTube 임베드(`<iframe>`) 대신 **라이브 이미지 스트림**(`<img id="cctvImage">`)
   을 띄운다. 소스 URL 은 `cctvLiveSrc()` → `<API_BASE>/cctv/live`.
4. 모달을 닫으면(`closeCCTV()`) `image.src = ''` 로 비워 MJPEG 연결을 끊는다
   (서버 스트림 제너레이터도 함께 취소됨).

> 사이즈: 화면 박스 `.cctv-screen` 은 `aspect-ratio: 16/9`, 이미지 `.cctv-image`
> 는 `object-fit: contain` + 검은 배경이라 비율 왜곡 없이 전체 장면이 보인다.

### 백엔드 (FastAPI, PORT 8080)

| 엔드포인트            | 설명                                            |
| -------------------- | ----------------------------------------------- |
| `GET /cctv/live`       | RTSP → **연속 MJPEG** 스트림 (브라우저 `<img>` 용) |
| `GET /cctv/live/frame` | RTSP → **최신 1프레임**(JPEG) — 폴링/VLM 분석용     |
| `GET /cctv/stream`     | (기존) Shared Dir 프레임 MJPEG 스트림              |
| `GET /cctv/frame`      | (기존) Shared Dir 최신 1프레임                    |

`RtspCamera`(`app/integrations/rtsp_stream.py`)가 **백그라운드 스레드**로
카메라에서 계속 프레임을 읽어 **최신 한 장만** 메모리에 유지한다(지연 최소화).
요청 핸들러는 그 최신 프레임을 복사해 내보낸다.

- **지연 시작(lazy start)**: 첫 `/cctv/live` 요청 시 스레드가 시작된다. 부팅 때
  카메라가 꺼져 있어도 서버 기동을 막지 않는다.
- **자동 재접속**: 연결 실패/끊김 시 `KIOSK_CCTV_RECONNECT_DELAY`(기본 3초)
  간격으로 재시도한다.
- **연결 대기 중**에는 placeholder JPEG 을 흘려보내 화면이 깨지지 않게 한다.
- **TCP 강제**: `OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp` 로 UDP 기본값
  보다 안정적으로 받는다.

---

## 4. 설정 (`.env` / `app/core/config.py`)

| 환경변수                       | 기본값          | 설명                                  |
| ----------------------------- | --------------- | ------------------------------------- |
| `KIOSK_CCTV_RTSP_URL`         | (빈값)          | 직접 지정 시 그대로 사용(우선)         |
| `KIOSK_CCTV_HOST`             | `172.16.0.243`  | 카메라 IP                             |
| `KIOSK_CCTV_PORT`             | `554`           | RTSP 포트                             |
| `KIOSK_CCTV_USER`             | `admin`         | 계정                                  |
| `KIOSK_CCTV_PASSWORD`         | `ekthf123`      | 비밀번호(운영 시 .env 로만)            |
| `KIOSK_CCTV_STREAM_PATH`      | `stream1`       | 스트림 경로                           |
| `KIOSK_CCTV_JPEG_QUALITY`     | `80`            | RTSP→JPEG 재인코딩 품질(1~100)         |
| `KIOSK_CCTV_RECONNECT_DELAY`  | `3.0`           | 재접속 간격(초)                       |
| `KIOSK_CCTV_STREAM_FPS`       | `20`            | 브라우저로 내보내는 MJPEG 상한 fps     |

`KIOSK_CCTV_RTSP_URL` 을 비워두면 나머지 구성요소로
`rtsp://user:pass@host:port/path` 를 조립한다(`Settings.cctv_rtsp_target`).

---

## 5. 의존성 / 실행

```bash
# 1) 의존성 (requirements.txt 에 포함됨)
#    opencv-python-headless 는 FFmpeg 를 내장하므로 시스템 ffmpeg 설치 불필요.
pip install -r requirements.txt

# 2) 서버 실행
uvicorn app.main:app --port 8080
# 또는
python -m app.main

# 3) 키오스크 열기 → CCTV 토글 → 중앙 전시홀 클릭
#    http://localhost:8080/kiosk.html
```

빠른 확인:

```bash
# 최신 프레임 1장 저장
curl -s http://localhost:8080/cctv/live/frame -o frame.jpg
# 응답 헤더 X-Frame-Source: rtsp(연결됨) / placeholder(연결 대기)
```

> OpenCV(`cv2`)가 없거나 import 실패하면 라이브 CCTV 만 비활성화되고
> placeholder 가 나가며, 서버의 나머지 기능은 정상 동작한다.

---

## 6. 추후 확장 — 프레임 단위 VLM 분석

현재 구조는 이미 **프레임 단위**(JPEG)로 영상을 다룬다. 다음 단계 예시:

1. `GET /cctv/live/frame` 또는 `RtspCamera.latest()` 로 최신 JPEG 을 주기적으로
   꺼내 VLM 서버(`/analyze`, PORT 8000)로 전송.
2. 또는 `RtspCamera` 가 유지하는 `frame_id` 를 기준으로 N프레임마다 1장 샘플링해
   분석 큐에 넣기(중복 분석 방지).
3. 분석 결과(탐지/경고/경광등/음성)를 CCTV 모달의 VLM 오버레이
   (`#cctvVlmOverlay`)에 표시 — 이미 마련된 UI 를 재사용.

즉, Shared Dir 가 준비되면 소스만 교체하면 되고, RTSP 직결도 그대로
프레임 공급원으로 쓸 수 있다.

---

## 7. 관련 코드 위치

| 파일                                   | 역할                                         |
| ------------------------------------- | -------------------------------------------- |
| `app/integrations/rtsp_stream.py`     | `RtspCamera` — 백그라운드 RTSP 프레임 리더    |
| `app/services/cctv_service.py`        | `live_frame()` / `live_latest()` 비즈니스 로직 |
| `app/api/routers/cctv.py`             | `/cctv/live`, `/cctv/live/frame` 엔드포인트    |
| `app/api/deps.py`                     | `_rtsp_camera()` 싱글톤 + 서비스 배선         |
| `app/core/config.py`                  | `cctv_*` 설정 + `cctv_rtsp_target` 빌더        |
| `kiosk.html` `openCCTVFor()` / `cctvLiveSrc()` | 중앙 전시홀 → 라이브 스트림 연결        |
