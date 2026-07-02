"""Live RTSP camera reader (IP 카메라 직결).

Shared Dir 파이프라인이 준비되기 전, IP 카메라의 RTSP 스트림을 **서버에서**
디코딩해 JPEG 프레임으로 변환한다. 브라우저는 RTSP 를 직접 재생할 수 없으므로
키오스크는 이 프레임들을 MJPEG(multipart/x-mixed-replace) 로 받아 ``<img>`` 에
표시한다(`/cctv/live`). 같은 프레임 버퍼에서 단일 JPEG(`/cctv/live/frame`)도
꺼낼 수 있어, 추후 프레임 단위 VLM 분석에 그대로 재사용할 수 있다.

설계 요점
---------
* OpenCV(`opencv-python-headless`)가 FFmpeg 백엔드를 내장하므로 시스템에 별도
  ffmpeg 설치가 필요 없다. ``import cv2`` 는 지연 import 하여, OpenCV 가 없는
  환경에서도 서버의 나머지 기능은 정상 동작하고 라이브 CCTV 만 비활성화된다.
* 백그라운드 스레드가 카메라에서 계속 프레임을 읽어 **최신 한 장**만 메모리에
  유지한다(버퍼 누적/지연 방지). 요청 핸들러는 이 최신 프레임을 복사해 내보낸다.
* 연결 실패/끊김 시 ``reconnect_delay`` 간격으로 자동 재접속한다.
* 스레드는 첫 요청 시 **지연 시작(lazy start)** 한다 — 부팅 시 카메라가 꺼져
  있어도 서버 기동을 막지 않는다.
"""

from __future__ import annotations

import os
import threading
from typing import Optional

from app.core.logging import get_logger

logger = get_logger(__name__)

# RTSP 는 UDP 기본값보다 TCP 가 패킷 손실에 훨씬 안정적이다. cv2.VideoCapture 가
# 내부 FFmpeg 로 넘겨주는 옵션을 환경변수로 지정한다(다른 곳에서 이미 지정했다면
# 존중). 반드시 cv2 import / VideoCapture 생성 이전에 설정되어야 한다.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


class RtspCamera:
    """RTSP 스트림을 백그라운드로 읽어 최신 JPEG 프레임을 보관한다."""

    def __init__(
        self,
        url: str,
        *,
        jpeg_quality: int = 80,
        reconnect_delay: float = 3.0,
    ) -> None:
        self._url = url
        self._jpeg_quality = int(max(1, min(100, jpeg_quality)))
        self._reconnect_delay = float(reconnect_delay)

        self._lock = threading.Lock()
        self._latest_jpeg: Optional[bytes] = None
        self._frame_id = 0
        self._connected = False

        self._thread: Optional[threading.Thread] = None
        self._started = False
        self._stop = threading.Event()
        self._reconnect = threading.Event()  # set_url() 시 현재 연결을 끊고 새 URL 로 재접속

    # ---- 공개 API -------------------------------------------------------
    def start(self) -> None:
        """백그라운드 캡처 스레드를 (한 번만) 시작한다. 재호출은 무시."""
        with self._lock:
            if self._started:
                return
            self._started = True
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="rtsp-camera", daemon=True
        )
        self._thread.start()
        logger.info("RTSP 카메라 캡처 시작: %s", self.safe_url)

    def stop(self) -> None:
        self._stop.set()

    def set_url(self, url: str) -> bool:
        """RTSP URL 을 바꾸고(변경 시에만) 현재 연결을 끊어 새 주소로 재접속시킨다.

        DB cctv_info.rtsp_url 수정(카메라 IP 변경) 시 호출하면, 캡처 스레드가
        재시작 없이 다음 루프에서 새 URL 로 접속한다. 반환값: 실제 변경되었는지.
        """
        url = (url or "").strip()
        with self._lock:
            if not url or url == self._url:
                return False
            self._url = url
        self._reconnect.set()  # 현재 세션을 끊고 outer 루프가 새 URL 로 재접속
        logger.info("RTSP URL 변경 → 재접속: %s", self.safe_url)
        return True

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def safe_url(self) -> str:
        """로그용: ``user:pass@`` 자격증명을 가린 URL."""
        url = self._url
        if "@" in url and "://" in url:
            scheme, rest = url.split("://", 1)
            _, host = rest.split("@", 1)
            return f"{scheme}://***:***@{host}"
        return url

    def latest(self) -> tuple[Optional[bytes], int]:
        """(최신 JPEG bytes 또는 None, 단조 증가 frame_id) 반환."""
        with self._lock:
            return self._latest_jpeg, self._frame_id

    # ---- 내부 캡처 루프 -------------------------------------------------
    def _run(self) -> None:
        try:
            import cv2  # 지연 import: OpenCV 미설치 환경 보호
        except Exception as exc:  # pragma: no cover - 환경 의존
            logger.error(
                "OpenCV(cv2) import 실패 — 라이브 CCTV 비활성화. "
                "`pip install opencv-python-headless` 필요. (%s)",
                exc,
            )
            self._connected = False
            return

        while not self._stop.is_set():
            self._reconnect.clear()
            with self._lock:
                url = self._url  # set_url() 로 바뀌었을 수 있으니 매 접속마다 스냅샷
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            try:
                # 디코더 버퍼를 최소화해 지연(latency)을 줄인다.
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass

            if not cap.isOpened():
                self._connected = False
                logger.warning(
                    "RTSP 연결 실패(%s) — %.1f초 후 재시도",
                    self.safe_url, self._reconnect_delay,
                )
                cap.release()
                self._stop.wait(self._reconnect_delay)
                continue

            self._connected = True
            logger.info("RTSP 연결 성공: %s", self.safe_url)
            consecutive_failures = 0

            while not self._stop.is_set():
                if self._reconnect.is_set():
                    logger.info("RTSP 재접속 요청 감지 — 현재 세션 종료 후 새 URL 접속")
                    break
                ok, frame = cap.read()
                if not ok or frame is None:
                    consecutive_failures += 1
                    # 일시적 손실은 무시하되, 지속되면 재접속.
                    if consecutive_failures >= 30:
                        logger.warning("RTSP 프레임 연속 실패 — 재접속")
                        break
                    continue
                consecutive_failures = 0

                ok, buf = cv2.imencode(
                    ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self._jpeg_quality]
                )
                if not ok:
                    continue
                with self._lock:
                    self._latest_jpeg = buf.tobytes()
                    self._frame_id += 1

            self._connected = False
            cap.release()
            if not self._stop.is_set():
                self._stop.wait(self._reconnect_delay)
