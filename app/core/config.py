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

    # --- TTS (Edge TTS) ---
    tts_voice: str = "ko-KR-SunHiNeural"
    tts_output_dir: Path = Path("./tts_out")
    tts_enabled: bool = True

    # --- Warning light (경광등) thresholds ---
    # 탐지된 불안전행동 카운트가 각 임계값 이상이면 해당 단계로 점등한다.
    # 단, 경광등은 "이번 분석 사이클에 VLM 탐지 결과가 존재할 때"만 발동하며
    # (vlm_service.infer 참고), 카운트 단독으로는 울리지 않는다.
    #   count==0   : 소등
    #   1<=count<5 : 관심(초록)   — 첫 탐지(count==1)부터 초록 유지
    #   5<=count<10: 주의(노랑)
    #   10<=count<15: 경고(빨강)
    #   count>=15  : 위험(점멸 — 색상 교번 반복)
    light_interest_threshold: int = Field(default=1, ge=1)    # 관심 (초록 점등)
    light_caution_threshold: int = Field(default=5, ge=1)     # 주의 (노란색)
    light_warning_threshold: int = Field(default=10, ge=1)    # 경고 (빨간색)
    light_danger_threshold: int = Field(default=15, ge=1)     # 위험 (순차 점멸)

    # --- 불안전행동 디바운스(쿨다운) ---
    # VLM 분석이 루프로 반복되며 같은 행동이 연속 감지될 때 TTS 중첩·DB 카운트
    # 급증을 막는다. 5가지 행동 각각에 대해 완전히 독립적으로 적용되는 쿨다운(초):
    # 한 행동이 카운트되면 이 시간 동안 같은 행동의 재카운트·TTS·경광등을 무시하고,
    # 만료 후 재감지되면 다시 카운트한다(vlm_service.infer 참고).
    behavior_cooldown_seconds: float = Field(default=5.0, ge=0)

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


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton ``Settings`` instance."""
    return Settings()
