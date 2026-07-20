"""공정별 체감온도를 duego/heat/{process_code} 에 주기 발행하는 백그라운드 스레드.

heat_service.list_all() 을 그대로 재사용한다 — 계산 로직을 여기서 새로 만들지
않는다. DB 조회(heat_service)와 paho publish 모두 동기 호출이라, asyncio 이벤트
루프를 막지 않도록 asyncio.Task 가 아니라 순수 threading.Thread(daemon)로 돌린다
(kiosk-hardware/app/mqtt/service.py 와 동일한 방식 — vlm_scheduler.py 의
asyncio.Task 방식과는 다르다. VlmService.infer 는 async 라 태스크가 맞지만,
heat_service 는 전부 동기라 스레드가 맞다).

retain=True 선택: kiosk-hardware/scripts/shelly.py 의 기존 발행 컨벤션은
retain=False(+ 주기 재발행)이지만, heat 은 "현재 상태" 토픽이라 앱이 재접속한
순간 브로커가 마지막 값을 바로 줘야 한다 — 그래서 이 발행자에 한해 retain=True
로 의도적으로 이탈한다.
"""

from __future__ import annotations

import threading
from typing import Callable

from app.core.logging import get_logger
from app.integrations.mqtt_publisher import MqttPublisher
from app.services.heat_service import HeatService

logger = get_logger(__name__)

TOPIC_PREFIX = "duego/heat/"

# 센서 자체가 고빈도 갱신이 아니므로(shelly 기본 5분 재발행) 이보다 공격적으로
# 돌리지 않는다 — 최소값을 코드로 강제한다.
MIN_INTERVAL_SECONDS = 30.0


class HeatPublisher:
    def __init__(
        self,
        *,
        service_factory: Callable[[], HeatService],
        mqtt: MqttPublisher,
        interval: float = MIN_INTERVAL_SECONDS,
    ) -> None:
        self._service_factory = service_factory
        self._mqtt = mqtt
        self._interval = max(MIN_INTERVAL_SECONDS, float(interval))
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """가동 시작(이미 돌고 있으면 무시)."""
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, name="heat-mqtt-publisher", daemon=True,
        )
        self._thread.start()
        logger.info("[heat] duego/heat 발행 스레드 시작 (interval=%.0fs)", self._interval)

    def stop(self) -> None:
        """가동 중지. 진행 중 사이클이 끝날 때까지 잠깐 기다린다."""
        self._stop_event.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5.0)
        logger.info("[heat] duego/heat 발행 스레드 종료")

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._publish_once()
            except Exception:  # noqa: BLE001 — 한 사이클 실패해도 스레드는 계속 산다
                logger.exception("[heat] 발행 사이클 실패 — 다음 주기에 재시도")
            # sleep 대신 wait — stop() 이 호출되면 대기 중에도 바로 깨어난다.
            self._stop_event.wait(self._interval)

    def _publish_once(self) -> None:
        service = self._service_factory()
        for process in service.list_all():
            topic = TOPIC_PREFIX + str(process["process_id"])
            self._mqtt.publish(topic, process, qos=1, retain=True)
