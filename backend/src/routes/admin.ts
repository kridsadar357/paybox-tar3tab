// JSON API สำหรับ paybox-control (React admin) — ทดแทน admin_api.php เดิม ทุก resource/action
// คงชื่อ resource/action เดิมไว้ทั้งหมดเพื่อให้ frontend เดิมใช้ได้โดยไม่ต้องแก้โค้ด
import { Router } from 'express';
import { isFeeBelowCost, grossPercentForNetMargin } from '../lib/money';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { config } from '../config';
import { requireAdmin, AdminRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { checkTotp } from '../lib/totp';
import { logAudit } from '../lib/audit';
import { toCsv, sendCsv, thaiDateTime } from '../lib/csv';
import { getDeviceActivity, evaluateQuiet, QUIET_PERIOD_MINUTES } from '../lib/deviceCommands';

export const adminRouter = Router();
adminRouter.use(bucketLimiter('admin_api', 120, 60_000));

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ชม.

// เช็ค admin_password ครั้งเดียวตรงนี้ที่เดียว แล้วออก session token ให้ใช้แทนในทุก request ถัดไป
// (ก่อนหน้านี้ frontend ส่ง admin_password แนบไปกับทุก request รวมถึงใน query string ซึ่งหลุดไปอยู่ใน
// access log ของ reverse proxy/browser history ได้ — ย้ายมาเช็คครั้งเดียวตรงนี้แทน)
adminRouter.post('/login', bucketLimiter('admin_login', 10, 60_000), async (req, res) => {
  // รองรับสองรูปแบบ:
  //   ใหม่  — username + password (+ otp ถ้าบัญชีเปิด 2FA)
  //   เดิม  — admin_password อย่างเดียว จะถูกตีความเป็นบัญชีเจ้าของระบบ (is_owner = 1)
  // ที่ต้องคงแบบเดิมไว้เพราะเป็นทางกลับบ้านเวลาหน้าเว็บใหม่มีปัญหา — ยังต้องใช้รหัสผ่านที่ถูกต้อง
  // และยังต้องผ่าน 2FA ถ้าบัญชีนั้นเปิดไว้ จึงไม่ได้อ่อนกว่าทางใหม่
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || req.body?.admin_password || '');
  const otp = String(req.body?.otp || '').replace(/\s/g, '');

  if (!password) {
    return res.status(401).json({ success: false, error: 'invalid_credentials' });
  }

  const [rows] = username
    ? await pool.query(
        'SELECT id, username, password_hash, is_active, totp_enabled, totp_secret FROM admins WHERE username = ? LIMIT 1',
        [username]
      )
    : await pool.query(
        'SELECT id, username, password_hash, is_active, totp_enabled, totp_secret FROM admins WHERE is_owner = 1 ORDER BY id LIMIT 1'
      );
  const admin = (rows as any[])[0];

  const bcrypt = await import('bcryptjs');
  const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;

  if (!admin || !valid || Number(admin.is_active) !== 1) {
    console.error(`ปฏิเสธการเข้าสู่ระบบแอดมิน: ${username || '(บัญชีเจ้าของ)'} จาก ${req.ip}`);
    return res.status(401).json({ success: false, error: 'invalid_credentials' });
  }

  if (Number(admin.totp_enabled) === 1) {
    if (!otp) {
      return res.status(401).json({ success: false, error: 'otp_required' });
    }
    if (!checkTotp(otp, admin.totp_secret)) {
      return res.status(401).json({ success: false, error: 'invalid_otp' });
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO admin_sessions (admin_id, token, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
    [
      admin.id,
      token,
      expiresAt,
      (req.ip || '').slice(0, 45) || null,
      String(req.headers['user-agent'] || '').slice(0, 255) || null,
    ]
  );
  await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);

  res.json({ success: true, token, username: admin.username });
});

adminRouter.use(requireAdmin);

// ---- ดาวน์โหลด CSV ของรอบโอนเงิน ----
// ต้องอยู่หลัง adminRouter.use(requireAdmin) เท่านั้น — ไฟล์นี้มีเลขบัญชีธนาคารของลูกค้าทุกราย
// ประกาศก่อน handler ของ GET '/' เพราะ Express จับคู่ path ตามลำดับที่ประกาศ
adminRouter.get('/export/settlements.csv', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.created_at, s.settled_at, c.name AS customer_name, c.email AS customer_email,
            c.payout_bank, c.payout_account_no, c.payout_account_name,
            s.tx_count, s.total_amount, s.total_fee, s.total_net, s.status, s.proof_reference, s.note
     FROM settlements s LEFT JOIN customers c ON c.id = s.customer_id
     ORDER BY s.id DESC LIMIT 10000`
  );
  const csv = toCsv(
    ['รอบที่', 'วันที่สร้าง', 'วันที่โอน', 'ลูกค้า', 'อีเมล', 'ธนาคาร', 'เลขบัญชี', 'ชื่อบัญชี',
     'จำนวนรายการ', 'ยอดรวม', 'ค่าธรรมเนียม', 'ยอดโอนสุทธิ', 'สถานะ', 'อ้างอิงการโอน', 'หมายเหตุ'],
    (rows as any[]).map((r) => [
      r.id,
      thaiDateTime(r.created_at),
      thaiDateTime(r.settled_at),
      r.customer_name || '',
      r.customer_email || '',
      r.payout_bank || '',
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเลขบัญชีเป็นข้อความ ไม่งั้นศูนย์นำหน้าจะหายและเลขยาวจะกลายเป็น 1.23E+11
      r.payout_account_no ? `'${r.payout_account_no}` : '',
      r.payout_account_name || '',
      r.tx_count,
      Number(r.total_amount).toFixed(2),
      Number(r.total_fee).toFixed(2),
      Number(r.total_net).toFixed(2),
      r.status,
      r.proof_reference || '',
      r.note || '',
    ])
  );
  sendCsv(res, 'paybox-settlements-all.csv', csv);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---- POST actions ----
