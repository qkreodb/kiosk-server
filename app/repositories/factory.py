"""Repository selection — the one place that constructs the data source.

The kiosk runs against the real Shared DB (MySQL on the Jetson) via
:class:`~app.repositories.sql_repository.SqlRepository`. If the DB is
unreachable, construction raises and the server fails fast at boot — there is
no mock/offline fallback in the operational build.
"""

from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.repositories.base import KioskRepository
from app.repositories.sql_repository import SqlRepository


@lru_cache
def get_repository() -> KioskRepository:
    return SqlRepository(get_settings())


def active_repository_name() -> str:
    """Short label for the repository in use (reported by /health)."""
    return "mysql"
