"""Standalone smoke test for all 7 endpoints (+ health) using TestClient.

Run: .venv/Scripts/python.exe smoke_test.py
Uses the offline VLM mock path (no external servers required).
"""

import io
import json
import os
import sys

# Force UTF-8 stdout so Korean / subscript chars print on a cp949 console.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Force VLM offline mock + disable real TTS so the test is hermetic.
os.environ["KIOSK_VLM_FORCE_MOCK"] = "true"
os.environ["KIOSK_TTS_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)
PASS = "[PASS]"


def ok(title, resp, ctype=None):
    assert resp.status_code == 200, f"FAILED {title}: {resp.status_code} {resp.text[:300]}"
    if ctype:
        assert resp.headers["content-type"].startswith(ctype), resp.headers["content-type"]
    print(f"{PASS} {title} -> {resp.status_code} ({resp.headers.get('content-type')})")


with client:
    # health
    r = client.get("/health"); ok("GET /health", r)
    assert r.json()["repository"] == "mock"

    # space-name
    r = client.get("/space-name", params={"process_code": "PRC-19"}); ok("GET /space-name?PRC-19", r)
    b = r.json()
    assert b["process"]["name"] == "정밀가공 공정"
    assert b["process"]["code"] == "PRC-19"
    assert len(b["behaviors"]) == 4
    assert b["behaviors"][0]["name"] == "모자(안전모) 벗는 행동"
    assert b["behaviors"][0]["count"] == 3
    assert len(b["processes"]) == 5
    assert b["temp_humid"]["sensor_id"] == "TH-01"
    assert any(c["cam_id"] == "CAM-03" for c in b["cameras"])
    print(f"      process={b['process']['label']} behaviors={[(x['name'], x['count']) for x in b['behaviors']]}")

    # default process
    r = client.get("/space-name"); ok("GET /space-name (default)", r)
    assert r.json()["process"]["code"] == "PRC-19"

    # temp-humid
    r = client.get("/sensor/temp-humid"); ok("GET /sensor/temp-humid", r)
    b = r.json()
    assert b["location"] == "경기도 고양시" and b["count"] == 5
    assert b["readings"][0]["temp"] == 27.4

    # watch
    r = client.get("/sensor/watch"); ok("GET /sensor/watch", r)
    b = r.json()
    assert b["count"] == 8
    statuses = {w["watch_id"]: w["status"] for w in b["workers"]}
    assert statuses["WATCH-01"] == "정상"   # hr 88
    assert statuses["WATCH-04"] == "주의"   # hr 115 (>=110)
    assert statuses["WATCH-06"] == "위험"   # hr 133 (>=130)
    print(f"      watch statuses: {statuses}")

    # msds
    r = client.get("/modal/msds"); ok("GET /modal/msds", r)
    b = r.json()
    assert b["count"] == 4
    assert b["chemicals"][0]["cas"] == "7647-01-0"
    assert "H₂SO₄" == b["chemicals"][1]["formula"]
    print(f"      chemicals={[c['key'] for c in b['chemicals']]}")

    # risk
    r = client.get("/modal/risk", params={"process_code": "PRC-19"}); ok("GET /modal/risk?PRC-19", r)
    b = r.json()
    assert b["process_code"] == "PRC-19" and b["method"] == "4M"
    assert b["summary"]["total"] == len(b["rows"])
    assert b["rows"][0]["risk_score"] == 15 and b["rows"][0]["risk_level"] == "high"
    print(f"      summary={b['summary']}")

    # cctv frame (binary)
    r = client.get("/cctv/frame"); ok("GET /cctv/frame", r, ctype="image/jpeg")
    assert r.content[:2] == b"\xff\xd8"  # JPEG SOI
    print(f"      frame: {len(r.content)} bytes, source={r.headers.get('x-frame-source')}")

    # vlm pipeline x3 — watch the count climb thresholds
    for i in range(3):
        r = client.post("/vlm/infer", json={"camera_id": "CAM-03", "process_code": "PRC-19"})
        ok(f"POST /vlm/infer (#{i+1})", r)
        b = r.json()
        assert b["source"] == "mock"
        wl = b["warning_light"]
        print(f"      detection={b['detection']!r}")
        print(f"      warning_text={b['warning_text']!r}")
        print(f"      behaviors={[(d['name'], d['count']) for d in b['behaviors']]}")
        print(f"      light={wl['state']}/{wl['label']} trigger_count={wl['trigger_count']} tts={b['tts']['status']}")

print(f"\n{PASS} ALL SMOKE TESTS PASSED")
