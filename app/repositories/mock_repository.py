"""In-memory / JSON-fixture implementation of :class:`KioskRepository`.

Loads ``mock_data/*.json`` once at construction and keeps mutable
unsafe-behavior counters in memory so the server is fully runnable without any
real database. This is the swappable seam: replace this class with a real
DB-backed repository when the Shared DB schema exists.
"""

from __future__ import annotations

import copy
import json
import threading
from pathlib import Path
from typing import Any

from app.core.logging import get_logger
from app.domain.constants import BEHAVIOR_CATEGORIES
from app.repositories.base import KioskRepository

logger = get_logger(__name__)

# mock_data/ lives at the project root (two levels up from this file's package).
_MOCK_DIR = Path(__file__).resolve().parents[2] / "mock_data"


def _load(name: str) -> Any:
    path = _MOCK_DIR / name
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


class MockRepository(KioskRepository):
    """Realistically-shaped mock data source backed by JSON fixtures."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

        self._processes: list[dict[str, Any]] = _load("processes.json")
        self._cameras: list[dict[str, Any]] = _load("cameras.json")
        self._temp_humid: dict[str, Any] = _load("sensors_temp_humid.json")
        self._watch: dict[str, Any] = _load("watch.json")
        self._msds: dict[str, Any] = _load("msds.json")
        self._risk: dict[str, Any] = _load("risk.json")

        seed = _load("behavior_seed.json")
        # Mutable counters: { process_code: { behavior_id: count } }.
        self._behavior_counts: dict[str, dict[str, int]] = {
            code: {cat.id.value: int(vals.get(cat.id.value, 0)) for cat in BEHAVIOR_CATEGORIES}
            for code, vals in seed.items()
            if isinstance(vals, dict)
        }
        logger.info("MockRepository loaded fixtures from %s", _MOCK_DIR)

    # --- Processes ---
    def get_processes(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._processes)

    def get_process(self, code: str) -> dict[str, Any] | None:
        return next((copy.deepcopy(p) for p in self._processes if p["code"] == code), None)

    # --- Cameras ---
    def get_cameras(self, process_code: str | None = None) -> list[dict[str, Any]]:
        cams = self._cameras
        if process_code:
            cams = [c for c in cams if c["process_code"] == process_code]
        return copy.deepcopy(cams)

    def get_camera(self, cam_id: str) -> dict[str, Any] | None:
        return next((copy.deepcopy(c) for c in self._cameras if c["cam_id"] == cam_id), None)

    # --- Sensors ---
    def get_temp_humid(self, process_code: str | None = None) -> dict[str, Any]:
        readings = self._temp_humid["readings"]
        if process_code:
            readings = [r for r in readings if r.get("process_code") == process_code]
        return {"location": self._temp_humid["location"], "readings": copy.deepcopy(readings)}

    def get_watch(self, process_code: str | None = None) -> dict[str, Any]:
        workers = self._watch["workers"]
        if process_code:
            workers = [w for w in workers if w.get("process_code") == process_code]
        return {"region": self._watch["region"], "workers": copy.deepcopy(workers)}

    # --- MSDS / Risk ---
    def get_msds(self) -> dict[str, Any]:
        return copy.deepcopy(self._msds)

    def get_risk(self, process_code: str) -> dict[str, Any] | None:
        found = self._risk.get(process_code)
        return copy.deepcopy(found) if found else None

    # --- Behavior counters ---
    def _ensure_process(self, process_code: str) -> dict[str, int]:
        if process_code not in self._behavior_counts:
            self._behavior_counts[process_code] = {
                cat.id.value: 0 for cat in BEHAVIOR_CATEGORIES
            }
        return self._behavior_counts[process_code]

    def get_behavior_counts(self, process_code: str) -> dict[str, int]:
        with self._lock:
            return dict(self._ensure_process(process_code))

    def increment_behavior(self, process_code: str, behavior_id: str, delta: int = 1) -> int:
        with self._lock:
            counts = self._ensure_process(process_code)
            counts[behavior_id] = counts.get(behavior_id, 0) + delta
            return counts[behavior_id]

    def reset_behavior_counts(self, process_code: str) -> None:
        with self._lock:
            counts = self._ensure_process(process_code)
            for key in counts:
                counts[key] = 0
