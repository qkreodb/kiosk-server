"""Shared response primitives."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    version: str
    repository: str = Field(description="Active data-source implementation.")
    vlm_infer_url: str
    shared_dir: str


class CameraInfo(BaseModel):
    """A CCTV camera registered to a process/zone."""

    cam_id: str = Field(examples=["CAM-03"])
    label: str = Field(examples=["정밀가공 라인"])
    location: str = Field(examples=["정밀가공 공정 (PRC-19) · 도장작업실"])
    process_code: str = Field(examples=["PRC-19"])
    online: bool = True
    rtsp_url: str | None = Field(
        default=None,
        description="CCTV RTSP 스트림 주소 (DB cctv_info.rtsp_url)",
        examples=["rtsp://192.168.0.10:554/stream1"],
    )