adminRouter.post('/', upload.single('proof_file'), async (req: AdminRequest, res) => {
  const action = req.body.action as string;

  try {
    if (action === 'add_device' && req.body.device_name) {
      const newKey = crypto.randomBytes(16).toString('hex');
      const deviceName = String(req.body.device_name).trim();
      const [result]: any = await pool.query('INSERT INTO devices (device_key, name, is_active) VALUES (?, ?, 1)', [
        newKey,
        deviceName,
      ]);
      await logAudit(req, 'add_device', {
        targetType: 'device',
        targetId: result?.insertId,
        summary: `เพิ่มอุปกรณ์ "${deviceName}"`,
      });
      return res.json({ success: true, device_key: newKey });
    }

    if (action === 'toggle' && req.body.device_id) {
      const deviceId = Number(req.body.device_id);
      await pool.query('UPDATE devices SET is_active = 1 - is_active WHERE id = ?', [deviceId]);
      const [after] = await pool.query('SELECT name, is_active FROM devices WHERE id = ? LIMIT 1', [deviceId]);
      const d = (after as any[])[0];
      await logAudit(req, 'toggle_device', {
        targetType: 'device',
        targetId: deviceId,
        summary: `${Number(d?.is_active) === 1 ? 'เปิด' : 'ปิด'}ใช้งานอุปกรณ์ "${d?.name ?? deviceId}"`,
        detail: { is_active: Number(d?.is_active) },
      });
      return res.json({ success: true });
    }

    if (action === 'assign_device' && req.body.device_id) {
      const deviceId = Number(req.body.device_id);
      const customerId = Number(req.body.customer_id || 0);
      await pool.query('UPDATE devices SET customer_id = ? WHERE id = ?', [
        customerId > 0 ? customerId : null,
        deviceId,
      ]);
      const [names] = await pool.query(
        `SELECT d.name AS device_name, c.name AS customer_name
         FROM devices d LEFT JOIN customers c ON c.id = d.customer_id WHERE d.id = ? LIMIT 1`,
        [deviceId]
      );
      const n = (names as any[])[0];
      await logAudit(req, 'assign_device', {
        targetType: 'device',
        targetId: deviceId,
        summary: `ย้ายอุปกรณ์ "${n?.device_name ?? deviceId}" ไปเจ้าของ "${n?.customer_name ?? 'ไม่มีเจ้าของ'}"`,
        detail: { customer_id: customerId > 0 ? customerId : null },
      });
      return res.json({ success: true });
    }

    if (action === 'add_customer' && req.body.customer_name && req.body.customer_email && req.body.customer_password) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(String(req.body.customer_password), 10);
      try {
        const custName = String(req.body.customer_name).trim();
        const custEmail = String(req.body.customer_email).trim();
        const [result]: any = await pool.query(
          'INSERT INTO customers (name, email, password_hash) VALUES (?, ?, ?)',
          [custName, custEmail, hash]
        );
        await logAudit(req, 'add_customer', {
          targetType: 'customer',
          targetId: result?.insertId,
          summary: `สร้างบัญชีลูกค้า "${custName}" (${custEmail})`,
        });
        return res.json({ success: true });
      } catch (e: any) {
        if (e.code === 'ER_DUP_ENTRY') {
          return res.json({ success: false, error: 'email_taken' });
        }
        throw e;
      }
    }

    if (action === 'toggle_customer' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      await pool.query('UPDATE customers SET is_active = 1 - is_active WHERE id = ?', [customerId]);
      const [after] = await pool.query('SELECT name, is_active FROM customers WHERE id = ? LIMIT 1', [customerId]);
      const c = (after as any[])[0];
      await logAudit(req, 'toggle_customer', {
        targetType: 'customer',
        targetId: customerId,
        summary: `${Number(c?.is_active) === 1 ? 'เปิด' : 'ระงับ'}บัญชีลูกค้า "${c?.name ?? customerId}"`,
        detail: { is_active: Number(c?.is_active) },
      });
      return res.json({ success: true });
    }

    // ---- สั่งอัปเดตเฟิร์มแวร์ (เข้าคิว ไม่ได้ยิงตรง) ----
    // backend สั่งบอร์ดตรงๆ ไม่ได้ จึงพักคำสั่งไว้ให้บอร์ดมารับตอน heartbeat รอบถัดไป
    // และคำสั่งจะยังไม่ถูกปล่อยจนกว่าเครื่องจะนิ่ง — ดูกติกาใน lib/deviceCommands.ts
    if (action === 'queue_force_update' && req.body.device_ids) {
      const ids = String(req.body.device_ids)
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => v > 0);
      if (ids.length === 0) {
        return res.status(400).json({ success: false, error: 'no_devices' });
      }

      const [rows] = await pool.query(
        `SELECT id, name, shop_name, firmware_version FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const devices = rows as any[];

      const queued: any[] = [];
      const skipped: any[] = [];
      for (const d of devices) {
        // มีคำสั่งค้างอยู่แล้วไม่ต้องซ้ำ — กดรัวก็ไม่ทำให้เกิดคิวซ้อนกันหลายอัน
        const [existing] = await pool.query(
          "SELECT id FROM device_commands WHERE device_id = ? AND command = 'force_update' AND status IN ('pending','dispatched') LIMIT 1",
          [d.id]
        );
        if ((existing as any[]).length > 0) {
          skipped.push({ id: d.id, name: d.shop_name || d.name, reason: 'มีคำสั่งค้างอยู่แล้ว' });
          continue;
        }

        const activity = await getDeviceActivity(d.id);
        const check = evaluateQuiet(activity);
        await pool.query(
          `INSERT INTO device_commands (device_id, command, status, requested_by_admin_id, requested_by_username,
                                        from_version, hold_reason)
           VALUES (?, 'force_update', 'pending', ?, ?, ?, ?)`,
          [d.id, req.admin?.id ?? null, req.admin?.username ?? null, d.firmware_version || null,
           check.quiet ? null : check.reason]
        );
        queued.push({
          id: d.id,
          name: d.shop_name || d.name,
          quiet: check.quiet,
          reason: check.reason,
          wait_seconds: check.waitSeconds,
        });
      }

      await logAudit(req, 'queue_force_update', {
        targetType: 'device',
        targetId: queued.map((q) => q.id).join(','),
        summary: `สั่งอัปเดตเฟิร์มแวร์ ${queued.length} เครื่อง`,
        detail: { queued, skipped },
      });
      return res.json({ success: true, queued, skipped });
    }

    // ---- สั่งรีสตาร์ตเครื่อง ----
    // ไม่รอคิวเหมือน force_update โดยตั้งใจ: เหตุผลหลักที่ต้องสั่งรีสตาร์ตคือเครื่องค้าง ซึ่งเป็น
    // สถานการณ์ที่รายการอาจค้างอยู่และตัวนับ "นิ่ง 5 นาที" ไม่มีวันครบ — บังคับให้รอเท่ากับทำให้
    // ปุ่มนี้ใช้ไม่ได้ในกรณีที่จำเป็นที่สุด (ตัวบอร์ดยังมีตัวกันซ้อนอีกชั้นก่อนรีบูตจริง)
    if (action === 'restart_device' && req.body.device_ids) {
      const ids = String(req.body.device_ids)
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => v > 0);
      if (ids.length === 0) {
        return res.status(400).json({ success: false, error: 'no_devices' });
      }

      const [rows] = await pool.query(
        `SELECT id, name, shop_name FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );

      const queued: any[] = [];
      for (const d of rows as any[]) {
        const [existing] = await pool.query(
          "SELECT id FROM device_commands WHERE device_id = ? AND command = 'restart' AND status IN ('pending','dispatched') LIMIT 1",
          [d.id]
        );
        if ((existing as any[]).length > 0) continue; // มีคำสั่งค้างอยู่แล้ว ไม่ต้องซ้ำ

        const activity = await getDeviceActivity(d.id);
        await pool.query(
          `INSERT INTO device_commands (device_id, command, status, requested_by_admin_id, requested_by_username, hold_reason)
           VALUES (?, 'restart', 'pending', ?, ?, ?)`,
          [d.id, req.admin?.id ?? null, req.admin?.username ?? null,
           activity.hasOpenSession ? 'สั่งขณะมีรายการที่ยังไม่จบ' : null]
        );
        queued.push({ id: d.id, name: d.shop_name || d.name, had_open_session: activity.hasOpenSession });
      }

      await logAudit(req, 'restart_device', {
        targetType: 'device',
        targetId: queued.map((q) => q.id).join(','),
        summary: `สั่งรีสตาร์ต ${queued.length} เครื่อง`,
        detail: { queued },
      });
      return res.json({ success: true, queued });
    }

    if (action === 'cancel_force_update' && req.body.device_ids) {
      const ids = String(req.body.device_ids)
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => v > 0);
      if (ids.length === 0) {
        return res.status(400).json({ success: false, error: 'no_devices' });
      }
      const [result]: any = await pool.query(
        `UPDATE device_commands SET status = 'cancelled', completed_at = NOW()
         WHERE command = 'force_update' AND status IN ('pending','dispatched')
           AND device_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      await logAudit(req, 'cancel_force_update', {
        targetType: 'device',
        targetId: ids.join(','),
        summary: `ยกเลิกคำสั่งอัปเดต ${result?.affectedRows ?? 0} รายการ`,
      });
      return res.json({ success: true, cancelled: result?.affectedRows ?? 0 });
    }

    // แก้ชื่อ/อีเมลลูกค้า — เดิมพิมพ์ผิดตอนสร้างแล้วแก้ไม่ได้เลย ต้องไปแก้ที่ DB
    if (action === 'update_customer' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      const name = String(req.body.customer_name || '').trim();
      const email = String(req.body.customer_email || '').trim();

      if (name.length < 2) {
        return res.status(400).json({ success: false, error: 'invalid_name' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'invalid_email' });
      }

      const [before] = await pool.query('SELECT name, email FROM customers WHERE id = ? LIMIT 1', [customerId]);
      const prev = (before as any[])[0];
      if (!prev) return res.status(404).json({ success: false, error: 'customer_not_found' });

      try {
        await pool.query('UPDATE customers SET name = ?, email = ? WHERE id = ?', [name, email, customerId]);
      } catch (e: any) {
        if (e.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, error: 'email_taken' });
        }
        throw e;
      }

      await logAudit(req, 'update_customer', {
        targetType: 'customer',
        targetId: customerId,
        summary: `แก้ข้อมูลลูกค้า "${prev.name}" → "${name}"`,
        detail: { before: { name: prev.name, email: prev.email }, after: { name, email } },
      });
      return res.json({ success: true });
    }

    // ---- กู้คืนการเข้าถึงบัญชีลูกค้า ----
    // หน้า login บอกลูกค้าว่า "ลืมรหัสผ่านกรุณาติดต่อผู้ดูแลระบบ" แต่เดิมแอดมินไม่มีเครื่องมือทำจริง
    // ต้องไปแก้ DB ด้วยมือ และถ้าลูกค้าเปิด 2FA แล้วทำมือถือหายก็เข้าระบบไม่ได้ถาวร สองแอ็กชันนี้
    // ปิดช่องว่างนั้น — ทั้งคู่ล้าง session ทิ้งทั้งหมดเพื่อบังคับให้เข้าสู่ระบบใหม่หลังเปลี่ยนสิทธิ์
    if (action === 'reset_customer_password' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      const newPassword = String(req.body.new_password || '');
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'password_too_short' });
      }

      const [rows] = await pool.query('SELECT id, name FROM customers WHERE id = ? LIMIT 1', [customerId]);
      const target = (rows as any[])[0];
      if (!target) {
        return res.status(404).json({ success: false, error: 'customer_not_found' });
      }

      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE customers SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [
        hash,
        customerId,
      ]);
      // ตัด session เดิมทิ้งทั้งหมด — ถ้ารีเซ็ตเพราะสงสัยว่าบัญชีถูกยึด การปล่อยให้ session เก่า
      // ใช้ได้ต่อเท่ากับรีเซ็ตไปก็ไม่ช่วยอะไร
      const [gone]: any = await pool.query('DELETE FROM customer_sessions WHERE customer_id = ?', [customerId]);
      // ไม่บันทึกรหัสผ่านลงบันทึกเด็ดขาด — เก็บแค่ว่าเกิดการรีเซ็ตขึ้นเมื่อไหร่โดยใคร
      await logAudit(req, 'reset_customer_password', {
        targetType: 'customer',
        targetId: customerId,
        summary: `รีเซ็ตรหัสผ่านลูกค้า "${target.name}" และตัด session ${gone?.affectedRows ?? 0} รายการ`,
        detail: { sessions_revoked: gone?.affectedRows ?? 0 },
      });
      return res.json({ success: true });
    }

    if (action === 'disable_customer_2fa' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      const [rows] = await pool.query('SELECT name, totp_enabled FROM customers WHERE id = ? LIMIT 1', [customerId]);
      const c = (rows as any[])[0];
      if (!c) {
        return res.status(404).json({ success: false, error: 'customer_not_found' });
      }
      if (Number(c.totp_enabled) !== 1) {
        return res.status(400).json({ success: false, error: 'not_enabled' });
      }

      await pool.query('UPDATE customers SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [customerId]);
      await pool.query('DELETE FROM customer_sessions WHERE customer_id = ?', [customerId]);
      await logAudit(req, 'disable_customer_2fa', {
        targetType: 'customer',
        targetId: customerId,
        summary: `ปลด 2FA ของลูกค้า "${c.name}"`,
      });
      return res.json({ success: true });
    }

    if (action === 'update_fee' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      const feeTier = req.body.fee_tier === 'flat' ? 'flat' : 'percentage';
      const feePercent = Math.max(0, parseFloat(req.body.fee_percent || '1'));
      const flatFeeAmount = Math.max(0, parseFloat(req.body.flat_fee_amount || '0'));

      // กันไม่ให้ตั้งอัตราที่ขาดทุนแน่ๆ — ตัวเลขที่ตั้งตรงนี้คือที่เก็บจากร้านค้า ไม่ใช่ที่เราได้
      // ส่วนที่เราได้คือ ตัวเลขนี้ ลบ ต้นทุนของผู้ให้บริการ
      if (feeTier === 'percentage' && isFeeBelowCost(feePercent, config.providerFeePercent)) {
        return res.status(400).json({
          success: false,
          error: 'fee_below_cost',
          message:
            `อัตรานี้ต่ำกว่าต้นทุน — ผู้ให้บริการรับชำระเงินเก็บ ${config.providerFeePercent}% ` +
            `ต้องตั้งสูงกว่านั้น เช่น ${grossPercentForNetMargin(1, config.providerFeePercent)}% ` +
            `จะเหลือกำไรสุทธิ 1.00%`,
        });
      }

      // เก็บค่าเดิมไว้ก่อนเขียนทับ — บันทึกที่บอกแค่ค่าใหม่ตอบไม่ได้ว่า "เปลี่ยนจากเท่าไหร่"
      const [before] = await pool.query(
        'SELECT name, fee_tier, fee_percent, flat_fee_amount FROM customers WHERE id = ? LIMIT 1',
        [customerId]
      );
      const prev = (before as any[])[0];

      await pool.query('UPDATE customers SET fee_tier = ?, fee_percent = ?, flat_fee_amount = ? WHERE id = ?', [
        feeTier,
        feePercent,
        flatFeeAmount,
        customerId,
      ]);

      const describe = (tier: string, pct: number, flat: number) =>
        tier === 'flat' ? `เหมาจ่าย ฿${flat}` : `${pct}%`;
      await logAudit(req, 'update_fee', {
        targetType: 'customer',
        targetId: customerId,
        summary:
          `แก้ค่าธรรมเนียม "${prev?.name ?? customerId}" ` +
          `จาก ${describe(prev?.fee_tier, Number(prev?.fee_percent), Number(prev?.flat_fee_amount))} ` +
          `เป็น ${describe(feeTier, feePercent, flatFeeAmount)}`,
        detail: {
          before: prev
            ? { fee_tier: prev.fee_tier, fee_percent: Number(prev.fee_percent), flat_fee_amount: Number(prev.flat_fee_amount) }
            : null,
          after: { fee_tier: feeTier, fee_percent: feePercent, flat_fee_amount: flatFeeAmount },
        },
      });
      return res.json({ success: true });
    }

    if (action === 'create_settlement' && req.body.customer_id) {
      const customerId = Number(req.body.customer_id);
      const result = await createSettlement(customerId);
      if ((result as any)?.success) {
        await logAudit(req, 'create_settlement', {
          targetType: 'settlement',
          targetId: (result as any).settlement_id ?? null,
          summary: `เปิดรอบโอนเงินให้ลูกค้า #${customerId}`,
          detail: result as Record<string, unknown>,
        });
      }
      return res.json(result);
    }

    if (action === 'mark_settled' && req.body.settlement_id) {
      const settlementId = Number(req.body.settlement_id);
      const proofReference = (req.body.proof_reference || '').trim() || null;
      let proofFilename: string | null = null;

      if (req.file) {
        const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
        if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
          const proofDir = path.join(config.uploadsDir, 'settlement_proofs');
          fs.mkdirSync(proofDir, { recursive: true });
          proofFilename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
          fs.writeFileSync(path.join(proofDir, proofFilename), req.file.buffer);
        }
      }

      // ยอมให้ปิดจาก 'problem' ได้ด้วย — รอบที่เคยติดปัญหาแล้วโอนสำเร็จภายหลังต้องปิดได้
      // และเคลียร์ note ทิ้งเพราะปัญหาถูกแก้แล้ว
      if (proofFilename) {
        await pool.query(
          "UPDATE settlements SET status = 'settled', proof_reference = ?, proof_file = ?, note = NULL, settled_at = NOW() WHERE id = ? AND status IN ('pending','problem')",
          [proofReference, proofFilename, settlementId]
        );
      } else {
        await pool.query(
          "UPDATE settlements SET status = 'settled', proof_reference = ?, note = NULL, settled_at = NOW() WHERE id = ? AND status IN ('pending','problem')",
          [proofReference, settlementId]
        );
      }

      // การปิดรอบโอนเงินคือแอ็กชันที่แตะเงินตรงที่สุดในระบบ — บันทึกยอดไว้ด้วยเพื่อกระทบยอดย้อนหลังได้
      const [sRows] = await pool.query(
        `SELECT s.total_net, s.customer_id, c.name AS customer_name
         FROM settlements s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ? LIMIT 1`,
        [settlementId]
      );
      const s = (sRows as any[])[0];
      await logAudit(req, 'mark_settled', {
        targetType: 'settlement',
        targetId: settlementId,
        summary: `ปิดรอบโอนเงิน #${settlementId} ให้ "${s?.customer_name ?? '-'}" ยอด ฿${Number(s?.total_net ?? 0).toFixed(2)}`,
        detail: {
          customer_id: s?.customer_id ?? null,
          total_net: Number(s?.total_net ?? 0),
          proof_reference: proofReference,
          has_proof_file: Boolean(proofFilename),
        },
      });
      return res.json({ success: true });
    }

    // ทำเครื่องหมายว่ารอบนี้ติดปัญหา (เช่น เลขบัญชีผิด ธนาคารตีกลับ) พร้อมเหตุผล
    if (action === 'mark_problem' && req.body.settlement_id) {
      const settlementId = Number(req.body.settlement_id);
      const note = String(req.body.note || '').trim().slice(0, 500);
      if (!note) {
        return res.status(400).json({ success: false, error: 'note_required' });
      }
      await pool.query(
        "UPDATE settlements SET status = 'problem', note = ? WHERE id = ? AND status IN ('pending','problem')",
        [note, settlementId]
      );
      await logAudit(req, 'mark_problem', {
        targetType: 'settlement',
        targetId: settlementId,
        summary: `ทำเครื่องหมายว่ารอบ #${settlementId} ติดปัญหา`,
        detail: { note },
      });
      return res.json({ success: true });
    }

    // กลับไปสถานะรอโอนตามปกติ (ยกเลิกการทำเครื่องหมายว่าติดปัญหา)
    if (action === 'clear_problem' && req.body.settlement_id) {
      const settlementId = Number(req.body.settlement_id);
      await pool.query("UPDATE settlements SET status = 'pending', note = NULL WHERE id = ? AND status = 'problem'", [
        settlementId,
      ]);
      await logAudit(req, 'clear_problem', {
        targetType: 'settlement',
        targetId: settlementId,
        summary: `ยกเลิกสถานะติดปัญหาของรอบ #${settlementId}`,
      });
      return res.json({ success: true });
    }

    if (action === 'upload_firmware') {
      // ไฟล์ firmware .bin แนบเป็น field แยก ไม่ใช่ proof_file — จัดการแยกที่ /admin/upload_firmware
      return res.json({ success: false, error: 'use_dedicated_endpoint' });
    }

    return res.json({ success: false, error: 'unknown_action' });
  } catch (e: any) {
    console.error('admin_api error:', e.message);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

async function createSettlement(customerId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [insertResult] = await conn.query("INSERT INTO settlements (customer_id, status) VALUES (?, 'pending')", [
      customerId,
    ]);
    const settlementId = (insertResult as any).insertId;

    const [updateResult] = await conn.query(
      `UPDATE transactions t JOIN devices d ON d.id = t.device_id
       SET t.settlement_id = ?
       WHERE d.customer_id = ? AND t.status = 'succeeded' AND t.settlement_id IS NULL`,
      [settlementId, customerId]
    );

    if ((updateResult as any).affectedRows === 0) {
      await conn.rollback();
      return { success: false, error: 'nothing_to_settle' };
    }

    const [sumRows] = await conn.query(
      `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount),0) AS total_amount,
              COALESCE(SUM(fee_amount),0) AS total_fee, COALESCE(SUM(net_amount),0) AS total_net
       FROM transactions WHERE settlement_id = ?`,
      [settlementId]
    );
    const sums = (sumRows as any[])[0];
    await conn.query('UPDATE settlements SET tx_count = ?, total_amount = ?, total_fee = ?, total_net = ? WHERE id = ?', [
      sums.tx_count,
      sums.total_amount,
      sums.total_fee,
      sums.total_net,
      settlementId,
    ]);
    await conn.commit();
    return { success: true, settlement_id: settlementId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- GET resources ----
adminRouter.get('/', async (req, res) => {
  const resource = (req.query.resource as string) || 'summary';

  if (resource === 'devices') {
    const [rows] = await pool.query(
      `SELECT d.id, d.device_key, d.name, d.shop_name, d.is_active, d.created_at, d.last_seen_at,
              d.firmware_version, d.customer_id, d.entry_method, d.op_mode, d.fixed_amount,
              c.name AS customer_name,
              cmd.status AS command_status, cmd.hold_reason AS command_hold_reason,
              cmd.created_at AS command_created_at,
              -- ความเคลื่อนไหวล่าสุดของรายการ ใช้บอกว่าเครื่องนิ่งพอจะอัปเดตหรือยัง
              (SELECT MAX(GREATEST(t.created_at, t.updated_at)) FROM transactions t WHERE t.device_id = d.id)
                AS last_tx_activity
       FROM devices d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN device_commands cmd
              ON cmd.id = (SELECT id FROM device_commands
                            WHERE device_id = d.id AND command = 'force_update'
                              AND status IN ('pending','dispatched')
                            ORDER BY id ASC LIMIT 1)
       ORDER BY d.id DESC`
    );

    // เวอร์ชันล่าสุดที่ปล่อยไว้ ใช้ให้หน้าเว็บบอกได้ว่าเครื่องไหนตกรุ่น
    const [relRows] = await pool.query('SELECT version FROM firmware_releases ORDER BY id DESC LIMIT 1');
    const latestVersion = (relRows as any[])[0]?.version || null;

    return res.json({
      success: true,
      devices: rows,
      latest_firmware: latestVersion,
      quiet_period_minutes: QUIET_PERIOD_MINUTES,
    });
  }

  if (resource === 'customers') {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.email, c.is_active, c.created_at, c.fee_tier, c.fee_percent, c.flat_fee_amount,
              c.totp_enabled, c.payout_bank, c.payout_account_no, c.payout_account_name,
              (SELECT COUNT(*) FROM devices WHERE customer_id = c.id) AS device_count,
              (SELECT COALESCE(SUM(t.fee_amount), 0) FROM transactions t
                  JOIN devices d ON d.id = t.device_id
                  WHERE d.customer_id = c.id AND t.status = 'succeeded') AS fee_collected
       FROM customers c ORDER BY c.id DESC`
    );
    // ส่งต้นทุนของผู้ให้บริการไปด้วย เพื่อให้หน้าเว็บบอกได้ว่าอัตราที่กรอกเหลือกำไรสุทธิเท่าไหร่
    // แทนที่จะให้แอดมินคิดเลขในหัวแล้วพลาดแบบเดียวกับที่เคยตั้ง 1% ไว้ทั้งที่ต้นทุน 1.77%
    return res.json({ success: true, customers: rows, provider_fee_percent: config.providerFeePercent });
  }

  if (resource === 'settlements') {
    // ยอดค้างโอน แยกรายลูกค้า — พร้อมข้อมูลบัญชีปลายทางเพื่อให้แอดมินโอนได้เลยไม่ต้องไปเปิดหน้าอื่น
    const [pending] = await pool.query(
      `SELECT d.customer_id, c.name AS customer_name, c.email AS customer_email,
              c.payout_bank, c.payout_account_no, c.payout_account_name,
              COUNT(*) AS tx_count,
              COALESCE(SUM(t.amount),0) AS total_amount, COALESCE(SUM(t.fee_amount),0) AS total_fee,
              COALESCE(SUM(t.net_amount),0) AS total_net,
              MIN(t.created_at) AS oldest_tx, MAX(t.created_at) AS newest_tx
       FROM transactions t
       JOIN devices d ON d.id = t.device_id
       JOIN customers c ON c.id = d.customer_id
       WHERE t.status = 'succeeded' AND t.settlement_id IS NULL
       GROUP BY d.customer_id
       ORDER BY total_net DESC`
    );

    // แตกยอดค้างลงถึงระดับ "เครื่องไหนบ้าง" — คำถามแรกที่แอดมินถามเสมอเวลาจะโอน
    const [pendingDevices] = await pool.query(
      `SELECT d.customer_id, d.id AS device_id, d.name AS device_name, d.shop_name,
              COUNT(*) AS tx_count,
              COALESCE(SUM(t.amount),0) AS total_amount,
              COALESCE(SUM(t.fee_amount),0) AS total_fee,
              COALESCE(SUM(t.net_amount),0) AS total_net
       FROM transactions t
       JOIN devices d ON d.id = t.device_id
       WHERE t.status = 'succeeded' AND t.settlement_id IS NULL AND d.customer_id IS NOT NULL
       GROUP BY d.customer_id, d.id
       ORDER BY total_net DESC`
    );

    const [history] = await pool.query(
      `SELECT s.id, s.customer_id, c.name AS customer_name,
              c.payout_bank, c.payout_account_no, c.payout_account_name,
              s.tx_count, s.total_amount, s.total_fee,
              s.total_net, s.status, s.proof_reference, s.proof_file, s.note, s.settled_at, s.created_at
       FROM settlements s JOIN customers c ON c.id = s.customer_id
       ORDER BY s.id DESC`
    );

    // เครื่องที่อยู่ในแต่ละรอบที่ปิดไปแล้ว — ให้ย้อนดูได้ว่ารอบนั้นมาจากเครื่องไหน
    const [historyDevices] = await pool.query(
      `SELECT t.settlement_id, d.id AS device_id, d.name AS device_name, d.shop_name,
              COUNT(*) AS tx_count, COALESCE(SUM(t.net_amount),0) AS total_net
       FROM transactions t
       JOIN devices d ON d.id = t.device_id
       WHERE t.settlement_id IS NOT NULL
       GROUP BY t.settlement_id, d.id`
    );

    return res.json({ success: true, pending, pending_devices: pendingDevices, history, history_devices: historyDevices });
  }

  // ---- topology: ลูกค้า → เครื่อง พร้อมยอดเงินสามชั้น (วันนี้ / โอนแล้ว / ค้างโอน) ----
  if (resource === 'topology') {
    const [rows] = await pool.query(
      `SELECT d.id, d.name, d.shop_name, d.is_active, d.last_seen_at, d.firmware_version, d.lat, d.lng,
              d.province, d.region_zone,
              d.customer_id, c.name AS customer_name,
              COALESCE(today.amount, 0)      AS today_amount,
              COALESCE(today.tx, 0)          AS today_tx,
              COALESCE(paid.net, 0)          AS settled_net,
              COALESCE(waiting.net, 0)       AS pending_net,
              COALESCE(waiting.tx, 0)        AS pending_tx
       FROM devices d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN (
         SELECT device_id, SUM(amount) AS amount, COUNT(*) AS tx
         FROM transactions
         WHERE status = 'succeeded' AND DATE(created_at) = CURDATE()
         GROUP BY device_id
       ) today ON today.device_id = d.id
       LEFT JOIN (
         SELECT device_id, SUM(net_amount) AS net
         FROM transactions
         WHERE status = 'succeeded' AND settlement_id IS NOT NULL
         GROUP BY device_id
       ) paid ON paid.device_id = d.id
       LEFT JOIN (
         SELECT device_id, SUM(net_amount) AS net, COUNT(*) AS tx
         FROM transactions
         WHERE status = 'succeeded' AND settlement_id IS NULL
         GROUP BY device_id
       ) waiting ON waiting.device_id = d.id
       ORDER BY d.customer_id IS NULL, c.name, d.id`
    );

    return res.json({ success: true, devices: rows, server_time: new Date().toISOString() });
  }

  if (resource === 'releases') {
    const [rows] = await pool.query(
      'SELECT id, version, filename, notes, uploaded_at FROM firmware_releases ORDER BY id DESC'
    );
    return res.json({ success: true, releases: rows });
  }

  if (resource === 'summary') {
    const today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from as string) ? (req.query.from as string) : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to as string) ? (req.query.to as string) : today;

    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(fee_amount),0) AS total_fee,
              COALESCE(SUM(stripe_fee_amount),0) AS total_stripe_fee, COALESCE(SUM(profit_amount),0) AS total_profit,
              COALESCE(SUM(net_amount),0) AS total_net
       FROM transactions WHERE status = 'succeeded' AND DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );
    const [deviceCountRows] = await pool.query('SELECT COUNT(*) AS total, SUM(is_active) AS active FROM devices');
    const [customerCountRows] = await pool.query('SELECT COUNT(*) AS total FROM customers');
    const [pendingSettleRows] = await pool.query(
      `SELECT COUNT(DISTINCT d.customer_id) AS customers_pending
       FROM transactions t JOIN devices d ON d.id = t.device_id
       WHERE t.status = 'succeeded' AND t.settlement_id IS NULL AND d.customer_id IS NOT NULL`
    );

    return res.json({
      success: true,
      from,
      to,
      summary: (summaryRows as any[])[0],
      device_count: Number((deviceCountRows as any[])[0].total),
      device_active_count: Number((deviceCountRows as any[])[0].active),
      customer_count: Number((customerCountRows as any[])[0].total),
      customers_pending_settlement: Number((pendingSettleRows as any[])[0].customers_pending),
    });
  }

  res.status(400).json({ success: false, error: 'unknown_resource' });
});

// ---- Firmware upload (แยก endpoint จาก action=upload_firmware เดิมเพราะต้องรับไฟล์ .bin) ----
const firmwareUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
adminRouter.post('/upload_firmware', firmwareUpload.single('firmware_bin'), async (req, res) => {
  const version = (req.body.fw_version || '').trim();
  const notes = (req.body.fw_notes || '').trim() || null;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return res.json({ success: false, error: 'invalid_version_format' });
  }
  if (!req.file) {
    return res.json({ success: false, error: 'upload_failed' });
  }
  if (path.extname(req.file.originalname).toLowerCase() !== '.bin') {
    return res.json({ success: false, error: 'invalid_extension' });
  }

  const filename = `paybox-${version}.bin`;
  const firmwareDir = path.join(config.uploadsDir, 'firmware');
  fs.mkdirSync(firmwareDir, { recursive: true });
  fs.writeFileSync(path.join(firmwareDir, filename), req.file.buffer);

  try {
    await pool.query('INSERT INTO firmware_releases (version, filename, notes) VALUES (?, ?, ?)', [
      version,
      filename,
      notes,
    ]);
    res.json({ success: true });
  } catch {
    fs.unlinkSync(path.join(firmwareDir, filename));
    res.json({ success: false, error: 'version_exists_or_db_error' });
  }
});
