"""Source-fixed dummy data for entities that are NOT in the MySQL ERD.

The confirmed Shared DB schema covers only 5 tables (process, temp/humid sensor,
heartbeat sensor, cctv_info, unstable_behavior). Everything the kiosk shows that
is *not* one of those — MSDS chemical sheets, risk assessments, and the human
roster behind the heart-rate watches — is hard-coded here, by design.

``SqlRepository`` imports these to serve the parts of the kiosk UI that have no
backing DB table.
"""

from __future__ import annotations

from typing import Any

# ───────────────────────────── MSDS (전사 공통) ─────────────────────────────
# Mirrors mock_data/msds.json. ``site`` is a static label (no DB column).
MSDS_DATA: dict[str, Any] = {
    "site": "고양시사업장",
    "chemicals": [
        {
            "key": "염산",
            "name": "염산 (Hydrochloric acid)",
            "cas": "7647-01-0",
            "formula": "HCl",
            "un": "UN1789",
            "signal": "위험",
            "hazard": [
                "피부에 심한 화상과 눈 손상을 일으킴 (H314)",
                "호흡기 자극을 일으킬 수 있음 (H335)",
                "금속을 부식시킬 수 있음 (H290)",
            ],
            "handling": "국소배기장치 사용, 내산성 보호장갑·보안경·방독마스크 착용",
            "storage": "서늘하고 환기되는 곳, 알칼리·금속과 격리",
        },
        {
            "key": "황산",
            "name": "황산 (Sulfuric acid)",
            "cas": "7664-93-9",
            "formula": "H₂SO₄",
            "un": "UN1830",
            "signal": "위험",
            "hazard": [
                "피부에 심한 화상과 눈 손상을 일으킴 (H314)",
                "강한 산화성·부식성",
                "물과 급격히 반응하여 발열",
            ],
            "handling": "반드시 물에 산을 천천히 첨가, 내산성 PPE 필수",
            "storage": "밀폐 용기, 가연물·유기물과 격리",
        },
        {
            "key": "에틸 알코올",
            "name": "에탄올 (Ethanol)",
            "cas": "64-17-5",
            "formula": "C₂H₅OH",
            "un": "UN1170",
            "signal": "위험",
            "hazard": [
                "고인화성 액체 및 증기 (H225)",
                "심한 눈 자극을 일으킴 (H319)",
            ],
            "handling": "화기 엄금, 정전기 방지, 환기 유지",
            "storage": "인화성 물질 보관소, 점화원과 격리",
        },
        {
            "key": "락카페인트 스프레이 (육각)",
            "name": "락카페인트 스프레이",
            "cas": "혼합물",
            "formula": "Mixture",
            "un": "UN1950",
            "signal": "위험",
            "hazard": [
                "극인화성 에어로졸 (H222)",
                "가열 시 폭발 위험 (H229)",
                "졸음 또는 현기증 유발 가능 (H336)",
            ],
            "handling": "화기 엄금, 환기되는 곳에서 사용, 방독마스크 착용",
            "storage": "50°C 이하, 직사광선 피함, 점화원과 격리",
        },
    ],
}


# ─────────────────────────── 위험성평가 (공정별) ───────────────────────────
# Keyed by ``process_name`` (the DB has no process code). ``SqlRepository``
# resolves process_id -> process_name and looks up here. A process without an
# entry yields the existing 404 behavior. ``process_code`` is filled in at
# request time with the real API code (str(process_id)).
RISK_BY_PROCESS_NAME: dict[str, dict[str, Any]] = {
    "정밀가공 공정": {
        "assessment_date": "2026-05-12",
        "method": "4M",
        "rows": [
            {"hazard": "고속 회전체 협착·말림", "likelihood": 3, "severity": 5, "control": "방호덮개 설치·연동장치"},
            {"hazard": "화학물질(염산) 누출 노출", "likelihood": 3, "severity": 5, "control": "국소배기·내산 PPE"},
            {"hazard": "절삭칩 비산 안구 손상", "likelihood": 4, "severity": 3, "control": "보안경 착용 의무화"},
            {"hazard": "소음(76dB) 청력 영향", "likelihood": 3, "severity": 3, "control": "귀마개·소음원 격리"},
            {"hazard": "고소작업 추락", "likelihood": 2, "severity": 4, "control": "안전대·작업발판"},
            {"hazard": "중량물 취급 근골격계", "likelihood": 3, "severity": 2, "control": "운반보조구·작업순환"},
            {"hazard": "전기 감전", "likelihood": 2, "severity": 3, "control": "접지·누전차단기"},
        ],
    },
    "용접 공정": {
        "assessment_date": "2026-05-12",
        "method": "4M",
        "rows": [
            {"hazard": "용접 흄·유해가스 흡입", "likelihood": 4, "severity": 4, "control": "국소배기·방진마스크"},
            {"hazard": "아크광 안구 손상", "likelihood": 4, "severity": 3, "control": "차광보안면 착용"},
            {"hazard": "불티 비산 화재", "likelihood": 3, "severity": 5, "control": "불티방지포·화기감시자"},
            {"hazard": "고온 표면 화상", "likelihood": 3, "severity": 3, "control": "내열장갑·격리"},
            {"hazard": "전격(감전)", "likelihood": 2, "severity": 4, "control": "자동전격방지기"},
        ],
    },
}


# ────────────────────────── 워치 작업자 로스터 ──────────────────────────
# The DB has a single watch (heartbeat_sensor). One roster member shows the
# *real* heart rate from MySQL; the rest stay dummy. Each entry is shaped for
# ``sensor_service.get_watch`` (reads watch_id/name/hr/zone/process_code/device).
# ``hr`` here is a dummy fallback; the live entry's hr is overwritten by the DB.
WATCH_ROSTER: list[dict[str, Any]] = [
    {"watch_id": "WATCH-01", "name": "이정학", "hr": 88, "zone": "정밀가공 시연존", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-02", "name": "전병조", "hr": 102, "zone": "절단·용접 시연존", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-03", "name": "김도현", "hr": 76, "zone": "스프레이 도장실", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-04", "name": "이서준", "hr": 115, "zone": "메인 조립 라인", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-05", "name": "박지후", "hr": 94, "zone": "정밀가공 시연존", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-06", "name": "최민재", "hr": 99, "zone": "입출고 하역장", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-07", "name": "정우진", "hr": 81, "zone": "절단·용접 시연존", "process_code": None, "device": "Galaxy Watch"},
    {"watch_id": "WATCH-08", "name": "강하준", "hr": 91, "zone": "메인 조립 라인", "process_code": None, "device": "Galaxy Watch"},
]
