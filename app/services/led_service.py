"""실물 경광등(LED) 제어 서비스 — VLM 탐지 → 경고 파이프라인의 출력단.

최종 목표는 VLM이 불안전행동을 탐지하면 누적 count에 따라 경광등을 켜는 것이다.
다만 VLM 연동 전 시연/검증을 위해, 키오스크의 4개 심각도 칸(관심/주의/경고/위험)을
버튼으로 눌러 해당 색상의 LED를 직접 점등할 수 있도록 본 서비스를 둔다.

내부적으로는 외부 ``warning_light_control`` 패키지(ST80EL-USB HID)를 그대로 재사용한다.
  * 레벨 → 대표 count 로 변환 후 ``build_warning_light_payload`` 로 페이로드 생성
  * 실제 점등은 blocking(약 5초, blink/sequence 루프)이므로 **백그라운드 스레드**에서
    실행하고 HTTP 응답은 즉시 반환한다.
  * 동시에 두 신호가 겹치지 않도록 비차단 락으로 보호한다(점등 중 재요청 → 409).
  * hidapi 미설치 또는 장치 미연결 시 500이 아니라 ``simulated`` 로 폴백해 시연이
    끊기지 않게 한다.
"""

from __future__ import annotations

import threading
from typing import Any

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging import get_logger
from warning_light_control import (
    EventCode,
    WarningLightPayload,
    build_warning_light_payload,
)
from warning_light_control.hid_controller import (
    ST80ELCommandEncoder,
    ST80ELHidController,
    list_hid_devices,
    open_hid_device,
)

logger = get_logger(__name__)


def _hidapi_import_error() -> str | None:
    """hidapi(hid 모듈) import 가능 여부 확인. 가능하면 None, 불가하면 사유 문자열."""
    try:
        import hid  # noqa: F401, PLC0415
    except Exception as exc:  # noqa: BLE001 — ModuleNotFoundError 등
        return str(exc)
    return None

# 심각도 레벨 → (대표 count, 대표 이벤트 코드).
# count 는 warning_light_control.SEVERITY_RULES 의 임계값을 그대로 사용해
# 각 레벨이 정확히 의도한 신호(색/모드)를 내도록 한다.
#   관심 interest : count 2 → 초록 blink
#   주의 caution  : count 4 → 노랑 blink
#   경고 warning  : count 6 → 빨강 blink
#   위험 danger   : count 8 → 초록→노랑→빨강 순차 blink 루프
LEVEL_SPEC: dict[str, tuple[int, EventCode]] = {
    "interest": (2, EventCode.HELMET_OFF),
    "caution": (4, EventCode.SPEAKER_TOUCH),
    "warning": (6, EventCode.RESTRICTED_AREA_ENTRY),
    "danger": (8, EventCode.SOLO_LADDER_CLIMB),
}


