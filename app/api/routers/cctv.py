"""GET /cctv/frame — latest 30fps frame from the Shared Dir.

Returns a single JPEG (the newest valid frame, or a placeholder). The kiosk can
poll this for near-live display. A continuous MJPEG multipart stream is also
available at /cctv/stream for browsers that prefer a self-refreshing feed.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse

from app.api.deps import get_cctv_service
from app.services.cctv_service import CctvService

router = APIRouter(prefix="/cctv", tags=["cctv"])

_MJPEG_BOUNDARY = "frame"


@router.get(
    "/frame",
    summary="최신 CCTV 프레임 (JPEG)",
    responses={200: {"content": {"image/jpeg": {}}}},
)
async def frame(service: CctvService = Depends(get_cctv_service)) -> Response:
    result = service.latest_frame()
    return Response(
        content=result.data,
        media_type=result.content_type,
        headers={
            "Cache-Control": "no-store",
            "X-Frame-Source": result.source,
            "X-Frame-Name": result.name or "",
        },
    )


@router.get(
    "/stream",
    summary="연속 CCTV 스트림 (MJPEG over HTTP)",
    responses={200: {"content": {"multipart/x-mixed-replace": {}}}},
)
async def stream(service: CctvService = Depends(get_cctv_service)) -> StreamingResponse:
    async def gen():
        # Poll close to the frame collector's 30 fps save limit.
        while True:
            result = service.latest_frame()
            yield (
                b"--" + _MJPEG_BOUNDARY.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(result.data)).encode() + b"\r\n\r\n"
                + result.data + b"\r\n"
            )
            await asyncio.sleep(1 / 30)

    return StreamingResponse(
        gen(),
        media_type=f"multipart/x-mixed-replace; boundary={_MJPEG_BOUNDARY}",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )
