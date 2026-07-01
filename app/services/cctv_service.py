"""Business logic for the /cctv endpoints."""

from __future__ import annotations

from app.integrations.rtsp_stream import RtspCamera
from app.integrations.shared_dir import _PLACEHOLDER_JPEG, FrameResult, SharedDirReader


class CctvService:
    def __init__(
        self,
        reader: SharedDirReader,
        camera: RtspCamera | None = None,
        cameras: dict[str, RtspCamera] | None = None,
    ) -> None:
        self._reader = reader
        self._camera = camera
        self._cameras = cameras or {}

    def _camera_for(self, camera_id: str | None) -> RtspCamera | None:
        if not camera_id:
            return self._camera
        return self._cameras.get(camera_id.strip().upper())

    def latest_frame(self, camera_id: str | None = None) -> FrameResult:
        return self._reader.latest_frame(camera_id)

    def live_frame(self, camera_id: str | None = None) -> FrameResult:
        camera = self._camera_for(camera_id)
        if camera is None:
            return self._reader.latest_frame(camera_id)

        camera.start()
        data, _frame_id = camera.latest()
        if data:
            return FrameResult(data, "image/jpeg", "rtsp", "live")
        return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

    def live_latest(self, camera_id: str | None = None) -> tuple[bytes, int, str]:
        camera = self._camera_for(camera_id)
        if camera is not None:
            camera.start()
            data, frame_id = camera.latest()
            if data:
                return data, frame_id, "rtsp"
        return _PLACEHOLDER_JPEG, 0, "placeholder"
