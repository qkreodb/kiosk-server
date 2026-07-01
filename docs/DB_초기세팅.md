# DB 초기 세팅 (dasol) — 분석 500 오류 해결용

## 왜 필요한가
키오스크에서 **분석**을 누르면 `increment_behavior` 가 다음을 실행한다.
```sql
UPDATE unstable_behavior SET hat_removal_count = hat_removal_count + 1
WHERE behavior_id = (SELECT behavior_id FROM process WHERE process_id = <선택공정>);
```
선택한 공정의 `process` 행이 없거나 그 행의 **`behavior_id` 가 NULL** 이면(실 스키마상
nullable) 서브쿼리가 NULL → 0행 →
`ValueError: No unstable_behavior row for process_id=… (500)` 가 난다.

따라서 **process 행 + 연결된 unstable_behavior 행**이 함께 있어야 한다.
아래를 `dasol` 에 한 번 적용하면 정밀가공/용접/도장 3개 공정이 카운트 0 으로 세팅된다.

> 실 스키마 기준(2024 현재 `dasol`): 모든 PK 가 `AUTO_INCREMENT`, `process` 의
> FK 컬럼은 NULL 허용, `measured_at` 은 `DEFAULT CURRENT_TIMESTAMP`.
> 그래서 id 를 하드코딩하지 않고 auto_increment + `LAST_INSERT_ID()` 로 연결한다.

실행:
```bash
mysql -u root -p dasol < (아래 [2] 를 파일로 저장)
# 또는 Workbench/DBeaver 에서 dasol 선택 후 [2] 붙여넣기 실행
```

---

## [1] 스키마 (테이블이 이미 있으면 건너뛰기 — IF NOT EXISTS)

> `dasol` 에는 이미 5개 테이블이 있으므로 보통 이 단계는 불필요하다.
> 새 환경에서 처음 구축할 때만 사용. 실제 `desc` 결과와 동일하게 맞춤.

```sql
CREATE DATABASE IF NOT EXISTS dasol
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dasol;

CREATE TABLE IF NOT EXISTS temperature_humidity_sensor (
  sensor_id   INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  temperature DECIMAL(5,2) NOT NULL,
  humidity    DECIMAL(5,2) NOT NULL,
  measured_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS heartbeat_sensor (
  sensor_id   INT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  heart_rate  INT      NOT NULL,
  measured_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cctv_info (
  cctv_id  INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rtsp_url VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS unstable_behavior (
  behavior_id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hat_removal_count     INT DEFAULT 0,
  ladder_alone_count    INT DEFAULT 0,
  restricted_area_count INT DEFAULT 0,
  speaker_touch_count   INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS process (
  process_id   INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_name VARCHAR(100) NOT NULL,
  behavior_id  INT NULL,
  th_sensor_id INT NULL,
  hb_sensor_id INT NULL,
  cctv_id      INT NULL,
  KEY (behavior_id), KEY (th_sensor_id), KEY (hb_sensor_id), KEY (cctv_id),
  CONSTRAINT fk_process_behavior FOREIGN KEY (behavior_id)  REFERENCES unstable_behavior(behavior_id),
  CONSTRAINT fk_process_th       FOREIGN KEY (th_sensor_id) REFERENCES temperature_humidity_sensor(sensor_id),
  CONSTRAINT fk_process_hb       FOREIGN KEY (hb_sensor_id) REFERENCES heartbeat_sensor(sensor_id),
  CONSTRAINT fk_process_cctv     FOREIGN KEY (cctv_id)      REFERENCES cctv_info(cctv_id)
);
```

---

## [2] 초기 데이터 (auto_increment + LAST_INSERT_ID 로 연결, 카운트 0)

> ⚠ 이 블록은 **새 행을 추가**한다(append). 한 번만 실행할 것. 다시 깨끗이
> 넣으려면 먼저 아래 [4] 정리 쿼리로 비운 뒤 실행.

