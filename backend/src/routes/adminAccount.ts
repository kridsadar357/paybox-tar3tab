// หน้า "ตั้งค่า" ของฝั่งผู้ดูแลระบบ — โปรไฟล์ / รหัสผ่าน / 2FA / เซสชัน / จัดการบัญชีแอดมิน /
// บันทึกการใช้งาน
//
// โครงเหมือน customerAccount.ts โดยตั้งใจ (คนละตารางแต่โจทย์เดียวกัน) ต่างกันตรงที่ฝั่งนี้มีเรื่อง
// "แอดมินคนอื่น" เพิ่มเข้ามา และมีข้อจำกัดเรื่องบัญชีเจ้าของระบบเพื่อกันการล็อกทุกคนออกจากระบบ
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { pool } from '../db';
import { requireAdmin, AdminRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { checkTotp, generateSecret, generateURI, TOTP_ISSUER } from '../lib/totp';
import { logAudit } from '../lib/audit';

export const adminAccountRouter = Router();

function currentToken(req: AdminRequest): string {
  return /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || (req.query.token as string) || '';
}

// ---------- โปรไฟล์ ----------
adminAccountRouter.get('/profile', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, name, email, is_owner, is_active, totp_enabled, password_changed_at,
            last_login_at, created_at
     FROM admins WHERE id = ? LIMIT 1`,
    [req.admin!.id]
  );
  const a = (rows as any[])[0];
  if (!a) return res.status(404).json({ success: false, error: 'not_found' });

  res.json({
    success: true,
    profile: {
      id: a.id,
      username: a.username,
      name: a.name,
      email: a.email,
      is_owner: Number(a.is_owner),
      is_active: Number(a.is_active),
      last_login_at: a.last_login_at,
      created_at: a.created_at,
    },
    security: {
      totp_enabled: Number(a.totp_enabled) === 1,
      password_changed_at: a.password_changed_at,
    },
  });
});

adminAccountRouter.post('/profile', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ success: false, error: 'invalid_name', message: 'ชื่อต้องมีความยาว 2–100 ตัวอักษร' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'invalid_email', message: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }

  await pool.query('UPDATE admins SET name = ?, email = ? WHERE id = ?', [name, email || null, req.admin!.id]);
  res.json({ success: true });
});

// ---------- เปลี่ยนรหัสผ่านของตัวเอง ----------
adminAccountRouter.post(
  '/password',
  bucketLimiter('admin_password', 8, 60_000),
  requireAdmin,
  async (req: AdminRequest, res) => {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');

    if (!current || !next) {
      return res.status(400).json({ success: false, error: 'missing_fields', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (next.length < 10) {
      // ตั้งเกณฑ์สูงกว่าฝั่งลูกค้า (8) โดยตั้งใจ — บัญชีนี้เห็นและแก้ไขข้อมูลของลูกค้าทุกราย
      return res
        .status(400)
        .json({ success: false, error: 'weak_password', message: 'รหัสผ่านผู้ดูแลระบบต้องยาวอย่างน้อย 10 ตัวอักษร' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE id = ? LIMIT 1', [req.admin!.id]);
    const hash = (rows as any[])[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(current, hash))) {
      return res.status(401).json({ success: false, error: 'wrong_password', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }

    await pool.query('UPDATE admins SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [
      await bcrypt.hash(next, 10),
      req.admin!.id,
    ]);
    await pool.query('DELETE FROM admin_sessions WHERE admin_id = ? AND token <> ?', [
      req.admin!.id,
      currentToken(req),
    ]);

    await logAudit(req, 'admin_change_password', { targetType: 'admin', targetId: req.admin!.id, summary: 'เปลี่ยนรหัสผ่านของตัวเอง' });
    res.json({ success: true });
  }
);

// ---------- 2FA ----------
adminAccountRouter.post('/2fa/setup', bucketLimiter('admin_2fa', 10, 60_000), requireAdmin, async (req: AdminRequest, res) => {
  const [rows] = await pool.query('SELECT username, totp_enabled FROM admins WHERE id = ? LIMIT 1', [req.admin!.id]);
  const a = (rows as any[])[0];
  if (Number(a?.totp_enabled) === 1) {
    return res.status(400).json({ success: false, error: 'already_enabled', message: 'เปิดใช้งาน 2FA อยู่แล้ว' });
  }

  const secret = generateSecret();
  const otpauth = generateURI({ issuer: TOTP_ISSUER, label: `admin:${a.username}`, secret });
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });

  await pool.query('UPDATE admins SET totp_secret = ? WHERE id = ?', [secret, req.admin!.id]);
  res.json({ success: true, secret, otpauth, qr });
});

adminAccountRouter.post('/2fa/enable', bucketLimiter('admin_2fa', 10, 60_000), requireAdmin, async (req: AdminRequest, res) => {
  const code = String(req.body?.code || '').replace(/\s/g, '');
  const [rows] = await pool.query('SELECT totp_secret, totp_enabled FROM admins WHERE id = ? LIMIT 1', [req.admin!.id]);
  const a = (rows as any[])[0];

  if (!a?.totp_secret) {
    return res.status(400).json({ success: false, error: 'no_setup', message: 'ยังไม่ได้เริ่มตั้งค่า 2FA' });
  }
  if (Number(a.totp_enabled) === 1) {
    return res.status(400).json({ success: false, error: 'already_enabled', message: 'เปิดใช้งานอยู่แล้ว' });
  }
  if (!checkTotp(code, a.totp_secret)) {
    return res.status(400).json({ success: false, error: 'invalid_code', message: 'รหัสไม่ถูกต้องหรือหมดอายุ ลองใหม่อีกครั้ง' });
  }

  await pool.query('UPDATE admins SET totp_enabled = 1 WHERE id = ?', [req.admin!.id]);
  await logAudit(req, 'admin_enable_2fa', { targetType: 'admin', targetId: req.admin!.id, summary: 'เปิดใช้งาน 2FA ของตัวเอง' });
  res.json({ success: true });
});

adminAccountRouter.post('/2fa/disable', bucketLimiter('admin_2fa', 10, 60_000), requireAdmin, async (req: AdminRequest, res) => {
  const password = String(req.body?.password || '');
  const code = String(req.body?.code || '').replace(/\s/g, '');

  const [rows] = await pool.query('SELECT password_hash, totp_secret, totp_enabled FROM admins WHERE id = ? LIMIT 1', [
    req.admin!.id,
  ]);
  const a = (rows as any[])[0];

  if (Number(a?.totp_enabled) !== 1) {
    return res.status(400).json({ success: false, error: 'not_enabled', message: 'ยังไม่ได้เปิดใช้งาน 2FA' });
  }
  if (!a.password_hash || !(await bcrypt.compare(password, a.password_hash))) {
    return res.status(401).json({ success: false, error: 'wrong_password', message: 'รหัสผ่านไม่ถูกต้อง' });
  }
  if (!checkTotp(code, a.totp_secret)) {
    return res.status(400).json({ success: false, error: 'invalid_code', message: 'รหัส 6 หลักไม่ถูกต้อง' });
  }

  await pool.query('UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.admin!.id]);
  await logAudit(req, 'admin_disable_2fa', { targetType: 'admin', targetId: req.admin!.id, summary: 'ปิด 2FA ของตัวเอง' });
  res.json({ success: true });
});

// ---------- เซสชันของตัวเอง ----------
adminAccountRouter.get('/sessions', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const token = currentToken(req);
  const [rows] = await pool.query(
    'SELECT id, created_at, expires_at, ip, user_agent, (token = ?) AS is_current FROM admin_sessions WHERE admin_id = ? ORDER BY created_at DESC LIMIT 20',
    [token, req.admin!.id]
  );
  res.json({ success: true, sessions: rows });
});

adminAccountRouter.post('/sessions/revoke_others', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const [result]: any = await pool.query('DELETE FROM admin_sessions WHERE admin_id = ? AND token <> ?', [
    req.admin!.id,
    currentToken(req),
  ]);
  await logAudit(req, 'admin_revoke_sessions', {
    targetType: 'admin',
    targetId: req.admin!.id,
    summary: `ออกจากระบบอุปกรณ์อื่น ${result?.affectedRows ?? 0} เครื่อง`,
  });
  res.json({ success: true, revoked: result?.affectedRows ?? 0 });
});

// ---------- จัดการบัญชีผู้ดูแลระบบคนอื่น ----------
adminAccountRouter.get('/admins', bucketLimiter('admin_account'), requireAdmin, async (_req: AdminRequest, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, name, email, is_owner, is_active, totp_enabled, last_login_at, created_at
     FROM admins ORDER BY is_owner DESC, id ASC`
  );
  res.json({ success: true, admins: rows });
});

