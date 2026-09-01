// บันทึกการกระทำของแอดมินที่แตะเงินหรือสิทธิ์การเข้าถึง
//
// เดิมไม่มีบันทึกอะไรเลย — ปิดรอบโอนเงิน แก้อัตราค่าธรรมเนียม หรือรีเซ็ตรหัสผ่านลูกค้า
// เกิดขึ้นแล้วก็หายไป ไม่มีทางตรวจย้อนหลังว่าใครทำเมื่อไหร่
import { Request } from 'express';
import { pool } from '../db';
import { AdminRequest } from '../middleware/auth';

export interface AuditOptions {
  targetType?: string;
  targetId?: string | number | null;
  summary?: string;
  detail?: Record<string, unknown>;
}

/** ดึง IP ต้นทางจริงหลัง Traefik — server.ts ตั้ง trust proxy = 1 ไว้แล้ว req.ip จึงเชื่อถือได้ */
function clientIp(req: Request): string | null {
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 45) || null;
}

/**
 * เขียนบันทึกหนึ่งรายการ
 *
 * ตั้งใจไม่ throw ออกมา — ถ้าตารางบันทึกมีปัญหา การทำงานหลัก (เช่น ปิดรอบโอนเงิน) ต้องไม่ล้มตาม
 * เพราะนั่นจะเปลี่ยนฟีเจอร์ตรวจสอบย้อนหลังให้กลายเป็นจุดที่ทำให้ระบบพัง
 */
export async function logAudit(req: Request, action: string, opts: AuditOptions = {}): Promise<void> {
  const admin = (req as AdminRequest).admin;
  try {
    await pool.query(
      `INSERT INTO audit_log (admin_id, admin_username, action, target_type, target_id, summary, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin?.id ?? null,
        admin?.username ?? null,
        action,
        opts.targetType ?? null,
        opts.targetId != null ? String(opts.targetId).slice(0, 64) : null,
        opts.summary ? opts.summary.slice(0, 255) : null,
        opts.detail ? JSON.stringify(opts.detail) : null,
        clientIp(req),
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] บันทึกไม่สำเร็จ:', err);
  }
}
