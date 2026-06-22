# AI 핸드오프 문서 (다음 세션용 빠른 파악 가이드)

> **이 문서의 목적**: 사용자가 다음에 작업을 지시할 때, AI(Claude)가 전체 시스템을
> 처음부터 다시 분석하지 않고 **이 문서 하나만 읽고 바로 수정에 착수**하기 위한 컨텍스트.
> "이미 이런 서버가 구축돼 있다"는 전제로 사용자가 수정 요청을 한다.
>
> 📌 다음 세션 첫 작업: **이 파일 → `docs/진행상황.md` 순으로 읽으면 100% 파악됨.**
> 💡 팁: 이 파일을 루트로 옮겨 `CLAUDE.md` 로 두면 세션 시작 시 자동 로드됨.

최종 업데이트: 2026-06-22

---

## 1. 한 줄 요약

산업 안전보건 **키오스크 백엔드 = Kiosk Main Server (FastAPI, PORT 8080)** 가 구축 완료됨.
1080×1920 터치 키오스크 프론트(`kiosk.html`)에 데이터를 공급하며, 프론트는 이 백엔드에
**실시간 연동**되어 있다. DB·VLM·TTS·액추에이터는 전부 **mock/stub** 이고, 실제 연동
지점은 인터페이스 뒤에 깔끔히 분리돼 있다.

---

## 2. 현재 상태

- ✅ 7개 엔드포인트 + `/health` + `/docs` 전부 동작 (smoke_test 통과).
- ✅ `kiosk.html` 프론트가 백엔드에 연동됨(파일 하단 `<script>` IIFE). 백엔드 꺼지면 기존 하드코딩으로 fallback.
- ✅ `.venv` 가상환경에 의존성 설치 완료 (Python 3.12, PyMySQL 포함).
- ✅ **실제 MySQL(Jetson) 연동 구현 완료** — 확정 ERD 5개 테이블을 `SqlRepository`(PyMySQL raw SQL)로
  실시간 조회/갱신. `KIOSK_REPOSITORY=mysql` 로 활성화, DB 연결 실패 시 자동으로 mock 폴백.
  ERD에 없는 MSDS/위험성평가/워치 작업자 명단은 `app/repositories/dummy_data.py` 소스 더미.
  - 공정 식별자: DB에 코드 컬럼이 없어 API `code = str(process_id)`, `name/label = process_name`.
  - 심박: 워치 1대 → 작업자 1명만 실제 `heart_rate`, 나머지는 더미 로스터.
  - `unstable_behavior` 컬럼↔행동 매핑: hat_removal=helmet_off, speaker_touch=touch_equipment,
    restricted_area=unauthorized_crossing, ladder_alone=ladder_alone.
- ⚠️ **Git 커밋/푸시는 절대 하지 않음** — 모든 git 작업은 사람이 직접 한다. (작업 시 이 규칙 반드시 유지)
- ⚠️ 서버는 평소 꺼져 있음. 필요 시 아래 명령으로 기동.

### 실행 / 검증 명령 (Windows PowerShell, 작업 디렉터리 = `C:\workspace\kiosk_front`)
```powershell
# 서버 기동 (PORT 8080)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080

# 전체 엔드포인트 스모크 테스트 (외부 서버 불필요, VLM 오프라인 mock 사용)
.\.venv\Scripts\python.exe smoke_test.py

# 프론트 열기
start "" "C:\workspace\kiosk_front\kiosk.html"

# 실제 MySQL 모드로 기동 (.env 에 KIOSK_REPOSITORY=mysql + KIOSK_DB_* 설정)
$env:KIOSK_REPOSITORY="mysql"; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080
# DB 연결 점검 (SELECT 1 + 5테이블 카운트)
.\.venv\Scripts\python.exe db_check.py
# 로컬 테스트용 DB 구축(참고): mysql < db/schema.sql ; mysql kiosk < db/seed.sql
```
- Swagger: http://localhost:8080/docs · Health: http://localhost:8080/health
  (`/health` 의 `repository` 필드는 폴백 반영된 **실제** 활성 저장소를 표시: `mock`/`mysql`)

