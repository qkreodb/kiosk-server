"""MySQL-backed implementation of :class:`KioskRepository` (the real Shared DB).

Talks to the confirmed 5-table schema on the Jetson via PyMySQL + raw SQL:

    process(process_id PK, process_name, behavior_id FK, th_sensor_id FK,
            hb_sensor_id FK, cctv_id FK)        -- central mapping table
    temperature_humidity_sensor(sensor_id PK, temperature, humidity, measured_at)
    heartbeat_sensor(sensor_id PK, heart_rate, measured_at)
    cctv_info(cctv_id PK, rtsp_url)
    unstable_behavior(behavior_id PK, hat_removal_count, ladder_alone_count,
                      restricted_area_count, speaker_touch_count)

Design notes:
  * The DB has no string "code" column, so the API process ``code`` is
    ``str(process_id)`` and ``name``/``label`` come from ``process_name``.
  * Data not in the ERD (MSDS, risk assessments, the human watch roster) is served
    from :mod:`app.repositories.dummy_data` — never the DB.
  * Returned dicts use exactly the keys the service layer / DTOs expect, so no
    service or router code needs to change versus the mock repository.
"""

from __future__ import annotations

import copy
import threading
from typing import Any

import pymysql
from pymysql.cursors import DictCursor

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.constants import BEHAVIOR_CATEGORIES, UnsafeBehavior
from app.repositories import dummy_data
from app.repositories.base import KioskRepository

logger = get_logger(__name__)

# unsafe-behavior id  ->  unstable_behavior column (confirmed schema mapping).
BEHAVIOR_COLUMN: dict[str, str] = {
    UnsafeBehavior.HELMET_OFF.value: "hat_removal_count",
    UnsafeBehavior.TOUCH_EQUIPMENT.value: "speaker_touch_count",
    UnsafeBehavior.UNAUTHORIZED_CROSSING.value: "restricted_area_count",
    UnsafeBehavior.LADDER_ALONE.value: "ladder_alone_count",
}


def _pid(code: str | None) -> int | None:
    """Parse an API process code into an int process_id, or None.

    The kiosk HTML still sends legacy codes like ``PRC-19`` while the shared DB
    stores only numeric ``process.process_id`` values.
    """
    if code is None:
        return None
    raw = str(code).strip()
    if raw.upper().startswith("PRC-"):
        raw = raw.split("-", 1)[1]
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class SqlRepository(KioskRepository):
    """Reads the 5 ERD tables from MySQL; serves MSDS/risk/roster from source."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._conn = pymysql.connect(
            host=settings.db_host,
            port=settings.db_port,
            user=settings.db_user,
            password=settings.db_password,
            database=settings.db_name,
            charset=settings.db_charset,
            connect_timeout=settings.db_connect_timeout,
            autocommit=True,
            cursorclass=DictCursor,
        )
        # Validate the connection up front so the factory can fall back to mock.
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        logger.info(
            "SqlRepository connected to mysql://%s:%s/%s",
            settings.db_host, settings.db_port, settings.db_name,
        )

    # ───────────────────────── low-level helpers (no lock) ─────────────────────
    def _query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        self._conn.ping(reconnect=True)
        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def _query_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self._query(sql, params)
        return rows[0] if rows else None

    def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        self._conn.ping(reconnect=True)
        with self._conn.cursor() as cur:
            return cur.execute(sql, params)

    # ───────────────────────────── Processes ─────────────────────────────
    @staticmethod
    def _process_row(row: dict[str, Any]) -> dict[str, Any]:
        name = row["process_name"]
        code = str(row["process_id"])
        return {"name": name, "code": code, "label": name}

    def get_processes(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._query(
                "SELECT process_id, process_name FROM process ORDER BY process_id"
            )
        return [self._process_row(r) for r in rows]

    def get_process(self, code: str) -> dict[str, Any] | None:
        pid = _pid(code)
        if pid is None:
            return None
        with self._lock:
            row = self._query_one(
                "SELECT process_id, process_name FROM process WHERE process_id=%s",
                (pid,),
            )
        return self._process_row(row) if row else None

    # ────────────────────────────── Cameras ──────────────────────────────
    @staticmethod
    def _camera_row(row: dict[str, Any]) -> dict[str, Any]:
        name = row["process_name"]
        return {
            "cam_id": str(row["cctv_id"]),
            "label": name,
            "location": name,
            "process_code": str(row["process_id"]),
            "online": True,
            "rtsp_url": row.get("rtsp_url"),
        }

    def get_cameras(self, process_code: str | None = None) -> list[dict[str, Any]]:
        sql = (
            "SELECT p.process_id, p.process_name, c.cctv_id, c.rtsp_url "
            "FROM process p JOIN cctv_info c ON p.cctv_id = c.cctv_id"
        )
        params: tuple[Any, ...] = ()
        if process_code is not None:
            pid = _pid(process_code)
            if pid is None:
                return []
            sql += " WHERE p.process_id=%s"
            params = (pid,)
        sql += " ORDER BY p.process_id"
        with self._lock:
            rows = self._query(sql, params)
        return [self._camera_row(r) for r in rows]

    def get_camera(self, cam_id: str) -> dict[str, Any] | None:
        cid = _pid(cam_id)  # cam_id is str(cctv_id)
        if cid is None:
            return None
        with self._lock:
            row = self._query_one(
                "SELECT p.process_id, p.process_name, c.cctv_id, c.rtsp_url "
                "FROM cctv_info c LEFT JOIN process p ON p.cctv_id = c.cctv_id "
                "WHERE c.cctv_id=%s LIMIT 1",
                (cid,),
            )
        if not row:
            return None
        # cctv may not be wired to any process (LEFT JOIN -> null process fields).
        name = row.get("process_name") or f"CCTV {row['cctv_id']}"
        return {
            "cam_id": str(row["cctv_id"]),
            "label": name,
            "location": name,
            "process_code": str(row["process_id"]) if row.get("process_id") is not None else "",
            "online": True,
            "rtsp_url": row.get("rtsp_url"),
        }

    # ────────────────────────────── Sensors ──────────────────────────────
    @staticmethod
    def _th_reading(row: dict[str, Any]) -> dict[str, Any]:
        # zone/feels_like/dust are not in the ERD; zone falls back to the process
        # that references this sensor (process.th_sensor_id), then a generic label.
        return {
            "sensor_id": str(row["sensor_id"]),
            "sensor_name": row.get("sensor_name"),
            "zone": row.get("process_name") or "온습도 센서",
            "process_code": str(row["process_id"]) if row.get("process_id") is not None else None,
            "temp": float(row["temperature"]),
            "humidity": float(row["humidity"]),
            "feels_like": None,
            "dust": None,
            "timestamp": row["measured_at"].isoformat() if hasattr(row["measured_at"], "isoformat") else str(row["measured_at"]),
        }

    def get_temp_humid(
        self, process_code: str | None = None, sensor_name: str | None = None
    ) -> dict[str, Any]:
        # temperature_humidity_sensor 는 측정마다 새 행이 INSERT 되는 시계열 테이블
        # (sensor_id AUTO_INCREMENT). 따라서 sensor_name 별 "가장 최근(sensor_id 최대)"
        # 행만 골라야 한다. ORDER BY sensor_id ASC + readings[0] 는 가장 오래된 값이
        # 고정 반환되어 모달이 갱신되지 않으므로 사용하면 안 된다.
        cols = (
            "SELECT t.sensor_id, t.sensor_name, t.temperature, t.humidity, t.measured_at, "
            "p.process_id, p.process_name "
            "FROM temperature_humidity_sensor t "
            "LEFT JOIN process p ON p.th_sensor_id = t.sensor_id "
        )
        if sensor_name is not None:
            # 해당 센서의 최신 1행.
            sql = cols + "WHERE t.sensor_name = %s ORDER BY t.sensor_id DESC LIMIT 1"
            params: tuple[Any, ...] = (sensor_name,)
        elif process_code is not None:
            pid = _pid(process_code)
            if pid is None:
                return {"location": self._settings.site_location, "readings": []}
            # 이 공정에 매핑된 센서(process.th_sensor_id)의 sensor_name 의 최신 1행.
            sql = (
                cols
                + "WHERE t.sensor_name = ("
                "  SELECT s.sensor_name FROM process pp "
                "  JOIN temperature_humidity_sensor s ON s.sensor_id = pp.th_sensor_id "
                "  WHERE pp.process_id = %s) "
                "ORDER BY t.sensor_id DESC LIMIT 1"
            )
            params = (pid,)
        else:
            # 전체: sensor_name 별 최신 1행씩.
            sql = (
                cols
                + "JOIN (SELECT sensor_name, MAX(sensor_id) AS max_id "
                "       FROM temperature_humidity_sensor GROUP BY sensor_name) latest "
                "  ON latest.max_id = t.sensor_id "
                "ORDER BY t.sensor_name"
            )
            params = ()
        with self._lock:
            rows = self._query(sql, params)
        return {
            "location": self._settings.site_location,
            "readings": [self._th_reading(r) for r in rows],
        }

    def get_watch(self, process_code: str | None = None) -> dict[str, Any]:
        """One live heart rate from the watch + source-dummy co-workers.

        The DB has a single heartbeat_sensor per process; with one physical
        watch, the first roster member shows the real reading and the rest stay
        dummy. ``process_code`` selects which process's heartbeat sensor supplies
        the live value (falling back to the most recent reading overall).
        """
        process = self.get_process(process_code) if process_code is not None else None
        live: dict[str, Any] | None = None
        with self._lock:
            live = self._query_one(
                "SELECT h.heart_rate, h.measured_at, "
                "%s AS process_id, %s AS process_name "
                "FROM heartbeat_sensor h "
                "ORDER BY h.measured_at DESC, h.sensor_id DESC "
                "LIMIT 1",
                (
                    _pid(process_code) if process_code is not None else None,
                    process["name"] if process else None,
                ),
            )

        roster = copy.deepcopy(dummy_data.WATCH_ROSTER)
        if live is not None and roster:
            roster[0]["hr"] = int(live["heart_rate"])
            roster[0]["timestamp"] = live["measured_at"].isoformat() if hasattr(live["measured_at"], "isoformat") else str(live["measured_at"])
            if live.get("process_id") is not None:
                roster[0]["process_code"] = str(live["process_id"])
            if live.get("process_name"):
                roster[0]["zone"] = live["process_name"]
        return {"region": self._settings.watch_region, "workers": roster}

    # ─────────────────────────── MSDS / Risk (dummy) ───────────────────────────
    def get_msds(self) -> dict[str, Any]:
        return copy.deepcopy(dummy_data.MSDS_DATA)

    def get_risk(self, process_code: str) -> dict[str, Any] | None:
        process = self.get_process(process_code)
        if process is None:
            return None
        name = process["name"]
        found = dummy_data.RISK_BY_PROCESS_NAME.get(name)
        if not found:
            return None
        data = copy.deepcopy(found)
        return {
            "process": name,
            "process_code": process["code"],
            "assessment_date": data["assessment_date"],
            "method": data["method"],
            "rows": data["rows"],
        }

    # ─────────────────────── Unsafe-behavior counters ───────────────────────
    def get_behavior_counts(self, process_code: str) -> dict[str, int]:
        zeros = {cat.id.value: 0 for cat in BEHAVIOR_CATEGORIES}
        pid = _pid(process_code)
        if pid is None:
            return zeros
        with self._lock:
            row = self._query_one(
                "SELECT u.hat_removal_count, u.ladder_alone_count, "
                "u.restricted_area_count, u.speaker_touch_count "
                "FROM process p JOIN unstable_behavior u ON p.behavior_id = u.behavior_id "
                "WHERE p.process_id=%s",
                (pid,),
            )
        if not row:
            return zeros
        return {
            UnsafeBehavior.HELMET_OFF.value: int(row["hat_removal_count"]),
            UnsafeBehavior.TOUCH_EQUIPMENT.value: int(row["speaker_touch_count"]),
            UnsafeBehavior.UNAUTHORIZED_CROSSING.value: int(row["restricted_area_count"]),
            UnsafeBehavior.LADDER_ALONE.value: int(row["ladder_alone_count"]),
        }

    def reset_behavior_counts(self, process_code: str) -> None:
        pid = _pid(process_code)
        if pid is None:
            return
        cols = ", ".join(f"{c} = 0" for c in BEHAVIOR_COLUMN.values())
        with self._lock:
            self._execute(
                f"UPDATE unstable_behavior SET {cols} "
                "WHERE behavior_id = (SELECT behavior_id FROM process WHERE process_id=%s)",
                (pid,),
            )

    def increment_behavior(self, process_code: str, behavior_id: str, delta: int = 1) -> int:
        col = BEHAVIOR_COLUMN.get(behavior_id)
        if col is None:
            raise ValueError(f"Unknown behavior_id: {behavior_id!r}")
        pid = _pid(process_code)
        if pid is None:
            raise ValueError(f"Unknown process code: {process_code!r}")

        # `col` is from a fixed whitelist, so interpolating it is safe.
        with self._lock:
            affected = self._execute(
                f"UPDATE unstable_behavior SET {col} = {col} + %s "
                "WHERE behavior_id = (SELECT behavior_id FROM process WHERE process_id=%s)",
                (delta, pid),
            )
            if not affected:
                # 해당 공정에 unstable_behavior 행이 없거나 process.behavior_id FK가
                # 비어 있는 경우. 분석 파이프라인을 깨지 않도록 500 대신 경고만 남기고
                # 0을 반환한다(카운트는 증가하지 않음 — DB 시드 필요).
                logger.warning(
                    "No unstable_behavior row for process_id=%s "
                    "(unstable_behavior 미시드 또는 process.behavior_id FK 누락); "
                    "증가를 건너뜀. 카운트 0 유지. DB 시드를 확인하세요.",
                    pid,
                )
                return 0
            row = self._query_one(
                f"SELECT {col} AS c FROM unstable_behavior "
                "WHERE behavior_id = (SELECT behavior_id FROM process WHERE process_id=%s)",
                (pid,),
            )
        return int(row["c"]) if row else 0
