// สร้างบัญชีผู้ดูแลระบบเริ่มต้นให้อัตโนมัติ ถ้ายังไม่มีบัญชีไหนเลยในตาราง admins
//
// ตัวระบบเดิมใช้รหัสผ่านกลางจาก ENV (ADMIN_PASSWORD) ตัวเดียว การย้ายมาเป็นบัญชีรายคนจึงต้องมี
// สะพานที่ไม่ทำให้เข้าระบบไม่ได้ระหว่างเปลี่ยน — รอบบูตแรกหลัง migration จะหยิบค่าเดิมจาก ENV
// มาสร้างเป็นบัญชี username 'admin' ให้ รหัสผ่านที่เคยใช้อยู่จึงยังใช้เข้าได้ทันที
//
// ทำงานเฉพาะตอนตารางว่างเปล่าเท่านั้น — ถ้ามีบัญชีอยู่แล้วจะไม่แตะอะไรเลย การเปลี่ยนรหัสผ่านผ่าน
// หน้าตั้งค่าจึงไม่ถูก ENV เขียนทับตอนรีสตาร์ตครั้งถัดไป
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { config } from '../config';

export const BOOTSTRAP_USERNAME = 'admin';

export async function ensureAdminAccount(): Promise<void> {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM admins');
    const count = Number((rows as any[])[0]?.n ?? 0);
    if (count > 0) return;

    if (!config.adminPassword) {
      // eslint-disable-next-line no-console
      console.error('[bootstrap] ไม่มีบัญชีแอดมิน และ ADMIN_PASSWORD ว่าง — จะเข้าระบบแอดมินไม่ได้');
      return;
    }

    const hash = await bcrypt.hash(config.adminPassword, 10);
    await pool.query(
      `INSERT INTO admins (username, name, password_hash, is_owner, is_active, password_changed_at)
       VALUES (?, ?, ?, 1, 1, NOW())`,
      [BOOTSTRAP_USERNAME, 'ผู้ดูแลระบบ', hash]
    );
    // eslint-disable-next-line no-console
    console.log(`[bootstrap] สร้างบัญชีแอดมินเริ่มต้น username=${BOOTSTRAP_USERNAME} จาก ADMIN_PASSWORD`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] สร้างบัญชีแอดมินเริ่มต้นไม่สำเร็จ:', err);
  }
}