```sql
USE dasol;

-- 정밀가공 공정
INSERT INTO unstable_behavior () VALUES ();                              SET @b := LAST_INSERT_ID();
INSERT INTO temperature_humidity_sensor (temperature, humidity) VALUES (26.0, 52.0); SET @t := LAST_INSERT_ID();
INSERT INTO heartbeat_sensor (heart_rate) VALUES (78);                   SET @h := LAST_INSERT_ID();
INSERT INTO cctv_info (rtsp_url) VALUES ('rtsp://admin:ekthf123@172.16.0.243:554/stream1'); SET @c := LAST_INSERT_ID();
INSERT INTO process (process_name, behavior_id, th_sensor_id, hb_sensor_id, cctv_id)
VALUES ('정밀가공 공정', @b, @t, @h, @c);

-- 용접 공정
INSERT INTO unstable_behavior () VALUES ();                              SET @b := LAST_INSERT_ID();
INSERT INTO temperature_humidity_sensor (temperature, humidity) VALUES (27.0, 50.0); SET @t := LAST_INSERT_ID();
INSERT INTO heartbeat_sensor (heart_rate) VALUES (82);                   SET @h := LAST_INSERT_ID();
INSERT INTO cctv_info (rtsp_url) VALUES ('rtsp://admin:ekthf123@172.16.0.243:554/stream1'); SET @c := LAST_INSERT_ID();
INSERT INTO process (process_name, behavior_id, th_sensor_id, hb_sensor_id, cctv_id)
VALUES ('용접 공정', @b, @t, @h, @c);

-- 도장 공정
INSERT INTO unstable_behavior () VALUES ();                              SET @b := LAST_INSERT_ID();
INSERT INTO temperature_humidity_sensor (temperature, humidity) VALUES (25.0, 55.0); SET @t := LAST_INSERT_ID();
INSERT INTO heartbeat_sensor (heart_rate) VALUES (75);                   SET @h := LAST_INSERT_ID();
INSERT INTO cctv_info (rtsp_url) VALUES ('rtsp://admin:ekthf123@172.16.0.243:554/stream1'); SET @c := LAST_INSERT_ID();
INSERT INTO process (process_name, behavior_id, th_sensor_id, hb_sensor_id, cctv_id)
VALUES ('도장 공정', @b, @t, @h, @c);
```

---

## [3] 확인

```sql
USE dasol;
SELECT p.process_id, p.process_name, p.behavior_id,
       u.hat_removal_count, u.ladder_alone_count,
       u.restricted_area_count, u.speaker_touch_count
FROM process p
JOIN unstable_behavior u ON u.behavior_id = p.behavior_id
ORDER BY p.process_id;
```
3개 공정이 카운트 0 으로 나오면 정상. (process_id 는 auto_increment 가 부여한 값)

---

## [4] (선택) 기존 데이터 정리 후 재적재

이미 NULL FK 인 잘못된 행이 섞여 있거나 처음부터 깨끗이 다시 넣고 싶을 때만:

```sql
USE dasol;
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE process;
TRUNCATE TABLE unstable_behavior;
TRUNCATE TABLE temperature_humidity_sensor;
TRUNCATE TABLE heartbeat_sensor;
TRUNCATE TABLE cctv_info;
SET FOREIGN_KEY_CHECKS = 1;
-- 그 다음 [2] 실행
```

---

## 적용 후
1. 키오스크 새로고침 → 공정 드롭다운에 정밀가공/용접/도장이 뜸
   (프론트가 `/space-name` 의 실제 공정 목록 + 실제 process_id 를 동적으로 사용).
2. 공정 선택 → 감시 대상 체크 → **분석** → 감지 행동 카운트 +1 누적,
   임계값(1/2/3/4)에 따라 경광등 단계 상승. 더 이상 500 안 남.

> 로컬 테스트용 전체 스키마/시드는 `db/schema.sql`·`db/seed.sql`(DB명 `kiosk`) 참고.
> 이 문서는 실 서버 DB(`dasol`)의 분석 동작을 위한 **최소 초기 세팅**만 다룬다.
