"""CCTV 영상 엔드포인트.

두 가지 소스를 제공한다.

* Shared Dir (하드웨어 서버가 기록한 30fps 프레임)
    - ``GET /cctv/frame``  : 최신 프레임 1장(JPEG)
    - ``GET /cctv/stream`` : 연속 MJPEG 스트림
* Live RTSP (IP 카메라 직결, 서버에서 OpenCV/FFmpeg 로 디코딩)
    - ``GET /cctv/live``       : 연속 MJPEG 스트림 (브라우저 ``<img>`` 용)
    - ``GET /cctv/live/frame`` : 최신 프레임 1장(JPEG) — 추후 VLM 분석용

브라우저는 RTSP 를 직접 재생할 수 없으므로, 서버가 RTSP→JPEG 로 변환해 MJPEG
(multipart/x-mixed-replace) 로 중계한다.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import (
    get_app_settings,
    get_cctv_service,
    get_repo,
    rtsp_camera_for,
)
from app.core.config import Settings
from app.repositories.base import KioskRepository
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


@router.get(
    "/live/frame",
    summary="최신 라이브 CCTV 프레임 (RTSP→JPEG)",
    responses={200: {"content": {"image/jpeg": {}}}},
)
async def live_frame(
    cam: str | None = None,
    service: CctvService = Depends(get_cctv_service),
) -> Response:
    result = service.live_frame(cam)
    return Response(
        content=result.data,
        media_type=result.content_type,
        headers={
            "Cache-Control": "no-store",
            "X-Frame-Source": result.source,  # "rtsp" / "placeholder"
        },
    )


@router.get(
    "/live",
    summary="라이브 CCTV 스트림 (RTSP→MJPEG over HTTP)",
    responses={200: {"content": {"multipart/x-mixed-replace": {}}}},
)
async def live(
    cam: str | None = None,
    service: CctvService = Depends(get_cctv_service),
    settings: Settings = Depends(get_app_settings),
) -> StreamingResponse:
    fps = max(1, settings.cctv_stream_fps)
    interval = 1.0 / fps
    # 스트림 시작 시 카메라를 1회만 해석(프레임마다 DB 조회 방지). IP 변경은 같은
    # RtspCamera 객체에 set_url 로 반영되므로, 이 참조로도 재접속이 그대로 적용된다.
    camera = service.resolve_camera(cam)

    async def gen():
        last_id = -1
        while True:
            data, frame_id, _source = service.live_latest(camera)
            # 새 프레임일 때만 전송(대역폭 절약). 단, 연결 대기 중(placeholder,
            # frame_id=0)에도 화면이 비지 않도록 그대로 내보낸다.
            if frame_id != last_id or frame_id == 0:
                last_id = frame_id
                yield (
                    b"--" + _MJPEG_BOUNDARY.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(data)).encode() + b"\r\n\r\n"
                    + data + b"\r\n"
                )
            await asyncio.sleep(interval)

    return StreamingResponse(
        gen(),
        media_type=f"multipart/x-mixed-replace; boundary={_MJPEG_BOUNDARY}",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


class CctvUpdateRequest(BaseModel):
    """카메라 IP/폴더 변경 — 둘 중 하나 이상."""

    rtsp_url: str | None = Field(
        default=None, examples=["rtsp://admin:pass@172.16.0.243:554/stream1"]
    )
    frame_dir: str | None = Field(default=None, examples=["/home/ds/Desktop/frames/cam1"])


@router.put("/{cam_id}", summary="CCTV RTSP/프레임폴더 수정 (IP 변경 즉시 반영)")
async def update_cctv(
    cam_id: str,
    body: CctvUpdateRequest,
    repo: KioskRepository = Depends(get_repo),
) -> dict:
    """DB cctv_info 의 rtsp_url/frame_dir 을 수정한다.

    IP가 바뀌었을 때 사용자 입력으로 반영하는 용도. rtsp_url 을 바꾸면 해당 카메라의
    라이브 스트림이 서버 재시작 없이 새 주소로 즉시 재접속된다.
    """
    if body.rtsp_url is None and body.frame_dir is None:
        raise HTTPException(status_code=400, detail="rtsp_url 또는 frame_dir 중 하나는 필요합니다")
    ok = repo.update_camera(cam_id, rtsp_url=body.rtsp_url, frame_dir=body.frame_dir)
    if not ok:
        raise HTTPException(status_code=404, detail=f"카메라를 찾을 수 없거나 변경 없음: {cam_id}")
    # rtsp_url 이 바뀌었으면 해당 카메라 스트림을 새 URL 로 즉시 재접속(set_url).
    if body.rtsp_url is not None:
        rtsp_camera_for(cam_id)
    return repo.get_camera(cam_id) or {"cam_id": cam_id}
