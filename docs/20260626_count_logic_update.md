# 경광등 카운트 로직 및 VLM 연동 수정 (2026-06-26)

## 1. 변경 배경 및 목적

기존에는 VLM 분석마다 불안전행동 카운트가 1씩 증가하고, **누적 카운트 단독**으로
경광등 단계가 즉시 바뀌는 구조였다. 또한 경광등 트리거가 "4대(현재 5대) 행동의
누적 카운트 최대값" 기준이라, 이번 사이클에 아무것도 탐지되지 않은 안전 상황에서도
과거 누적 카운트만으로 경광등이 계속 울리는 문제가 있었다.

이를 아래 목적에 맞게 개편한다.

- 카운트 단계 기준을 **1 / 5 / 10 / 15** 로 재정의(초록→노랑→빨강→점멸).
- 한 번에 여러 위험이 탐지되면 **가장 높은 카운트 항목의 단계**를 경광등에 반영.
- **안전 결과(탐지 없음) 사이클에서는 경광등을 울리지 않는다**(카운트 단독 발동 금지).
- VLM 분석 요청 주기를 **2~3초**로 단축(응답 속도 우선), 설정값으로 분리.

## 2. 경광등 카운트 단계 기준표

| count | 단계 | 색상/동작 | 내부 상태(`WarningLightState`) | LED 레벨 |
|---|---|---|---|---|
| `0` | 소등 | OFF | `OFF` | — |
| `1 ≤ count < 5` | 관심 | 초록불 (첫 탐지 `count==1`부터 유지) | `GREEN` | `interest` |
| `5 ≤ count < 10` | 주의 | 노란불 | `YELLOW_BLINK` | `caution` |
| `10 ≤ count < 15` | 위험(경고) | 빨간불 | `RED_BLINK` | `warning` |
| `count ≥ 15` | 경보 | 점멸 (색상 교번 반복) | `SEQUENCE` | `danger` |

임계값은 환경설정으로 분리되어 있다(`KIOSK_LIGHT_*_THRESHOLD`).

| 설정 키 | 값 | 의미 |
|---|---|---|
| `KIOSK_LIGHT_INTEREST_THRESHOLD` | `1` | 초록 시작 |
| `KIOSK_LIGHT_CAUTION_THRESHOLD` | `5` | 노랑 시작 |
| `KIOSK_LIGHT_WARNING_THRESHOLD` | `10` | 빨강 시작 |
| `KIOSK_LIGHT_DANGER_THRESHOLD` | `15` | 점멸 시작 |

## 3. 다중 탐지 우선순위 규칙

VLM이 한 번의 분석에서 여러 위험을 동시에 탐지해 각각 카운트가 증가하면,
경광등은 **그중 카운트가 가장 높은 항목의 단계**를 출력한다.

- 트리거 카운트 = `max(이번 사이클에 탐지된 각 행동의 카운트)`.
- 예: 상황 A `count=5`, 상황 B `count=15` 동시 탐지 → 최종 경광등은 `count=15`
  기준 **점멸(SEQUENCE)** 로 동작.

> 이전 로직은 "탐지 여부와 무관하게 전체 행동의 누적 최대값"을 사용했으나,
> 이제는 **이번 사이클에 실제 탐지된 항목들의 카운트**만으로 단계를 산정한다.

## 4. VLM 안전 결과 시 경광등 비발동 규칙

- VLM 분석 결과가 **안전(탐지 없음, 빈 결과)** 이면, 누적 카운트가 노랑/빨강/점멸
  기준 이상이라도 **해당 사이클에서는 경광등을 울리지 않는다**.
- 즉 경광등 트리거는 반드시 **이번 사이클에 VLM 탐지가 존재할 때만** 발동한다.
  카운트 단독으로는 절대 발동하지 않는다.
- 구현: `has_detection = bool(deltas)` 가 거짓이면 상태를 `OFF`로 강제하고
  경광등/실물 LED dispatch를 모두 건너뛴다.

