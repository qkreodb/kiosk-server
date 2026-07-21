-- ──────────────────────────────────────────────────────────────────────────
-- Kiosk Shared DB — reference DDL (confirmed ERD, 5 tables).
--
-- The real DB is already built on the Jetson; this file is for LOCAL testing /
-- reference only. It includes the runtime cctv_info.frame_dir extension used
-- to share each camera's latest VLM frame.
--
-- Usage (local MySQL):
--   mysql -u root -p < db/schema.sql
--   mysql -u root -p kiosk < db/seed.sql
-- ──────────────────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS kiosk
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kiosk;

-- Drop in FK-safe order (children of `process` first is fine; process holds FKs).
DROP TABLE IF EXISTS process;
DROP TABLE IF EXISTS temperature_humidity_sensor;
DROP TABLE IF EXISTS heartbeat_sensor;
DROP TABLE IF EXISTS cctv_info;
DROP TABLE IF EXISTS unstable_behavior;

-- 시계열(append) 테이블: 측정마다 새 행이 INSERT 된다(sensor_id AUTO_INCREMENT).
-- sensor_name(예: shelly_1, sonoff_1)으로 센서를 구분하며, 같은 sensor_name 행이
-- 시간 순으로 누적된다. "현재값"은 sensor_name 별 sensor_id 최대(=최신) 행.
CREATE TABLE temperature_humidity_sensor (
  sensor_id    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  temperature  DECIMAL(5,2) NOT NULL,
  humidity     DECIMAL(5,2) NOT NULL,
  measured_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  sensor_name  VARCHAR(100)                       -- 하드웨어 서버 송신 식별자 (예: shelly_1, sonoff_1)
);

CREATE TABLE heartbeat_sensor (
  sensor_id    INT       NOT NULL PRIMARY KEY,
  heart_rate   INT       NOT NULL,
  measured_at  DATETIME  NOT NULL
);

CREATE TABLE cctv_info (
  cctv_id   INT          NOT NULL PRIMARY KEY,
  rtsp_url  VARCHAR(255) NOT NULL,
  frame_dir VARCHAR(200) NULL
);

CREATE TABLE unstable_behavior (
  behavior_id           INT NOT NULL PRIMARY KEY,
  hat_removal_count     INT NOT NULL DEFAULT 0,  -- helmet_off     안전모 미착용
  ladder_alone_count    INT NOT NULL DEFAULT 0,  -- ladder_alone   사다리 단독 이용
  restricted_area_count INT NOT NULL DEFAULT 0,  -- fence_crossing 위험 펜스 넘음
  speaker_touch_count   INT NOT NULL DEFAULT 0,  -- cone_touch     라바콘 접촉
  safety_vest_count     INT NOT NULL DEFAULT 0   -- safety_vest    안전 고리 미착용
);

-- Central mapping table: each process points to one of each related row.
CREATE TABLE process (
  process_id      INT          NOT NULL PRIMARY KEY,
  process_name    VARCHAR(100) NOT NULL,
  behavior_id     INT          NOT NULL,
  th_sensor_name  VARCHAR(100) NULL,      -- temperature_humidity_sensor.sensor_name (안정적 식별자, PK 아님이라 FK 불가)
  hb_sensor_id    INT          NOT NULL,
  cctv_id         INT          NOT NULL,
  CONSTRAINT fk_process_behavior FOREIGN KEY (behavior_id)  REFERENCES unstable_behavior(behavior_id),
  CONSTRAINT fk_process_hb       FOREIGN KEY (hb_sensor_id) REFERENCES heartbeat_sensor(sensor_id),
  CONSTRAINT fk_process_cctv     FOREIGN KEY (cctv_id)      REFERENCES cctv_info(cctv_id)
);
