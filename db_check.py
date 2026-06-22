r"""Quick MySQL connectivity check for the Kiosk Shared DB.

Connects using the same KIOSK_DB_* settings the server uses, runs SELECT 1, and
prints a row count per ERD table. Use this to verify the Jetson DB (or a local
copy) is reachable before starting the server with KIOSK_REPOSITORY=mysql.

Usage (Windows PowerShell):
    .\.venv\Scripts\python.exe db_check.py
"""

from __future__ import annotations

import sys

# Force UTF-8 so Korean output isn't mangled on cp949 consoles.
sys.stdout.reconfigure(encoding="utf-8")

import pymysql  # noqa: E402

from app.core.config import get_settings  # noqa: E402

TABLES = (
    "process",
    "temperature_humidity_sensor",
    "heartbeat_sensor",
    "cctv_info",
    "unstable_behavior",
)


def main() -> int:
    s = get_settings()
    print(f"Connecting to mysql://{s.db_user}@{s.db_host}:{s.db_port}/{s.db_name} ...")
    try:
        conn = pymysql.connect(
            host=s.db_host,
            port=s.db_port,
            user=s.db_user,
            password=s.db_password,
            database=s.db_name,
            charset=s.db_charset,
            connect_timeout=s.db_connect_timeout,
            autocommit=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 연결 실패: {exc}")
        return 1

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
            print("[OK] SELECT 1")
            for table in TABLES:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    (count,) = cur.fetchone()
                    print(f"[OK] {table:<32} rows={count}")
                except Exception as exc:  # noqa: BLE001
                    print(f"[FAIL] {table:<32} {exc}")
    finally:
        conn.close()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
