# DB 더미 데이터 적재 가이드 (dasol)

분석/신호등 데모가 동작하려면 `process` 가 `unstable_behavior`·센서·CCTV 행과
FK 로 연결돼 있어야 합니다. 아래 SQL을 **그대로 복붙**하면 5개 테이블에 데모용
더미 데이터가 들어가고 서로 연결됩니다.

- **멱등**: 여러 번 실행해도 안전 (`ON DUPLICATE KEY UPDATE` 업서트).
- FK 의존성 순서대로 INSERT (자식 테이블 먼저 → `process` 마지막).
- 기존 운영 데이터가 있으면 `process_id` 1~3 등과 충돌하지 않는지만 확인하세요.

> 스키마 전제 (`app/repositories/sql_repository.py` 기준):
> ```
> process(process_id PK, process_name, behavior_id FK, th_sensor_id FK, hb_sensor_id FK, cctv_id FK)
> temperature_humidity_sensor(sensor_id PK, temperature, humidity, measured_at)
> heartbeat_sensor(sensor_id PK, heart_rate, measured_at)
> cctv_info(cctv_id PK, rtsp_url)
> unstable_behavior(behavior_id PK, hat_removal_count, ladder_alone_count, restricted_area_count, speaker_touch_count)
> ```
> 실제 컬럼명/타입이 다르면 해당 부분만 수정하세요.

---

## 실행 방법

```bash
# CLI
mysql -u root -p dasol < (아래 SQL을 파일로 저장해서) 
# 또는 MySQL Workbench / DBeaver 에 아래 블록을 붙여넣고 실행
```

---

## 1) 더미 데이터 적재 (복붙)

```sql
USE dasol;

-- ── 불안전행동 카운터 (데모 값: 공정별로 다른 단계가 점등되도록) ──────────────
INSERT INTO unstable_behavior
    (behavior_id, hat_removal_count, ladder_alone_count, restricted_area_count, speaker_touch_count)
VALUES
    (1, 3, 0, 0, 1),   -- 정밀가공: 최대 3 → 경고(빨강)
    (2, 1, 2, 1, 0),   -- 용접:     최대 2 → 주의(노랑)
    (3, 0, 0, 0, 2)    -- 도장:     최대 2 → 주의(노랑)
ON DUPLICATE KEY UPDATE
    hat_removal_count   = VALUES(hat_removal_count),
    ladder_alone_count  = VALUES(ladder_alone_count),
    restricted_area_count = VALUES(restricted_area_count),
    speaker_touch_count = VALUES(speaker_touch_count);

-- ── 온습도 센서 ──────────────────────────────────────────────────────────────
INSERT INTO temperature_humidity_sensor
    (sensor_id, temperature, humidity, measured_at)
VALUES
    (1, 26.4, 52.0, NOW()),
    (2, 28.1, 49.5, NOW()),
    (3, 24.8, 55.2, NOW())
ON DUPLICATE KEY UPDATE
    temperature = VALUES(temperature),
    humidity    = VALUES(humidity),
    measured_at = VALUES(measured_at);

-- ── 심박 센서(갤럭시워치) ────────────────────────────────────────────────────
INSERT INTO heartbeat_sensor
    (sensor_id, heart_rate, measured_at)
VALUES
    (1, 78, NOW()),
    (2, 85, NOW()),
    (3, 72, NOW())
ON DUPLICATE KEY UPDATE
    heart_rate  = VALUES(heart_rate),
    measured_at = VALUES(measured_at);

-- ── CCTV ─────────────────────────────────────────────────────────────────────
INSERT INTO cctv_info
    (cctv_id, rtsp_url)
VALUES
    (1, 'rtsp://admin:ekthf123@172.16.0.243:554/stream1'),
    (2, 'rtsp://admin:ekthf123@172.16.0.243:554/stream1'),
    (3, 'rtsp://admin:ekthf123@172.16.0.243:554/stream1')
ON DUPLICATE KEY UPDATE
    rtsp_url = VALUES(rtsp_url);

-- ── 공정 (위 행들을 FK 로 연결) ──────────────────────────────────────────────
INSERT INTO process
    (process_id, process_name, behavior_id, th_sensor_id, hb_sensor_id, cctv_id)
VALUES
    (1, '정밀가공 공정', 1, 1, 1, 1),
    (2, '용접 공정',     2, 2, 2, 2),
    (3, '도장 공정',     3, 3, 3, 3)
ON DUPLICATE KEY UPDATE
    process_name = VALUES(process_name),
    behavior_id  = VALUES(behavior_id),
    th_sensor_id = VALUES(th_sensor_id),
    hb_sensor_id = VALUES(hb_sensor_id),
    cctv_id      = VALUES(cctv_id);
```

---

## 2) 적재 확인 (복붙)

```sql
USE dasol;

SELECT p.process_id, p.process_name, p.behavior_id,
       u.hat_removal_count   AS 안전모,
       u.speaker_touch_count AS 설비접촉,
       u.restricted_area_count AS 무단횡단,
       u.ladder_alone_count  AS 사다리,
       t.temperature, t.humidity, h.heart_rate, c.rtsp_url
FROM process p
LEFT JOIN unstable_behavior u ON u.behavior_id  = p.behavior_id
LEFT JOIN temperature_humidity_sensor t ON t.sensor_id = p.th_sensor_id
LEFT JOIN heartbeat_sensor h ON h.sensor_id = p.hb_sensor_id
LEFT JOIN cctv_info c ON c.cctv_id = p.cctv_id
ORDER BY p.process_id;
```

모든 행에 카운트/센서/CCTV 값이 채워져 있으면 정상입니다.

---

## 3) 확인 후 동작

1. 키오스크 새로고침 → 공정 드롭다운에 **정밀가공/용접/도장**(process_id 1~3)이 뜸.
2. 공정 선택 → 불안전행동 신호등이 위 카운트대로 점등.
3. 감시 대상 체크 → CCTV **분석** 클릭 → 감지된 행동의 카운트가 +1 누적되고
   임계값(1/2/3/4)에 따라 경광등 단계 상승.

> 카운트를 초기화하려면 신호등 카드의 **초기화** 버튼(또는
> `UPDATE unstable_behavior SET hat_removal_count=0, ladder_alone_count=0,
> restricted_area_count=0, speaker_touch_count=0;`).
