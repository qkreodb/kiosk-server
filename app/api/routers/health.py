"""GET /health — liveness + active-config summary."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_app_settings
from app.core.config import Settings
from app.repositories.factory import active_repository_name
from app.schemas.common import HealthResponse

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse, summary="헬스 체크")
async def health(settings: Settings = Depends(get_app_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        repository=active_repository_name(),
        vlm_infer_url=settings.vlm_infer_url,
        shared_dir=str(settings.shared_dir),
    )
