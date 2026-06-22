"""Repository selection — the one place to swap the data source.

When the real Shared DB lands, add the new implementation here and select it via
``KIOSK_REPOSITORY``. Nothing else in the app needs to change.
"""

from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.core.logging import get_logger
from app.repositories.base import KioskRepository
from app.repositories.mock_repository import MockRepository

logger = get_logger(__name__)


@lru_cache
def get_repository() -> KioskRepository:
    settings = get_settings()
    kind = settings.repository.lower()

    if kind == "mock":
        return MockRepository()

    if kind in {"mysql", "sql"}:
        # Real Shared DB (MySQL on the Jetson). If the DB is unreachable or
        # misconfigured, fall back to the mock so the kiosk keeps running.
        try:
            from app.repositories.sql_repository import SqlRepository

            return SqlRepository(settings)
        except Exception:  # connection / driver / auth errors
            logger.warning(
                "KIOSK_REPOSITORY=%r selected but MySQL connection failed; "
                "falling back to mock.",
                kind,
                exc_info=True,
            )
            return MockRepository()

    logger.warning("Unknown KIOSK_REPOSITORY=%r; falling back to mock.", kind)
    return MockRepository()


# Class name -> short label reported by /health and the startup log. This
# reflects the *active* implementation (post-fallback), not the configured
# selector, so a mysql->mock fallback is visible.
_REPO_LABELS = {
    "MockRepository": "mock",
    "SqlRepository": "mysql",
}


def active_repository_name() -> str:
    """Short label for the repository actually in use (e.g. ``"mock"``)."""
    return _REPO_LABELS.get(type(get_repository()).__name__, "unknown")
