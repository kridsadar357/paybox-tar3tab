-- โหมดรับยอดชำระแบบ "จำนวนเงินคงที่"
--
-- เดิมมีสองโหมด: keypad (พิมพ์ยอดเอง) และ button (เลือกจากปุ่มที่ตั้งไว้)
-- เพิ่มโหมดที่สาม fixed = ยอดเดียวตายตัวต่อการสแกน 1 รอบ ไม่มีทางเลือกอื่น
-- เหมาะกับตู้ที่ขายของราคาเดียว เช่น ตู้น้ำ ตู้ซักผ้า ค่าเข้าห้องน้ำ
--
-- เก็บเป็น DECIMAL(12,2) ให้เข้าชุดกับคอลัมน์เงินอื่นในระบบ (transactions.amount ก็ DECIMAL(12,2))
-- แม้ตอนนี้บอร์ดจะใช้เฉพาะจำนวนเต็ม เผื่อรองรับสตางค์ในอนาคตโดยไม่ต้องย้ายชนิดข้อมูลอีก

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devices' AND COLUMN_NAME = 'fixed_amount') > 0,
    'SELECT ''devices.fixed_amount มีอยู่แล้ว'' AS note',
    'ALTER TABLE devices ADD COLUMN fixed_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER preset_amounts'
));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
