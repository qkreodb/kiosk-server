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
    # ``/infer`` 는 원시 장면 설명만 반환하므로 사용하지 않는다.
    vlm_base_url: str = "http://localhost:8000"
    vlm_analyze_path: str = "/analyze"
    vlm_infer_path: str = "/infer"  # (참고용, 현재 파이프라인 미사용)
    # ``/analyze`` 가 Jetson 파일시스템에서 읽을 프레임 폴더(절대 경로). 하드웨어
    # 서버가 30fps 프레임을 기록하는 공유 디렉터리를 가리켜야 한다. 기본값은
    # VLM 서버 README의 테스트 폴더.
    vlm_frame_dir: str = "/home/ds/Desktop/vlm_test/frames_448_30"
    # VLM+LLM 2단계 추론은 수 초가 걸리고 NUM_WORKERS=1 이면 큐 대기까지 더해진다.
    vlm_timeout_seconds: float = 60.0
    vlm_force_mock: bool = False

    # --- Shared Dir (30fps frames from the Hardware Server, PORT 8081) ---
    # 하드웨어 서버(kiosk-hardware)의 RTSP 프레임 수집기가 기록하는 폴더.
    shared_dir: Path = Path("../kiosk-hardware/frames")
    frame_glob: str = "frame_*.jpg"

    # --- Shared DB ---
    # Data source selector: "mock" (JSON fixtures / in-memory) or
    # "mysql"/"sql" (real MySQL on the Jetson via SqlRepository). If "mysql" is
    # selected but the DB is unreachable, the app falls back to "mock".
    repository: str = "mysql"
    db_url: str = "mock://in-memory"  # legacy placeholder; unused by SqlRepository.

    # MySQL connection (used only when repository == "mysql"/"sql").
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
    # 누적 불안전행동 카운트가 각 임계값 이상이면 해당 단계로 점등한다.
    # 데모용으로 1/2/3/4 로 낮춤(감지 1회마다 한 단계 상승). 운영 권장값은 3/6/9/12.
    #   0: 소등 / 1: 관심(초록) / 2: 주의(노랑) / 3: 경고(빨강) / 4+: 위험(순차)
    light_interest_threshold: int = Field(default=1, ge=1)   # 관심 (초록 점등)
    light_caution_threshold: int = Field(default=2, ge=1)    # 주의 (노란색 깜빡임)
    light_warning_threshold: int = Field(default=3, ge=1)    # 경고 (빨간색 깜빡임)
    light_danger_threshold: int = Field(default=4, ge=1)     # 위험 (순차 점멸)

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
    def vlm_analyze_url(self) -> str:
        return f"{self.vlm_base_url.rstrip('/')}/{self.vlm_analyze_path.lstrip('/')}"

    @property
    def vlm_infer_url(self) -> str:
        return f"{self.vlm_base_url.rstrip('/')}/{self.vlm_infer_path.lstrip('/')}"


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton ``Settings`` instance."""
    return Settings()
