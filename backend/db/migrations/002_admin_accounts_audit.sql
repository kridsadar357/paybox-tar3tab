-- รอบ 2: บัญชีผู้ดูแลระบบรายคน + 2FA + บันทึกการใช้งาน (audit log)
--
-- เดิมแอดมินทั้งระบบใช้รหัสผ่านกลางตัวเดียวจาก ENV (ADMIN_PASSWORD) ไม่มีบัญชีรายคน ไม่มี 2FA
-- และไม่มีบันทึกว่าใครทำอะไร ทั้งที่แอ็กชันฝั่งแอดมินแตะเงินโดยตรง (ปิดรอบโอน แก้ค่าธรรมเนียม
-- รีเซ็ตรหัสผ่านลูกค้า)
--
-- เขียนแบบรันซ้ำได้ (idempotent) — MySQL 8.4 ไม่มี ADD COLUMN IF NOT EXISTS จึงต้องเช็ค
-- information_schema เองก่อนแล้วค่อยสร้าง statement ตามผล

-- ---------- 1) ตารางบัญชีผู้ดูแลระบบ ----------
CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NULL,
    password_hash VARCHAR(255) NOT NULL,
    totp_secret VARCHAR(64) NULL,
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    -- บัญชีเจ้าของระบบ (สร้างอัตโนมัติจาก ADMIN_PASSWORD ตอนบูตครั้งแรก)
    -- ห้ามถูกระงับหรือถูกถอดสิทธิ์ กันเหตุการณ์ล็อกทุกคนออกจากระบบจนเข้าไม่ได้อีกเลย
    is_owner TINYINT(1) NOT NULL DEFAULT 0,
    password_changed_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 2) ผูก session เข้ากับบัญชี + เก็บที่มาของการล็อกอิน ----------
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_sessions' AND COLUMN_NAME = 'admin_id') > 0,
    'SELECT ''admin_sessions.admin_id มีอยู่แล้ว'' AS note',
    'ALTER TABLE admin_sessions ADD COLUMN admin_id INT UNSIGNED NULL AFTER id, ADD INDEX idx_admin (admin_id)'
));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_sessions' AND COLUMN_NAME = 'ip') > 0,
    'SELECT ''admin_sessions.ip มีอยู่แล้ว'' AS note',
    'ALTER TABLE admin_sessions ADD COLUMN ip VARCHAR(45) NULL, ADD COLUMN user_agent VARCHAR(255) NULL'
));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------- 3) บันทึกการใช้งาน ----------
-- เก็บ admin_username ซ้ำไว้ด้วยโดยตั้งใจ (denormalise) เพื่อให้ประวัติยังอ่านออกแม้บัญชีถูกลบ
-- ภายหลัง — log ที่ชี้ไปยัง id ที่หายไปแล้วไม่มีประโยชน์ในการตรวจสอบย้อนหลัง
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NULL,
    admin_username VARCHAR(64) NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NULL,
    target_id VARCHAR(64) NULL,
    summary VARCHAR(255) NULL,
    detail JSON NULL,
    ip VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at),
    INDEX idx_admin (admin_id),
    INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 4) ตัด session แอดมินเดิมทิ้งทั้งหมด ----------
-- session ที่ออกก่อน migration นี้ไม่มี admin_id ผูกอยู่ requireAdmin ตัวใหม่ JOIN ไม่ติดจึงใช้ไม่ได้
-- อยู่แล้ว ลบทิ้งให้ชัดเจนดีกว่าปล่อยค้างเป็นแถวตายในตาราง (ผลคือแอดมินต้องล็อกอินใหม่หนึ่งครั้ง)
DELETE FROM admin_sessions;