class LedService:
    """키오스크 신호등 칸 버튼/VLM 파이프라인에서 호출하는 LED 점등 진입점."""

    # 한 번에 하나의 HID 명령만 실행되도록 클래스 수준 락(프로세스 전역).
    _lock = threading.Lock()

    def __init__(self, settings: Settings) -> None:
        self._dry_run = settings.led_dry_run
        self._vendor_id = settings.led_vendor_id
        self._product_id = settings.led_product_id
        self._encoder = ST80ELCommandEncoder()

    def _hid_preview(self, payload: WarningLightPayload) -> dict[str, Any]:
        """실제 전송될(또는 될) HID 바이트를 사람이 읽기 쉬운 형태로 반환."""
        on_cmd = self._encoder.encode_lamp(payload.signal.color, payload.signal.mode)
        return {
            "vendor_id": hex(self._vendor_id),
            "product_id": hex(self._product_id),
            "on_command": [f"0x{b:02X}" for b in on_cmd],
            "off_command": [f"0x{b:02X}" for b in self._encoder.encode_off()],
        }

    def trigger(self, level: str, dry_run: bool | None = None) -> dict[str, Any]:
        spec = LEVEL_SPEC.get(level)
        if spec is None:
            raise HTTPException(
                status_code=422,
                detail=f"알 수 없는 심각도 레벨: {level} (interest/caution/warning/danger)",
            )
        count, event_code = spec
        payload = build_warning_light_payload(event_code, count)
        if payload is None:  # 방어적: 대표 count 는 항상 임계값 이상이라 발생하지 않음
            raise HTTPException(status_code=500, detail="페이로드 생성 실패")

        result: dict[str, Any] = {
            "level": level,
            "severity": payload.severity.label,
            "signal": payload.signal.to_dict(),
            "hid": self._hid_preview(payload),
            "payload": payload.to_dict(),
        }

        effective_dry = self._dry_run if dry_run is None else dry_run
        if effective_dry:
            result["status"] = "dry_run"
            return result

        # hidapi 자체가 없는 환경(개발 PC 등)은 시연이 끊기지 않게 시뮬레이션으로 폴백.
        imp_err = _hidapi_import_error()
        if imp_err is not None:
            logger.warning("[LED] hidapi 미설치 → 시뮬레이션: %s", imp_err)
            result["status"] = "simulated"
            result["detail"] = f"hidapi 미설치(개발 환경): {imp_err}"
            return result

        # 여기서부터는 hidapi 가 있는 환경(예: Jetson). 장치 열기 실패는 권한/연결
        # 문제이므로 simulated 로 숨기지 않고 명확히 503 으로 보고한다.
        # 중복 실행 방지(비차단 락).
        if not self._lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail="경광등이 이미 동작 중입니다. 현재 신호가 끝난 뒤 다시 시도하세요.",
            )

        try:
            device = open_hid_device(self._vendor_id, self._product_id)
        except Exception as exc:  # noqa: BLE001 — 장치 미연결/권한 거부 등
            self._lock.release()
            logger.error("[LED] HID 장치 열기 실패(권한/연결 확인 필요): %s", exc)
            raise HTTPException(
                status_code=503,
                detail=(
                    "경광등 장치를 열지 못했습니다. ① 장치 연결 여부, "
                    "② /dev/hidraw* 접근 권한(udev 규칙 적용 또는 sudo 실행)을 확인하세요. "
                    f"원인: {exc}"
                ),
            ) from exc

        # blocking apply(약 5초)는 백그라운드 스레드에서 실행하고 즉시 응답.
        def _run() -> None:
            controller = ST80ELHidController(device=device, encoder=self._encoder)
            try:
                logger.info("[LED] 점등 시작: level=%s (%s)", level, payload.severity.label)
                controller.apply(payload)
                logger.info("[LED] 점등 완료: level=%s", level)
            except Exception as exc:  # noqa: BLE001
                logger.error("[LED] 점등 실패: %s", exc)
            finally:
                try:
                    controller.close()
                finally:
                    self._lock.release()

        threading.Thread(target=_run, daemon=True, name=f"led-{level}").start()
        result["status"] = "sent"
        return result

    def off(self, dry_run: bool | None = None) -> dict[str, Any]:
        """경광등 소등."""
        off_cmd = [f"0x{b:02X}" for b in self._encoder.encode_off()]
        result: dict[str, Any] = {"hid": {"off_command": off_cmd}}

        effective_dry = self._dry_run if dry_run is None else dry_run
        if effective_dry:
            result["status"] = "dry_run"
            return result

        imp_err = _hidapi_import_error()
        if imp_err is not None:
            result["status"] = "simulated"
            result["detail"] = f"hidapi 미설치(개발 환경): {imp_err}"
            return result

        if not self._lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail="경광등이 이미 동작 중입니다. 현재 신호가 끝난 뒤 다시 시도하세요.",
            )
        controller = None
        try:
            device = open_hid_device(self._vendor_id, self._product_id)
            controller = ST80ELHidController(device=device, encoder=self._encoder)
            controller.off()
            result["status"] = "sent"
        except Exception as exc:  # noqa: BLE001 — 장치 미연결/권한 거부 등
            logger.error("[LED] 소등 실패(권한/연결 확인 필요): %s", exc)
            raise HTTPException(
                status_code=503,
                detail=(
                    "경광등 장치를 열지 못했습니다. ① 장치 연결 여부, "
                    "② /dev/hidraw* 접근 권한(udev 규칙 적용 또는 sudo 실행)을 확인하세요. "
                    f"원인: {exc}"
                ),
            ) from exc
        finally:
            if controller is not None:
                controller.close()
            self._lock.release()
        return result

    def devices(self) -> dict[str, Any]:
        """연결된 HID 장치 목록과 대상 장치(ST80EL-USB) 인식 여부를 진단용으로 반환.

        - hidapi 미설치 → ``hidapi: false``
        - enumerate 는 되는데 대상 VID/PID 매칭이 0 → 장치 미연결/드라이버 문제
        - 매칭은 되는데 /led/trigger 가 503 → 권한 문제(udev/sudo)
        """
        expected = {
            "vendor_id": hex(self._vendor_id),
            "product_id": hex(self._product_id),
        }
        imp_err = _hidapi_import_error()
        if imp_err is not None:
            return {"hidapi": False, "detail": imp_err, "expected": expected, "devices": []}

        try:
            devices = list_hid_devices()
        except Exception as exc:  # noqa: BLE001
            return {"hidapi": True, "error": str(exc), "expected": expected, "devices": []}

        matches = [
            d for d in devices
            if d.get("vendor_id") == expected["vendor_id"]
            and d.get("product_id") == expected["product_id"]
        ]
        return {
            "hidapi": True,
            "expected": expected,
            "match_count": len(matches),
            "matches": matches,
            "devices": devices,
        }
