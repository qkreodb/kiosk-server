"""Kiosk Main Server — FastAPI app factory (PORT 8080).

This is the "Kiosk Back section (PORT 8080)" from 001.png. It serves the kiosk
frontend by querying the Shared DB (MySQL), reading 30fps frames from the
Shared Dir, and calling the external VLM Server's /analyze endpoint with
post-processing (TTS + DB counting + warning-light control signal).

Run with:  uvicorn app.main:app --port 8080
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Eagerly initialize the data source so the DB connects (and fails fast) at boot.
    from app.repositories.factory import active_repository_name, get_repository

    get_repository()
    settings.tts_output_dir.mkdir(parents=True, exist_ok=True)
    settings.shared_dir.mkdir(parents=True, exist_ok=True)
    logger.info(
        "%s v%s started | repo=%s | vlm=%s | shared_dir=%s",
        settings.app_name, settings.app_version, active_repository_name(),
        settings.vlm_analyze_url, settings.shared_dir,
    )
    yield
    logger.info("%s shutting down.", settings.app_name)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "산업 안전보건 키오스크 백엔드 (Kiosk Back section · PORT 8080). "
            "Shared DB(MySQL) 조회 · Shared Dir 프레임 제공 · VLM /analyze 호출 및 "
            "후처리(TTS·DB 카운팅·경광등 제어)."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers (one per domain).
    from app.api.routers import cctv, health, led, modal, sensor, space, tts, vlm

    app.include_router(health.router)
    app.include_router(space.router)
    app.include_router(sensor.router)
    app.include_router(modal.router)
    app.include_router(cctv.router)
    app.include_router(vlm.router)
    app.include_router(tts.router)
    app.include_router(led.router)

    @app.get("/", tags=["meta"], summary="루트")
    async def root() -> dict:
        return {
            "service": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
            "health": "/health",
            "kiosk": "/kiosk.html",
        }

    # 키오스크 프론트(kiosk.html)를 백엔드가 직접 서빙 — 별도 정적 서버 불필요.
    @app.get("/kiosk.html", include_in_schema=False)
    async def kiosk_html() -> FileResponse:
        return FileResponse(Path(__file__).resolve().parents[1] / "kiosk.html")

    @app.get("/kiosk", include_in_schema=False)
    async def kiosk_page() -> FileResponse:
        return FileResponse(Path(__file__).resolve().parents[1] / "kiosk.html")

    # 키오스크 프론트 정적 자산(css/js/images) — kiosk.html 의 상대경로와 일치.
    project_root = Path(__file__).resolve().parents[1]
    for sub in ("css", "js", "images"):
        asset_dir = project_root / sub
        if asset_dir.is_dir():
            app.mount(f"/{sub}", StaticFiles(directory=asset_dir), name=sub)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