adminAccountRouter.post('/admins', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_username',
      message: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–64 ตัว',
    });
  }
  if (name.length < 2) {
    return res.status(400).json({ success: false, error: 'invalid_name', message: 'กรุณากรอกชื่อ' });
  }
  if (password.length < 10) {
    return res.status(400).json({ success: false, error: 'weak_password', message: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' });
  }

  try {
    const [result]: any = await pool.query(
      `INSERT INTO admins (username, name, email, password_hash, is_active, password_changed_at)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [username, name, email || null, await bcrypt.hash(password, 10)]
    );
    await logAudit(req, 'admin_create', {
      targetType: 'admin',
      targetId: result?.insertId,
      summary: `สร้างบัญชีผู้ดูแลระบบ "${username}"`,
    });
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'username_taken', message: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
    }
    throw e;
  }
});

adminAccountRouter.post('/admins/toggle', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const targetId = Number(req.body?.admin_id || 0);
  const [rows] = await pool.query('SELECT id, username, is_owner, is_active FROM admins WHERE id = ? LIMIT 1', [targetId]);
  const target = (rows as any[])[0];
  if (!target) return res.status(404).json({ success: false, error: 'not_found' });

  // กันล็อกตัวเองและกันล็อกทุกคนออกจากระบบ
  if (Number(target.is_owner) === 1) {
    return res
      .status(400)
      .json({ success: false, error: 'owner_protected', message: 'ระงับบัญชีเจ้าของระบบไม่ได้' });
  }
  if (target.id === req.admin!.id) {
    return res.status(400).json({ success: false, error: 'self', message: 'ระงับบัญชีตัวเองไม่ได้' });
  }

  await pool.query('UPDATE admins SET is_active = 1 - is_active WHERE id = ?', [targetId]);
  // ถูกระงับแล้วต้องเตะออกจากระบบทันที ไม่ใช่รอ session หมดอายุเอง
  const nowActive = Number(target.is_active) !== 1;
  if (!nowActive) {
    await pool.query('DELETE FROM admin_sessions WHERE admin_id = ?', [targetId]);
  }

  await logAudit(req, 'admin_toggle', {
    targetType: 'admin',
    targetId,
    summary: `${nowActive ? 'เปิด' : 'ระงับ'}บัญชีผู้ดูแลระบบ "${target.username}"`,
    detail: { is_active: nowActive ? 1 : 0 },
  });
  res.json({ success: true });
});

adminAccountRouter.post('/admins/reset_password', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const targetId = Number(req.body?.admin_id || 0);
  const newPassword = String(req.body?.new_password || '');
  if (newPassword.length < 10) {
    return res.status(400).json({ success: false, error: 'weak_password', message: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' });
  }

  const [rows] = await pool.query('SELECT id, username, is_owner FROM admins WHERE id = ? LIMIT 1', [targetId]);
  const target = (rows as any[])[0];
  if (!target) return res.status(404).json({ success: false, error: 'not_found' });

  // เฉพาะเจ้าของระบบเท่านั้นที่ตั้งรหัสผ่านให้บัญชีเจ้าของระบบได้ — ไม่งั้นแอดมินคนไหนก็ยึดระบบได้
  if (Number(target.is_owner) === 1 && req.admin!.is_owner !== 1) {
    return res
      .status(403)
      .json({ success: false, error: 'owner_protected', message: 'เฉพาะบัญชีเจ้าของระบบเท่านั้นที่ทำได้' });
  }

  await pool.query('UPDATE admins SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [
    await bcrypt.hash(newPassword, 10),
    targetId,
  ]);
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = ?', [targetId]);

  await logAudit(req, 'admin_reset_password', {
    targetType: 'admin',
    targetId,
    summary: `รีเซ็ตรหัสผ่านผู้ดูแลระบบ "${target.username}"`,
  });
  res.json({ success: true });
});

adminAccountRouter.post('/admins/disable_2fa', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  const targetId = Number(req.body?.admin_id || 0);
  const [rows] = await pool.query('SELECT id, username, is_owner, totp_enabled FROM admins WHERE id = ? LIMIT 1', [targetId]);
  const target = (rows as any[])[0];
  if (!target) return res.status(404).json({ success: false, error: 'not_found' });
  if (Number(target.totp_enabled) !== 1) {
    return res.status(400).json({ success: false, error: 'not_enabled', message: 'บัญชีนี้ไม่ได้เปิด 2FA' });
  }
  if (Number(target.is_owner) === 1 && req.admin!.is_owner !== 1) {
    return res
      .status(403)
      .json({ success: false, error: 'owner_protected', message: 'เฉพาะบัญชีเจ้าของระบบเท่านั้นที่ทำได้' });
  }

  await pool.query('UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [targetId]);
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = ?', [targetId]);

  await logAudit(req, 'admin_disable_2fa_other', {
    targetType: 'admin',
    targetId,
    summary: `ปลด 2FA ของผู้ดูแลระบบ "${target.username}"`,
  });
  res.json({ success: true });
});

// ---------- บันทึกการใช้งาน ----------
adminAccountRouter.get('/audit', bucketLimiter('admin_account'), requireAdmin, async (req: AdminRequest, res) => {
  let limit = parseInt((req.query.limit as string) || '50', 10);
  if (!limit || limit <= 0 || limit > 200) limit = 50;
  const beforeId = parseInt((req.query.before_id as string) || '0', 10);
  const actionFilter = String(req.query.action || '').trim();

  let sql = 'SELECT id, admin_id, admin_username, action, target_type, target_id, summary, detail, ip, created_at FROM audit_log WHERE 1=1';
  const params: any[] = [];
  if (actionFilter) {
    sql += ' AND action = ?';
    params.push(actionFilter);
  }
  if (beforeId > 0) {
    sql += ' AND id < ?';
    params.push(beforeId);
  }
  sql += ' ORDER BY id DESC LIMIT ' + limit;

  const [rows] = await pool.query(sql, params);
  const entries = rows as any[];

  // รายชื่อ action ที่เคยเกิดขึ้นจริง เอาไว้ทำตัวกรองในหน้าเว็บ (ไม่ hardcode รายการไว้ฝั่ง frontend)
  const [actions] = await pool.query('SELECT DISTINCT action FROM audit_log ORDER BY action');

  res.json({
    success: true,
    entries,
    has_more: entries.length >= limit,
    actions: (actions as any[]).map((a) => a.action),
  });
});
