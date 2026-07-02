"""Business logic for the /cctv endpoints.

* ``latest_frame`` — Shared Dir 30fps 프레임(하드웨어 서버가 기록) 1장.
* ``live_frame``  — IP 카메라 RTSP 직결 스트림의 최신 프레임 1장. 카메라가 아직
  연결 전이면 placeholder 를 돌려준다. 라이브 카메라가 구성되지 않은 경우엔
  Shared Dir 프레임으로 폴백한다.

다중 카메라: 생성 시 ``camera_resolver(cam_id) -> RtspCamera|None`` 를 주입받아,
요청의 ``cam`` 에 해당하는 카메라를 해석한다(DB rtsp_url 기준, deps 참고).
MJPEG 스트림은 연결마다 카메라를 **한 번만** 해석하고(``resolve_camera``) 이후
프레임은 그 객체에서 읽는다 — 프레임마다 DB 조회하지 않기 위해서다. IP 변경은
같은 객체에 ``set_url`` 로 반영되므로 스트림을 끊지 않아도 재접속된다.
"""

from __future__ import annotations

from typing import Callable, Optional

from app.integrations.rtsp_stream import RtspCamera
from app.integrations.shared_dir import _PLACEHOLDER_JPEG, FrameResult, SharedDirReader


class CctvService:
    def __init__(
        self,
        reader: SharedDirReader,
        camera_resolver: Optional[Callable[[Optional[str]], Optional[RtspCamera]]] = None,
    ) -> None:
        self._reader = reader
        self._resolve = camera_resolver

    def resolve_camera(self, cam_id: str | None = None) -> RtspCamera | None:
        """cam_id 의 RTSP 카메라를 해석(스트림 시작 시 1회 호출용)."""
        return self._resolve(cam_id) if self._resolve is not None else None

    def latest_frame(self) -> FrameResult:
        return self._reader.latest_frame()

    def live_frame(self, cam_id: str | None = None) -> FrameResult:
        """RTSP 카메라의 최신 프레임(단발). 미구성 시 Shared Dir 로 폴백."""
        camera = self.resolve_camera(cam_id)
        if camera is None:
            return self._reader.latest_frame()
        camera.start()  # 첫 호출에서 지연 시작
        data, _frame_id = camera.latest()
        if data:
            return FrameResult(data, "image/jpeg", "rtsp", "live")
        # 아직 연결 전(프레임 없음) → placeholder 로 화면이 깨지지 않게.
        return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

    @staticmethod
    def live_latest(camera: RtspCamera | None) -> tuple[bytes, int, str]:
        """MJPEG 스트리밍용: (jpeg, frame_id, source). 해석된 카메라 객체를 받는다."""
        if camera is not None:
            camera.start()
            data, frame_id = camera.latest()
            if data:
                return data, frame_id, "rtsp"
        return _PLACEHOLDER_JPEG, 0, "placeholder"
