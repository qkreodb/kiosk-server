# VLM 탐지 라벨 개편 연동

VLM Server가 탐지하는 불안전행동 라벨이 변경됨에 따라 키오스크 서버/프론트에 반영한 내역.

## 1. 변경된 VLM 탐지 라벨 (`LABEL_KO`)

VLM Server가 `/analyze` 응답의 `action` 키로 내보내는 탐지 라벨이 아래와 같이 바뀌었다.
**기존 4개 명칭 변경 + 신규 탐지객체 `safety_vest` 1개 추가.**

```python
LABEL_KO = {
    "helmet_off":     "안전모 미착용",
    "cone_touch":     "라바콘 접촉",
    "fence_crossing": "위험 펜스 넘음",
    "ladder_alone":   "사다리 단독 이용",
    "safety_vest":    "안전 고리 미착용",   # 신규
}
```

### 기존 ↔ 변경 대응표

| 기존 action 키 | 기존 명칭 | → 신규 키 | 신규 명칭 | DB 컬럼 |
|---|---|---|---|---|
| `hat_action` | 모자(안전모) 벗는 행동 | `helmet_off` | 안전모 미착용 | `hat_removal_count` |
| `touch_action` | 스피커(설비) 만지는 행동 | `cone_touch` | 라바콘 접촉 | `speaker_touch_count` *(재사용)* |
| `dangerInOut_action` | 위험지역 무단횡단 행동 | `fence_crossing` | 위험 펜스 넘음 | `restricted_area_count` *(재사용)* |
| `ladder_action` | 사다리 혼자 올라가는 행동 | `ladder_alone` | 사다리 단독 이용 | `ladder_alone_count` |
| — (신규) | — | `safety_vest` | 안전 고리 미착용 | `safety_vest_count` **(신규 컬럼)** |

> 핵심 변화점
> - VLM `action` 키가 `*_action` 접미사 형태에서 탐지 라벨 키(`helmet_off` 등)로 바뀌어,
>   이제 `UnsafeBehavior` enum 값과 **1:1로 동일**하다(키 변환 불필요).
> - `cone_touch`/`fence_crossing`은 의미만 바뀌고 기존 DB 컬럼
>   (`speaker_touch_count`/`restricted_area_count`)을 그대로 재사용한다(컬럼 추가 없음).
> - `safety_vest`는 `unstable_behavior`에 **`safety_vest_count` 컬럼이 신규 추가**되어 매핑된다.

## 2. 백엔드 변경

### `app/domain/constants.py`
- `UnsafeBehavior` enum: `TOUCH_EQUIPMENT`→`CONE_TOUCH`, `UNAUTHORIZED_CROSSING`→`FENCE_CROSSING`,
  신규 `SAFETY_VEST` 추가 (총 5개). 값은 VLM 라벨 키와 동일.
- `BEHAVIOR_CATEGORIES`: 명칭/키워드 갱신 + `safety_vest` 카테고리 추가.
  - `helmet_off` 안전모 미착용 — 위험
  - `cone_touch` 라바콘 접촉 — 주의
  - `fence_crossing` 위험 펜스 넘음 — 위험
  - `ladder_alone` 사다리 단독 이용 — 정상
  - `safety_vest` 안전 고리 미착용 — 위험
- `VLM_ACTION_KEY_MAP`: 신규 5개 키로 교체(키 = enum 값).
- `VLM_DETECT_ACTIONS`: 신규 5개 키+라벨로 교체.

### `app/repositories/sql_repository.py`
- `BEHAVIOR_COLUMN`: `cone_touch`→`speaker_touch_count`, `fence_crossing`→`restricted_area_count`,
  `safety_vest`→`safety_vest_count` 추가.
- `get_behavior_counts()`: SELECT 절에 `safety_vest_count` 추가, 반환 dict에 5개 카테고리 반영.

### `app/integrations/vlm_client.py`
- 오프라인 mock 시나리오(`_MOCK_SCENES`)의 `action` 키를 신규 키로 교체(`safety_vest` 시나리오 포함).

### `app/schemas/vlm.py`
- 응답 예시(examples) 문자열을 신규 명칭으로 갱신.

> `app/repositories/mock_repository.py`와 `app/services/space_service.py`는
> `BEHAVIOR_CATEGORIES`를 동적으로 사용하므로 코드 수정 없이 자동 반영된다.

## 3. DB 변경

`unstable_behavior` 테이블에 `safety_vest_count` 컬럼 신규 추가(Jetson 실 DB 반영 완료).

```sql
ALTER TABLE unstable_behavior
  ADD COLUMN safety_vest_count INT NOT NULL DEFAULT 0;
```

- `db/schema.sql`: 컬럼 추가 + 컬럼↔행동 주석 갱신.
- `db/seed.sql`: INSERT에 `safety_vest_count` 값 추가.
- `mock_data/behavior_seed.json`: 공정별 시드 키를 신규 키로 교체 + `safety_vest` 추가.

## 4. 프론트엔드 변경 (`kiosk.html`)

"불안전행동 감시 신호등" 표(`#bhMatrix`)의 4개 행 명칭/`data-focus-key`/`data-focus-label`을
신규 라벨로 갱신하고, **`safety_vest`(안전 고리 미착용) 행 1개를 추가**(총 5행).

- 표의 행 순서는 `BEHAVIOR_CATEGORIES` 순서와 동일해야 한다
  (`hydrateMatrix()`가 `/space-name`의 `behaviors`를 **인덱스 기준**으로 각 행 램프에 매핑).
- 행 순서: 안전모 미착용 → 라바콘 접촉 → 위험 펜스 넘음 → 사다리 단독 이용 → 안전 고리 미착용.

## 5. 검증

- `BEHAVIOR_CATEGORIES`(5개) ↔ `VLM_ACTION_KEY_MAP` 키 ↔ `BEHAVIOR_COLUMN` 키 일치.
- `behavior_seed.json` 각 공정 키가 5개 카테고리와 일치.
- mock 시나리오의 모든 `action` 키가 `VLM_ACTION_KEY_MAP`에 존재.
- 프론트 표 5행 ↔ 백엔드 `behaviors` 5개 순서 일치.
