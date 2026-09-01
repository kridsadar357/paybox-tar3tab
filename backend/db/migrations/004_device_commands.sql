-- คิวคำสั่งที่ส่งถึงอุปกรณ์
--
-- backend ส่งคำสั่งหาบอร์ดตรงๆ ไม่ได้ (บอร์ดอยู่หลัง NAT เป็นฝ่ายเรียกเข้ามาอย่างเดียว) จึงต้อง
-- พักคำสั่งไว้ในคิว แล้วให้บอร์ดมารับตอนยิง heartbeat รอบถัดไป (ทุก 5 นาที)
--
-- เหตุผลที่ต้องมีสถานะ waiting_quiet แยกจาก pending: การสั่งอัปเดตจบด้วยการรีบูต ถ้าไปตัดตอน
-- ลูกค้ากำลังจ่ายเงิน รายการนั้นจะค้างกลางทาง — เงินอาจถูกตัดไปแล้วแต่เครื่องรีสตาร์ตก่อนยืนยัน
-- คำสั่งจึงถูกกักไว้จนกว่าเครื่องจะ "นิ่ง" (ไม่มีความเคลื่อนไหวของรายการเลย 5 นาที) ก่อนปล่อย

CREATE TABLE IF NOT EXISTS device_commands (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_id INT UNSIGNED NOT NULL,
    command VARCHAR(32) NOT NULL DEFAULT 'force_update',
    -- pending       = รับคำสั่งแล้ว รอเครื่องนิ่ง
    -- dispatched    = ส่งให้บอร์ดแล้ว รอบอร์ดอัปเดตและรายงานเวอร์ชันใหม่กลับมา
    -- done          = บอร์ดรายงานเวอร์ชันใหม่กลับมาแล้ว
    -- cancelled     = แอดมินยกเลิกเอง
    -- expired       = ค้างนานเกินไป (เช่น เครื่องหายไปเลย) เลิกรอ
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    requested_by_admin_id INT UNSIGNED NULL,
    requested_by_username VARCHAR(64) NULL,
    -- เวอร์ชันที่บอร์ดรันอยู่ตอนสั่ง เอาไว้เทียบว่าอัปเดตสำเร็จจริงไหม
    from_version VARCHAR(20) NULL,
    -- เหตุผลล่าสุดที่ยังปล่อยไม่ได้ เอาไว้โชว์ให้แอดมินเห็นว่าติดอะไรอยู่
    hold_reason VARCHAR(190) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched_at DATETIME NULL,
    completed_at DATETIME NULL,
    INDEX idx_device_status (device_id, status),
    INDEX idx_status (status),
    CONSTRAINT fk_device_commands_device FOREIGN KEY (device_id) REFERENCES devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
