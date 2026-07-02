"""Data-access interface (the Shared DB seam).

Services depend ONLY on this abstract interface, never on a concrete data
source. The single implementation is
:class:`~app.repositories.sql_repository.SqlRepository` (the real MySQL Shared
DB on the Jetson), constructed in ``app/repositories/factory.py``. Swapping the
data source is a one-file change there, with no service/router edits.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class KioskRepository(ABC):
    """Read/write access to the data the kiosk needs."""

    # --- Processes (공정) ---
    @abstractmethod
    def get_processes(self) -> list[dict[str, Any]]:
        """All work processes, in UI dropdown order."""

    @abstractmethod
    def get_process(self, code: str) -> dict[str, Any] | None:
        """One process by code, or ``None`` if unknown."""

    # --- CCTV cameras ---
    @abstractmethod
    def get_cameras(self, process_code: str | None = None) -> list[dict[str, Any]]:
        """Cameras, optionally filtered to one process."""

    @abstractmethod
    def get_camera(self, cam_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def update_camera(
        self,
        cam_id: str,
        *,
        rtsp_url: str | None = None,
        frame_dir: str | None = None,
    ) -> bool:
        """cctv_info 의 rtsp_url/frame_dir 갱신(주어진 필드만). 성공 시 True."""

    # --- Sensors ---
    @abstractmethod
    def get_temp_humid(
        self, process_code: str | None = None, sensor_name: str | None = None
    ) -> dict[str, Any]:
        """``{"location": str, "readings": [...]}`` for temp/humidity sensors.

        ``sensor_name`` (예: ``shelly_1``/``sonoff_1``) 가 주어지면 해당 센서만 반환한다.
        """

    @abstractmethod
    def get_watch(self, process_code: str | None = None) -> dict[str, Any]:
        """``{"region": str, "workers": [...]}`` of Galaxy-Watch heart-rate rows."""

    # --- Internal data sources (MSDS / Risk) ---
    @abstractmethod
    def get_msds(self) -> dict[str, Any]:
        """``{"site": str, "chemicals": [...]}``."""

    @abstractmethod
    def get_risk(self, process_code: str) -> dict[str, Any] | None:
        """Risk-assessment payload for one process, or ``None``."""

    # --- Unsafe-behavior counters (written by the VLM pipeline) ---
    @abstractmethod
    def get_behavior_counts(self, process_code: str) -> dict[str, int]:
        """Current cumulative counts keyed by behavior id."""

    @abstractmethod
    def increment_behavior(self, process_code: str, behavior_id: str, delta: int = 1) -> int:
        """Add ``delta`` to one counter and return the new total."""

    @abstractmethod
    def reset_behavior_counts(self, process_code: str) -> None:
        """모든 불안전행동 카운터를 0으로 초기화한다."""