---

## 3. 디렉터리 맵 (어디에 뭐가 있나)

```
app/
  main.py                  # 앱 팩토리, CORS, 라우터 등록, lifespan, "/" + 루트 응답
  core/config.py           # ★ 모든 설정 (env 접두사 KIOSK_). 포트/VLM URL/Shared Dir/임계값 등 전부 여기
  core/logging.py
  domain/constants.py      # ★ 4대 불안전행동 카테고리 + 경광등 상태/라벨 (도메인 단일 진실원)
  schemas/
    common.py              # HealthResponse, CameraInfo
    space.py               # /space-name DTO (ProcessSummary, BehaviorCount, SpaceNameResponse)
    sensor.py              # 온습도/심박 DTO (TempHumidReading/Response, WatchReading/Response)
    modal.py               # MSDS/위험성평가 DTO
    vlm.py                 # /vlm/infer 요청·응답 DTO
  repositories/
    base.py                # ★ KioskRepository 추상 인터페이스 (Shared DB seam)
    mock_repository.py     # JSON 픽스처 + in-memory 카운터 구현 (개발/폴백용)
    sql_repository.py      # ★ 실제 MySQL(Jetson) 구현 — PyMySQL raw SQL (확정 ERD 5테이블)
    dummy_data.py          # ★ ERD 외 소스 더미 (MSDS / 위험성평가 / 워치 작업자 로스터)
    factory.py             # ★ 저장소 선택 지점 (mock|mysql) + mysql 연결 실패 시 mock 폴백
  integrations/
    vlm_client.py          # 외부 VLM /infer HTTP 클라이언트 + 오프라인 mock (탐지/위험경고텍스트)
    tts.py                 # edge-tts 음성 합성 래퍼 (헤드리스 fallback 포함)
    shared_dir.py          # Shared Dir 최신 프레임 읽기 + placeholder JPEG
    actuators.py           # 스피커/경광등 출력 (로그 stub)
  services/
    space_service.py       # /space-name 로직
    sensor_service.py      # 온습도/심박 로직 (심박 status 임계값: ≥130 위험, ≥110 주의)
    modal_service.py       # MSDS/위험성평가 로직 (risk_score=가능성×중대성, high≥15/mid≥8/low)
    cctv_service.py        # 프레임 제공 로직
    vlm_service.py         # ★ /vlm/infer 파이프라인 오케스트레이션 (핵심)
  api/
    deps.py                # ★ 의존성 주입 — service/integration 싱글톤 와이어링
    routers/
      health.py space.py sensor.py modal.py cctv.py vlm.py
mock_data/                 # ★ Shared DB 모사 JSON 픽스처 — 데이터 값 바꾸려면 여기
  processes.json cameras.json sensors_temp_humid.json watch.json
  msds.json risk.json behavior_seed.json
docs/
  진행상황.md              # 상세 결과 보고서(한글)
  AI_HANDOFF.md            # (이 문서)
db/                        # ★ 로컬 테스트용 참고 DDL/시드 (Jetson DB는 이미 구축됨)
  schema.sql seed.sql
kiosk.html                 # 프론트엔드. 맨 아래 <script> IIFE 가 백엔드 연동 코드
smoke_test.py              # 전체 엔드포인트 검증 스크립트 (mock 경로)
db_check.py                # MySQL 연결 점검 스크립트
requirements.txt .env.example README.md .gitignore
```

---

## 4. 엔드포인트 → 코드 위치 매핑

