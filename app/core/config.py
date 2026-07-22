"""Centralized application settings.

All configuration (ports, VLM URL, Shared Dir path, Shared DB URL placeholder,
warning-light thresholds, TTS options) is loaded here from the environment / a
`.env` file. Nothing elsewhere in the app should read `os.environ` directly —
inject `Settings` instead so the whole server is configured from one place.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings, populated from env vars prefixed with ``KIOSK_``."""

    model_config = SettingsConfigDict(
        env_prefix="KIOSK_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- HTTP server ---
    host: str = "0.0.0.0"
    port: int = 8080
    app_name: str = "Kiosk Main Server"
    app_version: str = "1.0.0"

    # --- CORS ---
    # Either "*" or a comma-separated list of origins.
    cors_origins: str = "*"

    # --- External VLM Server (PORT 8000, Jetson Thor) ---
    # 키오스크는 구조화된 결과(action + tts_message)를 주는 ``/analyze`` 를 사용한다.
    vlm_base_url: str = "http://localhost:8000"
    vlm_analyze_path: str = "/analyze"
    # 자유 프롬프트 질의 엔드포인트(신규 CCTV 모달의 실시간 장면 설명용).
    # body: {"path": "<프레임 폴더>", "prompt": "<사용자 입력>"}
    vlm_prompt_path: str = "/prompt"
    # ``/analyze`` 가 Jetson 파일시스템에서 읽을 프레임 폴더(절대 경로). 하드웨어
    # 서버가 30fps 프레임을 기록하는 공유 디렉터리를 가리켜야 한다. 기본값은
    # VLM 서버 README의 테스트 폴더.
    vlm_frame_dir: str = "/home/ds/Desktop/frames"
    # VLM+LLM 2단계 추론은 수 초가 걸리고 NUM_WORKERS=1 이면 큐 대기까지 더해진다.
    vlm_timeout_seconds: float = 60.0

    # --- Shared Dir (30fps frames from the Hardware Server, PORT 8081) ---
    # 하드웨어 서버(kiosk-hardware)의 RTSP 프레임 수집기가 기록하는 폴더.
    shared_dir: Path = Path("../kiosk-hardware/frames")
    frame_glob: str = "frame_*.jpg"

    # --- MQTT (duego/heat 공정별 체감온도 발행) ---
    # kiosk-hardware 가 쓰는 것과 같은 Mosquitto 브로커. 연결은 서버 기동 시
    # 1회만 맺는다(변경 시 재시작 필요 — 다른 host/port 설정과 동일 원칙).
    mqtt_broker_host: str = "localhost"
    mqtt_broker_port: int = 1883

    # --- Danger frames (VLM 서버가 위험 탐지 시 저장한 스냅샷 디렉터리) ---
    # VLM 서버(kiosk-vlm)가 `공정_위반-위반_YYYYMMDD_HHMMSS.png` 형식으로 저장한 사진
    # 폴더. 키오스크는 이 폴더를 읽어 [위험 탐지 사진] 갤러리로 보여준다(읽기 전용).
    # 기본값은 kiosk-vlm 형제 저장소의 danger_frames(운영 배치 기준).
    danger_frames_dir: Path = Path("../kiosk-vlm/danger_frames")

    # --- Live CCTV (IP 카메라 직결 RTSP) ---
    # Shared Dir 파이프라인이 준비되기 전, 키오스크가 IP 카메라의 RTSP 스트림을
    # 서버에서 직접 디코딩(OpenCV/FFmpeg)해 MJPEG 로 브라우저에 중계한다.
    # ``cctv_rtsp_url`` 을 직접 지정하면 그 값을 그대로 쓰고, 비워두면 아래
    # 구성요소(user/password/host/port/path)로 URL 을 조립한다.
    # ⚠ 운영 시 비밀번호는 코드/저장소가 아니라 .env 의 KIOSK_CCTV_PASSWORD 로 둘 것.
    cctv_rtsp_url: str = ""
    cctv_host: str = "172.16.0.243"
    cctv_port: int = 554
    cctv_user: str = "admin"
    cctv_password: str = "ekthf123"
    cctv_stream_path: str = "stream1"
    # RTSP → JPEG 재인코딩 품질(1~100)과 끊겼을 때 재접속 간격(초).
    cctv_jpeg_quality: int = 80
    cctv_reconnect_delay: float = 3.0
    # MJPEG 중계 송출 상한 fps (브라우저로 내보내는 속도; 카메라 fps 와 무관).
    cctv_stream_fps: int = 20

    # --- Shared DB (real MySQL on the Jetson, via SqlRepository) ---
    # 실제 비밀번호는 저장소에 커밋하지 말고 .env 의 KIOSK_DB_PASSWORD 로만 둘 것.
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "dasol"
    db_charset: str = "utf8mb4"
    db_connect_timeout: int = 5

    # --- Dummy/static labels (not present in the ERD) ---
    # The DB has no site/region columns, so these constants label the
    # temp-humid and watch responses when serving from MySQL.
    site_location: str = "경기도 고양시"
    watch_region: str = "고양시사업장"

    # --- TTS ---
    # 합성 엔진 선택: "edge"(온라인, MS Azure) | "piper"(오프라인/폐쇄망).
    # 현장 인터넷이 보장되어 기본값은 edge(한국어 품질 우수). 폐쇄망이면 piper 로.
    tts_engine: str = "edge"
    tts_output_dir: Path = Path("./tts_out")
    tts_enabled: bool = True
    # Optional ALSA device for physical speaker output, e.g. "plughw:J7".
    # When unset, playback uses the OS default audio output through playsound.
    speaker_alsa_device: str = ""

    # Edge TTS 전용(엔진이 edge 일 때) 보이스 이름.
    tts_voice: str = "ko-KR-SunHiNeural"

    # Piper TTS(오프라인). `pip install piper-tts` 시 생성되는 `piper` 실행파일을
    # 사용한다. 음성 모델(.onnx)과 설정(.json)은 저장소에 넣지 말고 장비에 둔다.
    #   - piper_binary    : PATH 의 piper 실행파일(또는 절대경로)
    #   - piper_model_path: ko_KR 음성 모델(.onnx) 경로
    #   - piper_config_path: 생략 시 모델 옆의 같은 이름 .json 을 자동 사용
    #   ※ Piper 공식 카탈로그엔 한국어 음성이 없다. 커뮤니티 KSS 모델을 사용:
    #     https://huggingface.co/neurlang/piper-onnx-kss-korean
    #     (KSS 데이터셋 기반 · 단일 화자 · 데이터셋 라이선스 CC BY-NC-SA 4.0 — 비상업)
    piper_binary: str = "piper"
    piper_model_path: Path = Path("./voices/piper-kss-korean.onnx")
    piper_config_path: Path | None = None

    # --- Warning light (경광등) thresholds ---
    # 탐지된 불안전행동 카운트가 각 임계값 이상이면 해당 단계로 점등한다.
    # 단, 경광등은 "이번 분석 사이클에 VLM 탐지 결과가 존재할 때"만 발동하며
    # (vlm_service.infer 참고), 카운트 단독으로는 울리지 않는다.
    #   count<10    : 소등
    #   10<=count<20: 관심(초록)   — 첫 탐지부터가 아니라 10회 이상부터 초록
    #   20<=count<40: 주의(노랑)
    #   40<=count<50: 경고(빨강)
    #   count>=50   : 위험(점멸 — 색상 교번 반복)
    # 아래 값은 런타임 기준치의 *초기 시드값*일 뿐이다. 서버는 부팅 후
    # ``light_threshold_file`` (JSON)에서 실제 기준치를 읽고, 키오스크의 [기준치]
    # 패널이 PUT /led/thresholds 로 이 파일을 갱신한다(신호등 UI와 실물 경광등이
    # 같은 값을 공유). 즉 .env 값은 파일이 아직 없을 때(최초 1회)만 사용된다.
    light_interest_threshold: int = Field(default=10, ge=1)   # 관심 (초록 점등)
    light_caution_threshold: int = Field(default=20, ge=1)    # 주의 (노란색)
    light_warning_threshold: int = Field(default=40, ge=1)    # 경고 (빨간색)
    light_danger_threshold: int = Field(default=50, ge=1)     # 위험 (순차 점멸)
    # 런타임에 조정되는 기준치를 영속화할 JSON 파일. .env 가 아니라 이 파일이
    # 실제 단일 소스(single source of truth)다.
    light_threshold_file: Path = Path("./light_thresholds.json")

    # --- 불안전행동 디바운스(쿨다운) ---
    # VLM 분석이 루프로 반복되며 같은 행동이 연속 감지될 때 TTS 중첩·DB 카운트
    # 급증을 막는다. 5가지 행동 각각에 대해 완전히 독립적으로 적용되는 쿨다운(초):
    # 한 행동이 카운트되면 이 시간 동안 같은 행동의 재카운트·TTS·경광등을 무시하고,
    # 만료 후 재감지되면 다시 카운트한다(vlm_service.infer 참고).
    behavior_cooldown_seconds: float = Field(default=3.0, ge=0)

    # 플리커(왔다갔다) 억제: 같은 판정이 이 횟수만큼 '연속'돼야 위반 상태를 켜거나 끈다
    # (켜짐/꺼짐 대칭). 한두 프레임 튀는 노이즈를 흡수하고 진짜 변화만 반영한다. 대가로
    # 경보가 (횟수-1)×감지사이클 만큼 늦어진다. 1이면 비활성(매 프레임 즉시 반영).
    behavior_debounce_frames: int = Field(default=2, ge=1)

    # --- VLM 서버 측 분석 스케줄러 (브라우저 없이 다중 카메라 순회 분석) ---
    # 한 사이클(모든 카메라 순차 분석) 이후 다음 사이클까지 대기(초).
    vlm_scheduler_interval_seconds: float = Field(default=2.0, ge=0)
    # True 면 서버 부팅 시 스케줄러를 자동 시작한다(기본은 수동 start).
    vlm_scheduler_autostart: bool = False

    # --- Warning light LED (실물 경광등, ST80EL-USB HID) ---
    # ``led_dry_run=False`` 이면 실제 HID 장치로 전송을 시도하고, hidapi 미설치/
    # 장치 미연결이면 자동으로 시뮬레이션(simulated) 응답으로 폴백한다. Jetson에
    # 장치가 연결돼 있으면 별도 설정 없이 그대로 실물 LED가 동작한다.
    led_dry_run: bool = False
    led_vendor_id: int = 0x04D8
    led_product_id: int = 0xE73C

    # --- Logging ---
    log_level: str = "INFO"

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        """CORS origins as a list (``["*"]`` for permissive)."""
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cctv_rtsp_target(self) -> str:
        """Effective RTSP URL: explicit override, else assembled from parts.

        예) rtsp://admin:ekthf123@172.16.0.243:554/stream1
        """
        if self.cctv_rtsp_url.strip():
            return self.cctv_rtsp_url.strip()
        return (
            f"rtsp://{self.cctv_user}:{self.cctv_password}"
            f"@{self.cctv_host}:{self.cctv_port}/{self.cctv_stream_path.lstrip('/')}"
        )

    @property
    def vlm_analyze_url(self) -> str:
        return f"{self.vlm_base_url.rstrip('/')}/{self.vlm_analyze_path.lstrip('/')}"

    @property
    def vlm_prompt_url(self) -> str:
        return f"{self.vlm_base_url.rstrip('/')}/{self.vlm_prompt_path.lstrip('/')}"


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton ``Settings`` instance."""
    return Settings()
