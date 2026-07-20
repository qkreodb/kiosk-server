"""여름철 체감온도(Heat Index) 계산.

기상청(KMA)이 2020년부터 사용하는 여름철 체감온도 공식을 그대로 구현한다.
계산은 2단계다:

  1. Stull(2011) 근사식으로 습구온도 Tw 를 구한다.
  2. 기상청 체감온도(TWI) 공식에 Tw 와 기온 Ta 를 넣는다.

실내 온습도 센서(shelly/sonoff)만 다루므로 풍속이 필요한 겨울철 체감온도
(Wind Chill)는 구현하지 않는다. 기온이 낮으면 위 공식은 실제보다 높은 값을
내놓으므로, 호출부는 ``HEAT_INDEX_MIN_TEMP`` 미만에서 기온을 그대로 쓴다.

의존성은 표준 ``math`` 뿐이다 (라즈베리파이 등 ARM 보드에서 numpy 없이 동작).
"""

from __future__ import annotations

import math

#: 이 기온(°C) 미만에서는 여름철 체감온도 공식을 적용하지 않는다.
HEAT_INDEX_MIN_TEMP = 27.0


def calculate_wet_bulb_temp(ta: float, rh: float) -> float:
    """기온 ``ta``(°C)와 상대습도 ``rh``(%)의 습구온도(°C).

    Stull(2011) 근사식. 원 논문의 유효 범위는 기온 -20~50°C, 습도 5~99% 이며
    그 안에서 오차는 대략 ±1°C 다.
    """
    rh = _clamp_humidity(rh)
    return (
        ta * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(ta + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * math.pow(rh, 1.5) * math.atan(0.023101 * rh)
        - 4.686035
    )


def calculate_heat_index(ta: float, rh: float) -> float:
    """기온 ``ta``(°C)와 상대습도 ``rh``(%)의 여름철 체감온도(°C).

    기상청 TWI 공식. 저온에서는 기온보다 높은 값이 나올 수 있으므로 여름철
    (``HEAT_INDEX_MIN_TEMP`` 이상)에만 의미가 있다 — 판단은 호출부 책임이다.
    """
    tw = calculate_wet_bulb_temp(ta, rh)
    return (
        -0.2442
        + 0.55399 * tw
        + 0.45535 * ta
        - 0.0022 * math.pow(tw, 2)
        + 0.00278 * tw * ta
        + 3.0
    )


def calculate_feels_like(ta: float, rh: float) -> float:
    """조회 시점에 쓰는 체감온도(°C), 소수 1자리 반올림.

    ``HEAT_INDEX_MIN_TEMP`` 미만이면 기온을 그대로 돌려준다.
    """
    if ta < HEAT_INDEX_MIN_TEMP:
        return round(ta, 1)
    return round(calculate_heat_index(ta, rh), 1)


def _clamp_humidity(rh: float) -> float:
    # 센서 노이즈로 0 미만/100 초과가 들어오면 sqrt·atan 항이 발산한다.
    return min(100.0, max(0.0, rh))


# ── 체감온도 등급 (js/app.js:174-181 ENV_FEELS_GRADES 그대로 포팅) ───────────
# 원본:
#   const ENV_FEELS_GRADES = [
#     { min: 38, cls: 'grade-danger',    label: '위험' },
#     { min: 35, cls: 'grade-warning',   label: '경고' },
#     { min: 33, cls: 'grade-caution',   label: '주의' },
#     { min: 31, cls: 'grade-attention', label: '관심' },
#     { min: -Infinity, cls: 'grade-normal', label: '정상' },
#   ];
# 임계값(31/33/35/38 — 기상청 폭염 체감온도 단계)은 JS 원본 그대로이며 설정으로
# 빼거나 변형하지 않는다. 내림차순으로 나열해 "하한 이상인 첫 항목"을 채택한다.
FEELS_GRADES: list[tuple[float, str]] = [
    (38.0, "위험"),
    (35.0, "경고"),
    (33.0, "주의"),
    (31.0, "관심"),
    (float("-inf"), "정상"),
]


def grade_feels_like(feels: float) -> str:
    """체감온도(°C)를 기상청 폭염 체감온도 단계 라벨로 분류.

    js/app.js:192-193 의 ``ENV_FEELS_GRADES.find((g) => feels >= g.min)`` 과
    동일한 판정: 경계값은 포함이다(예: 정확히 38.0°C 는 "위험").
    """
    for min_temp, label in FEELS_GRADES:
        if feels >= min_temp:
            return label
    return "정상"  # FEELS_GRADES 마지막 항목이 -inf 라 이 줄에는 도달하지 않는다.