| Method | Path | Router | Service | Schema |
|---|---|---|---|---|
| GET | `/health` | `routers/health.py` | — | `schemas/common.py` |
| GET | `/space-name` | `routers/space.py` | `space_service.py` | `schemas/space.py` |
| GET | `/sensor/temp-humid` | `routers/sensor.py` | `sensor_service.py` | `schemas/sensor.py` |
| GET | `/sensor/watch` | `routers/sensor.py` | `sensor_service.py` | `schemas/sensor.py` |
| GET | `/modal/msds` | `routers/modal.py` | `modal_service.py` | `schemas/modal.py` |
| GET | `/modal/risk` | `routers/modal.py` | `modal_service.py` | `schemas/modal.py` |
| GET | `/cctv/frame` (+`/cctv/stream`) | `routers/cctv.py` | `cctv_service.py` + `integrations/shared_dir.py` | — (바이너리 JPEG) |
| POST | `/vlm/infer` | `routers/vlm.py` | `vlm_service.py` | `schemas/vlm.py` |

대부분 `?process_code=PRC-19` 쿼리 지원. 공정 코드: **PRC-19(정밀가공), PRC-07(용접),
PRC-12(도장), PRC-23(조립), PRC-31(물류·하역)**. 위험성평가는 현재 PRC-19, PRC-07 만 픽스처 존재.

---

## 5. "이런 수정 요청이 오면 여기를 고쳐라" 빠른 참조 ⭐

| 사용자 요청 예시 | 수정 위치 |
|---|---|
| "온도/습도/심박/공정 등 **목업 데이터 값** 바꿔줘" | `mock_data/*.json` (코드 수정 불필요) |
| "응답에 **필드 추가/이름 변경**" | 해당 `schemas/*.py` (+ service 매핑, + mock_data) |
| "**새 엔드포인트** 추가" | `routers/` 새 파일 → `main.py` 등록 → `services/` + `schemas/` + `api/deps.py` |
| "**실제 DB**(MySQL) 쿼리/매핑 변경" | `repositories/sql_repository.py` (확정 ERD 5테이블). 연결설정은 `core/config.py` 의 `KIOSK_DB_*` |
| "**MSDS/위험성평가/워치 명단** 값 변경(ERD 외)" | `repositories/dummy_data.py` (소스 더미. DB 미사용) |
| "**불안전행동 카테고리/키워드/등급** 변경" | `domain/constants.py` (BEHAVIOR_CATEGORIES) + `mock_data/behavior_seed.json` |
| "**경광등 임계값** 변경" | `core/config.py` 의 `light_caution_threshold`/`light_danger_threshold` (또는 `.env`) |
| "**VLM 응답 키/형태** 변경" | `integrations/vlm_client.py` (KEY_DETECTION/KEY_WARNING, _MOCK_SCENES) |
| "**VLM 파이프라인 로직**(파싱/카운팅/경광등 산정) 변경" | `services/vlm_service.py` |
| "**TTS 음성/동작** 변경" | `integrations/tts.py` + `core/config.py` (tts_voice 등) |
| "**스피커/경광등 실제 장치** 연동" | `integrations/actuators.py` (현재 로그 stub) |
| "**Shared Dir 프레임 규칙/스트림** 변경" | `integrations/shared_dir.py` + `routers/cctv.py` |
| "**CORS/포트/경로 등 설정**" | `core/config.py` + `.env.example` |
| "**프론트(kiosk.html) 연동 동작** 변경" | `kiosk.html` 맨 아래 `<script>` IIFE |

---

## 6. /vlm/infer 파이프라인 (핵심 흐름)

`services/vlm_service.py::VlmService.infer()` 가 다음을 순서대로 수행:
1. **VLM 호출** (`vlm_client.infer`) → `{탐지, 위험 경고 텍스트}`. 서버 오프라인이면 내장 mock.
2. **Branch A (TTS)**: 위험 경고 텍스트 → `tts.synthesize` → `speaker.play` (stub).
3. **Branch B (DB+경광등)**: 탐지 텍스트를 `split_detection` → `match_categories`(키워드 매칭)로
   4대 카테고리 분류 → `repo.increment_behavior(+1)` → 결과 카운트 조회 →
   `_warning_light_state(count)` 로 경광등 상태 산정 → `warning_light.dispatch` (stub).
