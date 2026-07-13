"""FastAPI dependency providers.

Wires the layered architecture together: settings -> repository/integrations ->
services. Singletons (repository, integrations) are cached; services are thin
and constructed per request around the cached singletons.
"""

from __future__ import annotations

import threading
from functools import lru_cache

from app.core.config import Settings, get_settings
from app.integrations.actuators import SpeakerActuator, WarningLightActuator
from app.integrations.rtsp_stream import RtspCamera
from app.integrations.shared_dir import SharedDirReader
from app.integrations.tts import TtsService
from app.integrations.vlm_client import VlmClient
from app.repositories.base import KioskRepository
from app.repositories.factory import get_repository
from app.services.cctv_service import CctvService
from app.services.danger_service import DangerFrameService
from app.services.led_service import LedService
from app.services.modal_service import ModalService
from app.services.sensor_service import SensorService
from app.services.space_service import SpaceService
from app.services.threshold_store import LightThresholdStore
from app.services.vlm_service import VlmService


# --- Cached integration singletons ---
@lru_cache
def _vlm_client() -> VlmClient:
    return VlmClient(get_settings())


@lru_cache
def _tts_service() -> TtsService:
    return TtsService(get_settings())


@lru_cache
def _shared_dir_reader() -> SharedDirReader:
    return SharedDirReader(get_settings())


@lru_cache
def _rtsp_camera() -> RtspCamera:
    """.env 기반 단일 카메라(폴백). DB 에 카메라가 없을 때만 사용."""
    settings = get_settings()
    return RtspCamera(
        settings.cctv_rtsp_target,
        jpeg_quality=settings.cctv_jpeg_quality,
        reconnect_delay=settings.cctv_reconnect_delay,
    )


# cam_id -> RtspCamera 레지스트리(공정별 여러 대 대응). DB rtsp_url 을 소스로 하고,
# IP 변경(rtsp_url 갱신) 시 set_url() 로 재접속한다.
_rtsp_cameras: dict[str, RtspCamera] = {}
_rtsp_cameras_lock = threading.Lock()


def rtsp_camera_for(cam_id: str | None) -> RtspCamera | None:
    """cam_id 의 RTSP 카메라를 DB rtsp_url 기준으로 반환(없으면 .env 기본으로 폴백).

    같은 cam_id 는 인스턴스를 재사용하고, DB 의 rtsp_url 이 바뀌었으면 재접속한다.
    """
    if not cam_id:
        return _rtsp_camera()
    try:
        cam = get_repository().get_camera(cam_id)
    except Exception:  # noqa: BLE001 — 조회 실패 시 기본 카메라로 폴백
        cam = None
    url = (cam or {}).get("rtsp_url")
    if not url:
        return _rtsp_camera()
    key = str(cam["cam_id"])
    settings = get_settings()
    with _rtsp_cameras_lock:
        obj = _rtsp_cameras.get(key)
        if obj is None:
            obj = RtspCamera(
                url,
                jpeg_quality=settings.cctv_jpeg_quality,
                reconnect_delay=settings.cctv_reconnect_delay,
            )
            _rtsp_cameras[key] = obj
        else:
            obj.set_url(url)  # 변경 시에만 내부에서 재접속
        return obj


@lru_cache
def _speaker() -> SpeakerActuator:
    return SpeakerActuator(get_settings().speaker_alsa_device)


@lru_cache
def _warning_light() -> WarningLightActuator:
    return WarningLightActuator()


# --- Service providers (used with Depends) ---
def get_repo() -> KioskRepository:
    return get_repository()


def get_space_service() -> SpaceService:
    return SpaceService(get_repository())


def get_sensor_service() -> SensorService:
    return SensorService(get_repository())


def get_modal_service() -> ModalService:
    return ModalService(get_repository())


def get_cctv_service() -> CctvService:
    # cam_id 별 RTSP 카메라를 DB 기준으로 해석하는 resolver 를 넘긴다(다중 카메라 대응).
    return CctvService(_shared_dir_reader(), rtsp_camera_for)


def get_danger_service() -> DangerFrameService:
    return DangerFrameService(get_settings())


@lru_cache
def _led_service() -> LedService:
    return LedService(get_settings())


@lru_cache
def _threshold_store() -> LightThresholdStore:
    """경광등·신호등 공용 기준치 store(프로세스 전역 1개, JSON 파일 영속화)."""
    return LightThresholdStore(get_settings())


@lru_cache
def _behavior_cooldown() -> dict[tuple[str, str], float]:
    """행동별 쿨다운 상태를 요청 간 공유하기 위한 캐시 dict(프로세스 전역 1개).

    VlmService 는 요청마다 새로 생성되므로 쿨다운 상태를 인스턴스에 두면 매 요청
    초기화된다. 이 싱글턴 dict 를 주입해 디바운스가 실제로 유지되게 한다.
    """
    return {}


def get_vlm_service() -> VlmService:
    return VlmService(
        repo=get_repository(),
        vlm_client=_vlm_client(),
        tts=_tts_service(),
        speaker=_speaker(),
        warning_light=_warning_light(),
        settings=get_settings(),
        led=_led_service(),
        cooldown_state=_behavior_cooldown(),
        thresholds=_threshold_store(),
    )


def get_led_service() -> LedService:
    return _led_service()


def get_threshold_store() -> LightThresholdStore:
    return _threshold_store()


@lru_cache
def _vlm_scheduler() -> "VlmScheduler":
    from app.services.vlm_scheduler import VlmScheduler

    return VlmScheduler(
        service_factory=get_vlm_service,
        camera_lister=lambda: get_repository().get_cameras(),
        interval=get_settings().vlm_scheduler_interval_seconds,
    )


def get_vlm_scheduler() -> "VlmScheduler":
    return _vlm_scheduler()


def get_app_settings() -> Settings:
    return get_settings()
