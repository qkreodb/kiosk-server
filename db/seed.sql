-- ──────────────────────────────────────────────────────────────────────────
-- Kiosk Shared DB — sample seed for LOCAL testing.
--
-- Process names match the in-source risk-assessment dummy keys
-- (app/repositories/dummy_data.py: "정밀가공 공정", "용접 공정"), so /modal/risk
-- returns data for process_id 1 and 2.
-- ──────────────────────────────────────────────────────────────────────────
USE kiosk;

-- temp/humid sensors (one snapshot row per sensor; PK = sensor_id).
-- sensor_name = 하드웨어 서버 송신 식별자. 부스A=shelly_1, 부스C=sonoff_1.
INSERT INTO temperature_humidity_sensor (sensor_id, sensor_name, temperature, humidity, measured_at) VALUES
  (1, 'shelly_1', 27.4, 58.0, NOW()),
  (2, 'sonoff_1', 29.2, 51.0, NOW()),
  (3, 'th_3',     24.8, 47.0, NOW()),
  (4, 'th_4',     26.1, 53.0, NOW()),
  (5, 'th_5',     23.5, 60.0, NOW());

-- heartbeat sensors (one watch per process).
INSERT INTO heartbeat_sensor (sensor_id, heart_rate, measured_at) VALUES
  (1, 88,  NOW()),
  (2, 102, NOW()),
  (3, 76,  NOW()),
  (4, 115, NOW()),
  (5, 133, NOW());

-- CCTV streams.
INSERT INTO cctv_info (cctv_id, rtsp_url) VALUES
  (1, 'rtsp://192.168.0.11:554/stream1'),
  (2, 'rtsp://192.168.0.12:554/stream1'),
  (3, 'rtsp://192.168.0.13:554/stream1'),
  (4, 'rtsp://192.168.0.14:554/stream1'),
  (5, 'rtsp://192.168.0.15:554/stream1');

-- unsafe-behavior counters.
-- columns: hat_removal=helmet_off, ladder_alone=ladder_alone, restricted_area=fence_crossing,
--          speaker_touch=cone_touch, safety_vest=safety_vest
INSERT INTO unstable_behavior (behavior_id, hat_removal_count, ladder_alone_count, restricted_area_count, speaker_touch_count, safety_vest_count) VALUES
  (1, 3, 0, 0, 1, 0),
  (2, 1, 2, 1, 0, 1),
  (3, 0, 0, 0, 2, 0),
  (4, 0, 1, 0, 1, 2),
  (5, 2, 0, 3, 0, 0);

-- processes (central mapping).
INSERT INTO process (process_id, process_name, behavior_id, th_sensor_id, hb_sensor_id, cctv_id) VALUES
  (1, '정밀가공 공정',   1, 1, 1, 1),
  (2, '용접 공정',       2, 2, 2, 2),
  (3, '도장 공정',       3, 3, 3, 3),
  (4, '조립 공정',       4, 4, 4, 4),
  (5, '물류·하역 공정',  5, 5, 5, 5);