## 5. VLM 분석 주기 변경 내용

- 프론트의 CCTV 연속 분석 루프 주기(성공 응답 후 다음 요청까지 대기)를
  `5000ms → 2500ms`(2~3초)로 단축.
- 하드코딩이 아니라 명명 상수 `VLM_POLL_INTERVAL_MS` 하나로만 조정하도록 유지
  (`js/backend.js`). 오류 백오프(`VLM_ERROR_BACKOFF_MS=1500ms`)는 변경 없음.

## 6. 수정된 파일 목록 및 함수명

| 파일 | 변경 내용 | 함수/심볼 |
|---|---|---|
| `app/services/vlm_service.py` | 경광등 발동 게이팅 + 다중탐지 우선순위 적용. 탐지 없으면 OFF/미발동, 트리거 카운트는 이번 사이클 탐지 항목의 최대 카운트로 산정 | `VlmService.infer()` (BRANCH B) |
| `app/core/config.py` | 경광등 임계값 기본값 `1/2/3/4 → 1/5/10/15` 및 주석 갱신 | `Settings.light_interest_threshold` / `light_caution_threshold` / `light_warning_threshold` / `light_danger_threshold` |
| `.env`, `.env.example` | 런타임 임계값 `1/2/3/4 → 1/5/10/15` 갱신 | `KIOSK_LIGHT_*_THRESHOLD` |
| `js/backend.js` | VLM 분석 주기 `5000 → 2500ms` 상수 변경(주석 정리) | `VLM_POLL_INTERVAL_MS` |

> 단계 산정 함수 `VlmService._warning_light_state(count)` 자체는 임계값을 설정에서
> 읽으므로 코드 변경 없이 새 기준(1/5/10/15)을 그대로 따른다.

### 제약 준수 확인
- git commit/push 미수행.
- DB 스키마 변경 없음(카운트 증가/조회 로직 그대로 사용).
- x86 전용 패키지 추가 없음(Jetson ARM64 호환 유지).
- MQTT 기반 inter-service 통신 구조 변경 없음.
- 변경 범위 최소화: 임계값/게이팅/주기만 수정.

## 7. 테스트 시나리오 (예상 동작)

로컬에서 `MockRepository` + 강제 mock VLM(`KIOSK_VLM_FORCE_MOCK=true`)으로 검증.

| # | 입력(이번 사이클) | 카운트 상태 | 기대 경광등 | 발동 여부 |
|---|---|---|---|---|
| 1 | `helmet_off` 탐지 | helmet_off=1 | 초록(GREEN) | 발동 |
| 2 | `helmet_off` 탐지 | helmet_off=16 | 점멸(SEQUENCE) | 발동 |
| 3 | **탐지 없음(안전)** | helmet_off=16 (여전히 높음) | 소등(OFF) | **미발동** |
| 4 | `helmet_off`+`cone_touch` 동시 탐지 | helmet_off=16, cone_touch=6 | 점멸(SEQUENCE, 16 기준) | 발동 |
| 5 | `cone_touch` 단독 탐지 | cone_touch=5 | 노랑(YELLOW_BLINK) | 발동 |
| 6 | `fence_crossing` 단독 탐지 | fence_crossing=10 | 빨강(RED_BLINK) | 발동 |

### 실측 결과 (인메모리 mock 검증)
```
cycle1 detect(count1):        state=green     trigger=1   dispatched=True
cycle2 detect(count high):    state=sequence  trigger=16  dispatched=True
cycle3 SAFE(count still high): state=off       trigger=0   dispatched=False (dispatch 호출 0회)
cycle4 multi(helmet16,cone6): state=sequence  trigger=16
```

- 단계 매핑: `0→off, 1~4→green, 5~9→yellow, 10~14→red, 15+→sequence` 확인.
- 안전 사이클(#3)에서 카운트가 높아도 경광등 미발동(dispatch 미호출) 확인.
- 다중 탐지(#4)에서 최고 카운트(16) 기준 단계 적용 확인.
