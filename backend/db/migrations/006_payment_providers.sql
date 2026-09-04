-- รองรับผู้ให้บริการรับชำระเงินหลายเจ้า
--
-- เดิมระบบผูกกับ Stripe เจ้าเดียวทั้งระบบ ตอนนี้เลือกได้ต่อเครื่อง เพราะแต่ละร้านอาจมีสัญญากับ
-- คนละเจ้า และค่าธรรมเนียมที่แต่ละเจ้าคิดก็ไม่เท่ากัน
--
-- ค่าเริ่มต้นเป็น stripe เพื่อให้เครื่องที่มีอยู่แล้วทำงานเหมือนเดิมทุกประการหลัง migrate

ALTER TABLE devices
    ADD COLUMN payment_provider VARCHAR(16) NOT NULL DEFAULT 'stripe' AFTER customer_id;

-- บันทึกไว้กับตัวรายการด้วยว่าใครเป็นคนรับเงินรอบนั้น ไม่ใช่ไปอ่านจากเครื่องตอนหลัง
-- เพราะถ้าเปลี่ยนผู้ให้บริการของเครื่องทีหลัง รายการเก่าจะถูกตีความผิดทันที
ALTER TABLE transactions
    ADD COLUMN provider VARCHAR(16) NOT NULL DEFAULT 'stripe' AFTER device_id;

-- ใช้ตอนถามสถานะย้อนหลังและตอนทำรายงานแยกตามผู้ให้บริการ
CREATE INDEX idx_transactions_provider ON transactions (provider);
