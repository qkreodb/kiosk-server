"""duego/* 발행 전용 MQTT 클라이언트.

kiosk-vlm/mqtt_publisher.py(Phase S2)와 동일한 연결/발행 패턴을 쓰되, 이
저장소의 기존 integrations 컨벤션(클래스 + Settings 주입, app/api/deps.py 의
@lru_cache 싱글턴)에 맞춘다. 브로커가 죽어 있거나 연결이 끊겨도 서버 동작에
영향을 주면 안 되므로, 연결 시작과 발행 모두 실패를 삼키고 로그만 남긴다.
"""

from __future__ import annotations

import json
from typing import Any

from paho.mqtt import client as mqtt_client
from paho.mqtt.enums import CallbackAPIVersion

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)

CLIENT_ID = "kiosk-server-heat"


class MqttPublisher:
    """duego/* 토픽 발행 전용 클라이언트(구독 없음). 여러 발행자가 공유하는 싱글턴."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: mqtt_client.Client | None = None

    def start(self) -> None:
        """브로커 연결을 비동기로 시작하고 백그라운드 스레드(loop_start)로 유지한다.

        호스트/포트는 기동 시점 값만 쓴다(다른 Settings 필드와 동일하게 변경 시
        재시작 필요).
        """
        if self._client is not None:
            return

        client = mqtt_client.Client(CallbackAPIVersion.VERSION2, CLIENT_ID)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        try:
            client.connect_async(
                self._settings.mqtt_broker_host, self._settings.mqtt_broker_port, keepalive=60,
            )
            client.loop_start()
        except Exception:
            logger.exception(
                "[MQTT] 브로커 연결 시작 실패(%s:%s) — 발행 없이 서버는 계속 동작",
                self._settings.mqtt_broker_host, self._settings.mqtt_broker_port,
            )
            return

        self._client = client
        logger.info(
            "[MQTT] publisher 시작 | broker=%s:%s",
            self._settings.mqtt_broker_host, self._settings.mqtt_broker_port,
        )

    def stop(self) -> None:
        """서버 종료 시 호출. 연결이 없으면 조용히 무시한다."""
        client, self._client = self._client, None
        if client is None:
            return
        try:
            client.loop_stop()
            client.disconnect()
        except Exception:
            logger.exception("[MQTT] 종료 처리 중 오류(무시)")

    def publish(self, topic: str, payload: dict[str, Any], *, qos: int = 1, retain: bool = False) -> None:
        """지정 토픽에 발행. 연결이 없거나 예외가 나도 조용히 무시하고 로그만 남긴다."""
        client = self._client
        if client is None:
            logger.debug("[MQTT] publisher 미기동 — %s 발행 스킵", topic)
            return
        try:
            info = client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=qos, retain=retain)
            if info.rc != mqtt_client.MQTT_ERR_SUCCESS:
                logger.warning("[MQTT] %s 발행 큐잉 실패 rc=%s", topic, info.rc)
        except Exception:
            logger.exception("[MQTT] %s 발행 실패 — 무시하고 계속", topic)

    @staticmethod
    def _on_connect(client, userdata, flags, reason_code, properties=None) -> None:
        if reason_code.is_failure:
            logger.warning("[MQTT] 브로커 연결 실패 rc=%s — 재접속 대기", reason_code)
            return
        logger.info("[MQTT] 브로커 연결됨(%s)", CLIENT_ID)

    @staticmethod
    def _on_disconnect(client, userdata, flags, reason_code, properties=None) -> None:
        logger.warning("[MQTT] 브로커 연결 끊김 rc=%s — 자동 재접속 대기", reason_code)
