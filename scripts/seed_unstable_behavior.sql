-- =============================================================================
-- seed_unstable_behavior.sql
--
-- 목적: 모든 process 행이 유효한 unstable_behavior 행과 연결되도록 보장한다.
--       (분석 시 increment_behavior 의 UPDATE 가 0행이 되어 카운트가 누적되지
--        않던 문제 해결 — process.behavior_id FK 누락/끊김 + unstable_behavior 미시드)
--
-- 특징:
--   * 멱등(idempotent): 여러 번 실행해도 안전. 이미 유효하게 연결된 process 는 건드리지 않음.
--   * behavior_id 가 AUTO_INCREMENT 든 아니든 동작 (명시적으로 MAX+1 부여).
--   * 기존 카운트/연결은 보존. 새로 만든 행만 0으로 초기화.
--
-- 사용:
--   mysql -u root -p dasol < scripts/seed_unstable_behavior.sql
--   (DB명이 dasol 이 아니면 아래 USE 줄을 수정)
--
-- 전제 스키마 (sql_repository.py 기준):
--   process(process_id PK, process_name, behavior_id FK, ...)
--   unstable_behavior(behavior_id PK,
--       hat_removal_count, ladder_alone_count,
--       restricted_area_count, speaker_touch_count)
-- =============================================================================

USE dasol;

-- ── [1] 적용 전 진단: 연결이 끊긴 process 확인 ──────────────────────────────
SELECT '=== BEFORE: behavior_id 가 NULL 이거나 unstable_behavior 에 없는 process ===' AS info;
SELECT p.process_id, p.process_name, p.behavior_id
FROM process p
LEFT JOIN unstable_behavior u ON u.behavior_id = p.behavior_id
WHERE p.behavior_id IS NULL OR u.behavior_id IS NULL
ORDER BY p.process_id;

-- ── [2] 시드 프로시저: 누락된 process 마다 unstable_behavior 행 생성 + 연결 ──
DROP PROCEDURE IF EXISTS seed_unstable_behavior;
DELIMITER //
CREATE PROCEDURE seed_unstable_behavior()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE p_id INT;
    DECLARE b_id INT;
    DECLARE new_id INT;
    DECLARE cur CURSOR FOR SELECT process_id, behavior_id FROM process;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO p_id, b_id;
        IF done THEN
            LEAVE read_loop;
        END IF;

        -- behavior_id 가 NULL 이거나 해당 unstable_behavior 행이 없으면 새로 생성·연결
        IF b_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM unstable_behavior WHERE behavior_id = b_id) THEN

            SELECT COALESCE(MAX(behavior_id), 0) + 1 INTO new_id FROM unstable_behavior;

            INSERT INTO unstable_behavior
                (behavior_id, hat_removal_count, ladder_alone_count,
                 restricted_area_count, speaker_touch_count)
            VALUES (new_id, 0, 0, 0, 0);

            UPDATE process SET behavior_id = new_id WHERE process_id = p_id;
        END IF;
    END LOOP;
    CLOSE cur;
END //
DELIMITER ;

CALL seed_unstable_behavior();
DROP PROCEDURE seed_unstable_behavior;

-- ── [3] 적용 후 검증: 모든 process 가 유효 행과 연결됐는지 ────────────────────
SELECT '=== AFTER: process ↔ unstable_behavior 연결 상태 (전부 카운트가 보여야 정상) ===' AS info;
SELECT p.process_id, p.process_name, p.behavior_id,
       u.hat_removal_count, u.ladder_alone_count,
       u.restricted_area_count, u.speaker_touch_count
FROM process p
LEFT JOIN unstable_behavior u ON u.behavior_id = p.behavior_id
ORDER BY p.process_id;

SELECT '=== AFTER: 아직도 끊긴 process (0행이어야 정상) ===' AS info;
SELECT p.process_id, p.process_name, p.behavior_id
FROM process p
LEFT JOIN unstable_behavior u ON u.behavior_id = p.behavior_id
WHERE p.behavior_id IS NULL OR u.behavior_id IS NULL
ORDER BY p.process_id;
