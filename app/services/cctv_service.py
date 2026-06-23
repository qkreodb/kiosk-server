"""Business logic for the /cctv endpoints.

* ``latest_frame`` — Shared Dir 30fps 프레임(하드웨어 서버가 기록) 1장.
* ``live_frame``  — IP 카메라 RTSP 직결 스트림의 최신 프레임 1장. 카메라가 아직
  연결 전이면 placeholder 를 돌려준다. 라이브 카메라가 구성되지 않은 경우엔
  Shared Dir 프레임으로 폴백한다.
"""

from __future__ import annotations

from app.integrations.rtsp_stream import RtspCamera
from app.integrations.shared_dir import _PLACEHOLDER_JPEG, FrameResult, SharedDirReader


class CctvService:
    def __init__(
        self,
        reader: SharedDirReader,
        camera: RtspCamera | None = None,
    ) -> None:
        self._reader = reader
        self._camera = camera

    def latest_frame(self) -> FrameResult:
        return self._reader.latest_frame()

    def live_frame(self) -> FrameResult:
        """RTSP 카메라의 최신 프레임. 미구성 시 Shared Dir 로 폴백."""
        if self._camera is None:
            return self._reader.latest_frame()
        self._camera.start()  # 첫 호출에서 지연 시작
        data, _frame_id = self._camera.latest()
        if data:
            return FrameResult(data, "image/jpeg", "rtsp", "live")
        # 아직 연결 전(프레임 없음) → placeholder 로 화면이 깨지지 않게.
        return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

    def live_latest(self) -> tuple[bytes, int, str]:
        """MJPEG 스트리밍용: (jpeg, frame_id, source). placeholder 폴백 포함."""
        if self._camera is not None:
            self._camera.start()
            data, frame_id = self._camera.latest()
            if data:
                return data, frame_id, "rtsp"
        return _PLACEHOLDER_JPEG, 0, "placeholder"