4. 응답 결합 후 반환.

**경광등 임계값** (config): count 0=소등, 1~2=녹색, **3~4=노란색 볼 깜빡임**, 5+=빨간색 볼 깜빡임.
(다이어그램 예시 "count==3 → 노란색"과 일치)

**4대 불안전행동** (`domain/constants.py`):
- `helmet_off` 모자(안전모) 벗는 행동 — 위험 — 키워드: 안전모/헬멧/모자/helmet
- `touch_equipment` 스피커(설비) 만지는 행동 — 주의 — 설비/스피커/기계/장비/만지
- `unauthorized_crossing` 위험지역 무단횡단 행동 — 정상 — 무단횡단/위험지역/통제구역/출입
- `ladder_alone` 사다리 혼자 올라가는 행동 — 정상 — 사다리/단독/혼자/ladder

---

## 7. 프론트(kiosk.html) 연동 구조

- 파일 **맨 아래 `<script> (function(){...})()` IIFE** 가 연동 전담. 기존 코드/스타일은 안 건드림.
- `API` 베이스: `file://` 면 `http://localhost:8080`, 아니면 동일 호스트:8080. `?api=` 쿼리로 override.
- 로드 시: `/space-name`, `/sensor/temp-humid`, `/sensor/watch` 호출해 신호등 카드·환경 카드·캐시 채움.
- 공정 드롭다운(`#bhProcSelect`) 변경 → 해당 공정으로 재호출.
- `openMSDSList/openMSDS/openRisk/openHeartRate/openWatchWorker/openEnvDetail/openAISite` 를
  **window 함수 오버라이드**로 백엔드 버전으로 교체 (실패 시 원본 fallback).
- **AI 현장 상황 모달**에 "분석 실행 ▶" 버튼 주입 → `POST /vlm/infer` 실행 후 결과 표시 + 카운트 갱신.
- 상단 중앙 **연결 배지**: 🟢 백엔드 연결됨 / 🔴 오프라인.
- CCTV 모달: `/cctv/frame` 폴링. 실제 프레임(`X-Frame-Source: shared_dir`)이면 표시, placeholder면 데모영상 유지.

---

## 8. 알아둘 제약 / 함정

- **환경**: Windows 11 + PowerShell. 한글 콘솔이 cp949라 stdout 깨질 수 있음 → 스크립트는 UTF-8 강제.
- **TTS**: `KIOSK_TTS_ENABLED=true`면 edge-tts가 **인터넷 필요**. 망 없으면 `tts.status="failed"`(파이프라인은 정상 완료). 헤드리스/오프라인 검증 시 `KIOSK_TTS_ENABLED=false` 로.
- **VLM**: 기본은 실제 서버(localhost:8000) 시도 후 실패 시 mock. 강제 mock은 `KIOSK_VLM_FORCE_MOCK=true`.
- **CCTV 프레임**: 하드웨어 서버가 프레임을 안 쓰면 1×1 placeholder JPEG 반환(키오스크 안 깨지게).
- **behavior 카운터는 in-memory** — 서버 재시작하면 `behavior_seed.json` 시드값으로 리셋됨.
- **구현 범위 한계(엄수)**: Hardware Server(8081)·VLM Server(8000)·실제 DB 스키마는 **구현 안 함**. VLM은 클라이언트만.

---

## 9. 미완료 TODO (실제 연동 대기)

- [x] 실제 Shared DB(MySQL) 스키마 확정 → `SqlRepository` 구현 + `factory.py` mysql 분기/폴백 (2026-06-22 완료)
- [ ] VLM 서버 실제 `/infer` 응답 스키마 확정 → `vlm_client.py` 상수 조정
- [ ] 스피커/경광등 실제 장치 연동 → `actuators.py`
- [ ] Shared Dir 프레임 명명/atomic rename 규칙 최종 합의
- [ ] (필요 시) 인증/권한, 운영 로깅·모니터링
