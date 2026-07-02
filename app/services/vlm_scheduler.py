"""서버 측 VLM 분석 스케줄러 — 브라우저 없이 다중 카메라를 순회 분석한다.

프론트의 단일 분석 루프(활성 카메라 1대)와 달리, 이 스케줄러는 DB cctv_info 의
카메라 목록을 주기적으로 돌면서 각 카메라의 소속 공정(process_code)과 프레임
폴더(frame_dir)로 ``VlmService.infer`` 를 호출한다. 그래서 키오스크 화면이 안
열려 있어도 경광등·TTS·DB 카운트가 계속 동작한다.

한 사이클 안에서는 카메라를 **순차** 호출한다(외부 VLM 서버가 워커 1개라 동시
요청이 큐만 늘리기 때문). ``start()``/``stop()`` 으로 가동을 제어한다(기본 정지).
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from app.core.logging import get_logger

logger = get_logger(__name__)


class VlmScheduler:
    def __init__(
        self,
        *,
        service_factory: Callable[[], Any],       # () -> VlmService
        camera_lister: Callable[[], list[dict]],  # () -> [{cam_id, process_code, frame_dir}, ...]
        interval: float = 2.0,
    ) -> None:
        self._service_factory = service_factory
        self._camera_lister = camera_lister
        self._interval = max(0.0, float(interval))
        self._task: asyncio.Task | None = None
        self._running = False
        self._last_error: str | None = None

    def start(self) -> None:
        """가동 시작(이미 돌고 있으면 무시). 실행 중인 이벤트 루프가 필요하다."""
        if self._running:
            return
        self._running = True
        self._last_error = None
        self._task = asyncio.create_task(self._loop(), name="vlm-scheduler")
        logger.info("[스케줄러] VLM 분석 스케줄러 시작 (interval=%.1fs)", self._interval)

    async def stop(self) -> None:
        """가동 중지. 진행 중 사이클이 끝나거나 취소될 때까지 대기."""
        self._running = False
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        logger.info("[스케줄러] VLM 분석 스케줄러 중지")

    def status(self) -> dict:
        cameras: list[str] = []
        try:
            cameras = [str(c.get("cam_id")) for c in self._camera_lister()]
        except Exception as exc:  # noqa: BLE001
            self._last_error = f"{exc.__class__.__name__}: {exc}"
        return {
            "running": self._running,
            "interval_seconds": self._interval,
            "cameras": cameras,
            "last_error": self._last_error,
        }

    async def _loop(self) -> None:
        while self._running:
            try:
                cameras = self._camera_lister()
            except Exception as exc:  # noqa: BLE001 — DB 일시 오류면 다음 사이클 재시도
                self._last_error = f"{exc.__class__.__name__}: {exc}"
                logger.warning("[스케줄러] 카메라 목록 조회 실패: %s", exc)
                cameras = []

            for cam in cameras:
                if not self._running:
                    break
                cam_id = str(cam.get("cam_id") or "")
                try:
                    service = self._service_factory()
                    await service.infer(
                        camera_id=cam_id,
                        process_code=cam.get("process_code") or None,
                        frame_dir=cam.get("frame_dir") or None,
                        labels=None,  # 자율 감시 — 전체 행동 대상(신호등 체크와 무관)
                    )
                except Exception as exc:  # noqa: BLE001 — 한 대 실패해도 나머지 계속
                    self._last_error = f"{exc.__class__.__name__}: {exc}"
                    logger.warning("[스케줄러] 카메라 %s 분석 실패: %s", cam_id, exc)

            await asyncio.sleep(self._interval)
