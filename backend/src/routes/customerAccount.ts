// หน้า "ตั้งค่า" ของ Customer Portal — โปรไฟล์ / ความปลอดภัย (รหัสผ่าน, 2FA) / บัญชีรับเงิน
// แยกไฟล์จาก customer.ts เพราะคนละโดเมนกัน (นั่นคือข้อมูลธุรกรรม/อุปกรณ์ อันนี้คือบัญชีผู้ใช้)
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { pool } from '../db';
import { requireCustomer, CustomerRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { checkTotp, generateSecret, generateURI, TOTP_ISSUER } from '../lib/totp';

export const customerAccountRouter = Router();

// เก็บ re-export ไว้เพื่อไม่ให้ import เดิมที่ชี้มาที่ไฟล์นี้พัง (routes/customer.ts ใช้อยู่)
export { checkTotp };

// ---------- โปรไฟล์ ----------
customerAccountRouter.get(
  '/profile',
  bucketLimiter('customer_account'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, created_at, is_active,
              fee_tier, fee_percent, flat_fee_amount,
              totp_enabled, password_changed_at,
              payout_bank, payout_account_no, payout_account_name
       FROM customers WHERE id = ? LIMIT 1`,
      [req.customer!.id]
    );
    const c = (rows as any[])[0];
    if (!c) return res.status(404).json({ success: false, error: 'not_found' });

    // นับอุปกรณ์ไว้โชว์ในหน้าโปรไฟล์ด้วย
    const [devRows] = await pool.query('SELECT COUNT(*) AS n FROM devices WHERE customer_id = ?', [req.customer!.id]);

    res.json({
      success: true,
      profile: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        created_at: c.created_at,
        is_active: c.is_active,
        device_count: (devRows as any[])[0]?.n ?? 0,
      },
      billing: {
        fee_tier: c.fee_tier,
        fee_percent: c.fee_percent,
        flat_fee_amount: c.flat_fee_amount,
      },
      security: {
        totp_enabled: Number(c.totp_enabled) === 1,
        password_changed_at: c.password_changed_at,
      },
      payout: {
        bank: c.payout_bank,
        account_no: c.payout_account_no,
        account_name: c.payout_account_name,
      },
    });
  }
);

customerAccountRouter.post(
  '/profile',
  bucketLimiter('customer_account'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ success: false, error: 'invalid_name', message: 'ชื่อต้องมีความยาว 2–100 ตัวอักษร' });
    }
    if (phone && !/^[0-9+\-\s()]{6,32}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'invalid_phone', message: 'รูปแบบเบอร์โทรไม่ถูกต้อง' });
    }

    await pool.query('UPDATE customers SET name = ?, phone = ? WHERE id = ?', [name, phone || null, req.customer!.id]);
    res.json({ success: true });
  }
);

// ---------- เปลี่ยนรหัสผ่าน ----------
customerAccountRouter.post(
  '/password',
  bucketLimiter('customer_password', 8, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');

    if (!current || !next) {
      return res.status(400).json({ success: false, error: 'missing_fields', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (next.length < 8) {
      return res.status(400).json({ success: false, error: 'weak_password', message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM customers WHERE id = ? LIMIT 1', [req.customer!.id]);
    const hash = (rows as any[])[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(current, hash))) {
      return res.status(401).json({ success: false, error: 'wrong_password', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }

    const newHash = await bcrypt.hash(next, 10);
    await pool.query('UPDATE customers SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [
      newHash,
      req.customer!.id,
    ]);

    // เปลี่ยนรหัสผ่านแล้วต้องเตะ session อื่นออกทั้งหมด เหลือแค่เครื่องที่กำลังใช้อยู่
    const currentToken = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || (req.query.token as string) || '';
    await pool.query('DELETE FROM customer_sessions WHERE customer_id = ? AND token <> ?', [
      req.customer!.id,
      currentToken,
    ]);

    res.json({ success: true });
  }
);

// ---------- 2FA (TOTP) ----------
// ขั้นที่ 1: ขอ secret + QR — ยังไม่เปิดใช้จนกว่าจะยืนยันรหัสถูกในขั้นที่ 2
customerAccountRouter.post(
  '/2fa/setup',
  bucketLimiter('customer_2fa', 10, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const [rows] = await pool.query('SELECT email, totp_enabled FROM customers WHERE id = ? LIMIT 1', [
      req.customer!.id,
    ]);
    const c = (rows as any[])[0];
    if (Number(c?.totp_enabled) === 1) {
      return res.status(400).json({ success: false, error: 'already_enabled', message: 'เปิดใช้งาน 2FA อยู่แล้ว' });
    }

    const secret = generateSecret();
    const otpauth = generateURI({ issuer: TOTP_ISSUER, label: c.email, secret });
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });

    // เก็บ secret ไว้ก่อนแต่ยังไม่เปิดใช้ — ถ้าผู้ใช้ยกเลิกกลางคัน secret นี้ก็แค่ค้างไว้เฉยๆ
    await pool.query('UPDATE customers SET totp_secret = ? WHERE id = ?', [secret, req.customer!.id]);

    res.json({ success: true, secret, otpauth, qr });
  }
);

// ขั้นที่ 2: ยืนยันรหัส 6 หลักจากแอปแล้วค่อยเปิดใช้จริง
customerAccountRouter.post(
  '/2fa/enable',
  bucketLimiter('customer_2fa', 10, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const code = String(req.body?.code || '').replace(/\s/g, '');
    const [rows] = await pool.query('SELECT totp_secret, totp_enabled FROM customers WHERE id = ? LIMIT 1', [
      req.customer!.id,
    ]);
    const c = (rows as any[])[0];

    if (!c?.totp_secret) {
      return res.status(400).json({ success: false, error: 'no_setup', message: 'ยังไม่ได้เริ่มตั้งค่า 2FA' });
    }
    if (Number(c.totp_enabled) === 1) {
      return res.status(400).json({ success: false, error: 'already_enabled', message: 'เปิดใช้งานอยู่แล้ว' });
    }
    if (!checkTotp(code, c.totp_secret)) {
      return res.status(400).json({ success: false, error: 'invalid_code', message: 'รหัสไม่ถูกต้องหรือหมดอายุ ลองใหม่อีกครั้ง' });
    }

    await pool.query('UPDATE customers SET totp_enabled = 1 WHERE id = ?', [req.customer!.id]);
    res.json({ success: true });
  }
);

// ปิด 2FA — ต้องยืนยันทั้งรหัสผ่านและรหัส 6 หลัก กันคนที่ยืมเครื่องที่ล็อกอินค้างไว้ปิดเอง
customerAccountRouter.post(
  '/2fa/disable',
  bucketLimiter('customer_2fa', 10, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const password = String(req.body?.password || '');
    const code = String(req.body?.code || '').replace(/\s/g, '');

    const [rows] = await pool.query(
      'SELECT password_hash, totp_secret, totp_enabled FROM customers WHERE id = ? LIMIT 1',
      [req.customer!.id]
    );
    const c = (rows as any[])[0];

    if (Number(c?.totp_enabled) !== 1) {
      return res.status(400).json({ success: false, error: 'not_enabled', message: 'ยังไม่ได้เปิดใช้งาน 2FA' });
    }
    if (!c.password_hash || !(await bcrypt.compare(password, c.password_hash))) {
      return res.status(401).json({ success: false, error: 'wrong_password', message: 'รหัสผ่านไม่ถูกต้อง' });
    }
    if (!checkTotp(code, c.totp_secret)) {
      return res.status(400).json({ success: false, error: 'invalid_code', message: 'รหัส 6 หลักไม่ถูกต้อง' });
    }

    await pool.query('UPDATE customers SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.customer!.id]);
    res.json({ success: true });
  }
);

// ---------- บัญชีรับเงิน ----------
customerAccountRouter.post(
  '/payout',
  bucketLimiter('customer_account'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const bank = String(req.body?.bank || '').trim();
    const accountNo = String(req.body?.account_no || '').replace(/[\s-]/g, '');
    const accountName = String(req.body?.account_name || '').trim();

    if (!bank || !accountNo || !accountName) {
      return res.status(400).json({ success: false, error: 'missing_fields', message: 'กรุณากรอกข้อมูลบัญชีให้ครบ' });
    }
    if (!/^[0-9]{8,20}$/.test(accountNo)) {
      return res
        .status(400)
        .json({ success: false, error: 'invalid_account', message: 'เลขบัญชีต้องเป็นตัวเลข 8–20 หลัก' });
    }

    await pool.query(
      'UPDATE customers SET payout_bank = ?, payout_account_no = ?, payout_account_name = ? WHERE id = ?',
      [bank, accountNo, accountName, req.customer!.id]
    );
    res.json({ success: true });
  }
);

// ---------- อุปกรณ์ที่ล็อกอินค้างอยู่ ----------
customerAccountRouter.get(
  '/sessions',
  bucketLimiter('customer_account'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const [rows] = await pool.query(
      'SELECT id, created_at, expires_at FROM customer_sessions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.customer!.id]
    );
    res.json({ success: true, sessions: rows });
  }
);

// ออกจากระบบทุกอุปกรณ์ยกเว้นเครื่องปัจจุบัน
customerAccountRouter.post(
  '/sessions/revoke_others',
  bucketLimiter('customer_account'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const currentToken = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || (req.query.token as string) || '';
    const [result]: any = await pool.query('DELETE FROM customer_sessions WHERE customer_id = ? AND token <> ?', [
      req.customer!.id,
      currentToken,
    ]);
    res.json({ success: true, revoked: result?.affectedRows ?? 0 });
  }
);
