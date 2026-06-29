"""Physical-output actuators behind a clean interface — all stubbed.

Two outputs from the /vlm/infer pipeline land here:
  * Speaker (스피커)       — plays the TTS audio produced by the TTS branch.
  * Warning light (경광등) — receives the generated control signal.

Real deployments would drive audio playback and a GPIO/relay/serial device.
Here both are stubbed (log only) so the server runs headless. Swap these
implementations for real device I/O without touching services/routers.
"""

from __future__ import annotations

import threading

from app.core.logging import get_logger
from app.domain.constants import WarningLightState

logger = get_logger(__name__)


class SpeakerActuator:
    """Outputs synthesized audio to the speaker via playsound.

    겹침 방지 큐(단일 재생기 + 1칸 "최신 대기" 메일박스):
    한 번에 하나만 재생하고, 재생 중에 들어온 요청은 대기 슬롯에 덮어쓴다
    (그 사이 들어온 중간 요청은 폐기). 현재 재생이 끝나면 **가장 최근에**
    들어온 대기분만 재생한다. 예) #1 재생 중 #2,#3 도착 → #1 종료 후 #3 재생(#2 폐기).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: tuple[str, str] | None = None  # 최신 1건만 보관
        self._worker_running = False
        self._epoch = 0  # flush() 마다 증가 — 이전 세대의 늦은 요청을 폐기하는 데 사용

    def current_epoch(self) -> int:
        """현재 재생 세대값. 작업 시작 시 캡처해 ``play_async(epoch=...)`` 로 넘기면,
        그 사이 ``flush()`` 가 호출됐을 때 늦게 도착한 재생 요청을 폐기할 수 있다."""
        with self._lock:
            return self._epoch

    def flush(self) -> None:
        """대기 중인 TTS를 모두 폐기하고 세대값을 올린다.

        **현재 재생 중인 음성은 중단하지 않고 끝까지 재생**한다(요청 사항). 이후
        이전 세대에 시작된 작업이 뒤늦게 재생을 요청하더라도 epoch 불일치로 폐기된다.
        예) CCTV 모달을 끄면 호출 → 재생 중인 1건만 끝나고 나머지는 나오지 않음.
        """
        with self._lock:
            self._epoch += 1
            if self._pending is not None:
                logger.info("[SPEAKER] flush: 대기 음성 폐기 '%s'", self._pending[1])
                self._pending = None

    def play(self, audio_path: str | None, text: str) -> bool:
        """Play audio, blocking until playback finishes.

        주의: blocking 호출이므로 async 요청 핸들러(예: /vlm/infer)에서 직접 호출하면
        오디오 재생 시간만큼 이벤트 루프가 멈춘다. 요청 경로에서는 ``play_async`` 사용.
        """
        if not audio_path:
            logger.warning("[SPEAKER] no audio file; cannot play: '%s'", text)
            return False
        try:
            from playsound import playsound  # noqa: PLC0415
            logger.info("[SPEAKER] playing: %s ('%s')", audio_path, text)
            playsound(audio_path)  # blocking — waits until playback finishes
            logger.info("[SPEAKER] playback complete.")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("[SPEAKER] playback failed (%s): %s", exc.__class__.__name__, exc)
            return False

    def play_async(self, audio_path: str | None, text: str, epoch: int | None = None) -> None:
        """Fire-and-forget 재생(겹침 방지). 호출 즉시 반환.

        재생 중이면 이 요청을 "최신 대기" 슬롯에 넣어 두고(기존 대기분은 폐기) 반환한다.
        현재 재생이 끝나면 단일 워커가 가장 최근 대기분 하나만 재생한다.
        ``epoch`` 를 주면 그 사이 ``flush()`` 가 호출돼 세대가 바뀐 경우 재생을 폐기한다.
        """
        if not audio_path:
            logger.warning("[SPEAKER] no audio file; cannot play: '%s'", text)
            return
        with self._lock:
            if epoch is not None and epoch != self._epoch:
                logger.info("[SPEAKER] 만료된(모달 종료 등) 재생 요청 폐기: '%s'", text)
                return
            if self._pending is not None:
                logger.info("[SPEAKER] 이전 대기 음성 폐기(최신으로 교체): '%s'", self._pending[1])
            self._pending = (audio_path, text)
            if self._worker_running:
                return  # 진행 중인 워커가 끝나고 대기분을 가져간다
            self._worker_running = True
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        """대기 슬롯이 빌 때까지 '가장 최근 1건'만 순차 재생하는 단일 워커."""
        while True:
            with self._lock:
                item = self._pending
                self._pending = None
                if item is None:
                    self._worker_running = False
                    return
            self.play(item[0], item[1])  # blocking — 재생 동안 들어온 요청은 슬롯에 누적


class WarningLightActuator:
    """Sends the control signal to the warning light / beacon (stubbed)."""

    def dispatch(self, state: WarningLightState, label: str, count: int) -> bool:
        logger.info(
            "[경광등] control signal -> state=%s label='%s' (count=%d)",
            state.value, label, count,
        )
        # Real impl: GPIO/relay/serial write. Always "succeeds" in stub.
        return True
