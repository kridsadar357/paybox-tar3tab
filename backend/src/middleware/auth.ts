// ตรวจสิทธิ์ 3 แบบ — ทดแทน paybox_require_device()/paybox_require_admin()/paybox_require_customer()
// ใน config.php เดิม
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../db';

export interface DeviceRequest extends Request {
  device?: { id: number; name: string; is_active: number; payment_provider?: string | null };
}
export interface CustomerRequest extends Request {
  customer?: { id: number; name: string; email: string; is_active: number };
}
export interface AdminRequest extends Request {
  admin?: { id: number; username: string; name: string; is_owner: number };
}

export async function requireDevice(req: DeviceRequest, res: Response, next: NextFunction) {
  const key = (req.query.key as string) || '';
  if (!key) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  const [rows] = await pool.query('SELECT id, name, is_active, payment_provider FROM devices WHERE device_key = ? LIMIT 1', [key]);
  const device = (rows as any[])[0];
  if (!device || Number(device.is_active) !== 1) {
    console.error(`Rejected request: unknown/inactive device key from ${req.ip}`);
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  await pool.query('UPDATE devices SET last_seen_at = NOW() WHERE id = ?', [device.id]);
  req.device = device;
  next();
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ใช้กับทุก endpoint ของแอดมิน — ตอบ JSON 401 เสมอ (ต่างจาก admin.php เดิมที่โชว์ฟอร์ม HTML เพราะตอนนี้
// ฝั่ง frontend (paybox-control) เป็นคนจัดการหน้า login เองทั้งหมดแล้ว)
//
// ตรวจ session token (ออกโดย POST /api/admin/login หลังเช็ค admin_password ครั้งเดียว) แทนที่จะรับ
// admin_password ตรงๆ ทุก request — กัน password หลุดไปอยู่ใน query string (access log ของ Traefik,
// browser history, referrer header) ตามที่เจอจริงตอนเทสหลัง deploy ผ่าน reverse proxy
// รับ token จาก Authorization: Bearer header เป็นหลัก, หรือ ?token= สำหรับกรณี iframe (admin_reports)
// ที่ตั้ง custom header ไม่ได้
export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (match) {
    token = match[1];
  } else if (req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  // ผูก session เข้ากับบัญชีแอดมินรายคน — บันทึก audit ต้องรู้ว่า "ใคร" ทำ ไม่ใช่แค่ "แอดมิน"
  // session เก่าที่ออกก่อน migration ไม่มี admin_id จึง JOIN ไม่ติดและถูกปฏิเสธ (ตั้งใจ — migration
  // ลบทิ้งไปแล้ว ผลคือต้องล็อกอินใหม่หนึ่งครั้ง)
  const [rows] = await pool.query(
    `SELECT a.id, a.username, a.name, a.is_owner, a.is_active
     FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.token = ? AND s.expires_at > NOW() LIMIT 1`,
    [token]
  );
  const admin = (rows as any[])[0];
  if (!admin || Number(admin.is_active) !== 1) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  req.admin = { id: admin.id, username: admin.username, name: admin.name, is_owner: Number(admin.is_owner) };
  next();
}

export async function requireCustomer(req: CustomerRequest, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (match) {
    token = match[1];
  } else if (req.query.token) {
    token = req.query.token as string;
  } else if (req.body?.token) {
    token = req.body.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.email, c.is_active FROM customer_sessions s
     JOIN customers c ON c.id = s.customer_id
     WHERE s.token = ? AND s.expires_at > NOW() LIMIT 1`,
    [token]
  );
  const customer = (rows as any[])[0];
  if (!customer || Number(customer.is_active) !== 1) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  req.customer = customer;
  next();
}
