"""FastAPI dependency providers.

Wires the layered architecture together: settings -> repository/integrations ->
services. Singletons (repository, integrations) are cached; services are thin
and constructed per request around the cached singletons.
"""

from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.integrations.actuators import SpeakerActuator, WarningLightActuator
from app.integrations.shared_dir import SharedDirReader
from app.integrations.tts import TtsService
from app.integrations.vlm_client import VlmClient
from app.repositories.base import KioskRepository
from app.repositories.factory import get_repository
from app.services.cctv_service import CctvService
from app.services.led_service import LedService
from app.services.modal_service import ModalService
from app.services.sensor_service import SensorService
from app.services.space_service import SpaceService
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
def _speaker() -> SpeakerActuator:
    return SpeakerActuator()


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
    return CctvService(_shared_dir_reader())


@lru_cache
def _led_service() -> LedService:
    return LedService(get_settings())


def get_vlm_service() -> VlmService:
    return VlmService(
        repo=get_repository(),
        vlm_client=_vlm_client(),
        tts=_tts_service(),
        speaker=_speaker(),
        warning_light=_warning_light(),
        settings=get_settings(),
        led=_led_service(),
    )


def get_led_service() -> LedService:
    return _led_service()


def get_app_settings() -> Settings:
    return get_settings()
