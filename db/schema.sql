-- ──────────────────────────────────────────────────────────────────────────
-- Kiosk Shared DB — reference DDL (confirmed ERD, 5 tables).
--
-- The real DB is already built on the Jetson; this file is for LOCAL testing /
-- reference only. It mirrors the confirmed schema exactly (no extra columns).
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

CREATE TABLE temperature_humidity_sensor (
  sensor_id    INT          NOT NULL PRIMARY KEY,
  sensor_name  VARCHAR(50),                       -- 하드웨어 서버 송신 식별자 (예: shelly_1, sonoff_1)
  temperature  DECIMAL(5,2) NOT NULL,
  humidity     DECIMAL(5,2) NOT NULL,
  measured_at  DATETIME     NOT NULL
);

CREATE TABLE heartbeat_sensor (
  sensor_id    INT       NOT NULL PRIMARY KEY,
  heart_rate   INT       NOT NULL,
  measured_at  DATETIME  NOT NULL
);

CREATE TABLE cctv_info (
  cctv_id   INT          NOT NULL PRIMARY KEY,
  rtsp_url  VARCHAR(255) NOT NULL
);

CREATE TABLE unstable_behavior (
  behavior_id           INT NOT NULL PRIMARY KEY,
  hat_removal_count     INT NOT NULL DEFAULT 0,
  ladder_alone_count    INT NOT NULL DEFAULT 0,
  restricted_area_count INT NOT NULL DEFAULT 0,
  speaker_touch_count   INT NOT NULL DEFAULT 0
);

-- Central mapping table: each process points to one of each related row.
CREATE TABLE process (
  process_id    INT          NOT NULL PRIMARY KEY,
  process_name  VARCHAR(100) NOT NULL,
  behavior_id   INT          NOT NULL,
  th_sensor_id  INT          NOT NULL,
  hb_sensor_id  INT          NOT NULL,
  cctv_id       INT          NOT NULL,
  CONSTRAINT fk_process_behavior FOREIGN KEY (behavior_id)  REFERENCES unstable_behavior(behavior_id),
  CONSTRAINT fk_process_th       FOREIGN KEY (th_sensor_id) REFERENCES temperature_humidity_sensor(sensor_id),
  CONSTRAINT fk_process_hb       FOREIGN KEY (hb_sensor_id) REFERENCES heartbeat_sensor(sensor_id),
  CONSTRAINT fk_process_cctv     FOREIGN KEY (cctv_id)      REFERENCES cctv_info(cctv_id)
);
