// JSON API สำหรับ customer portal (paybox-control React app โหมด customer) — ทดแทน
// customer_login.php, customer_devices.php, customer_transactions.php, customer_settlements.php เดิม
import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { pool } from '../db';
import { config } from '../config';
import { requireCustomer, CustomerRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { transcodeVideoToMjpeg, VideoBannerError, BANNER_SCREEN_W, BANNER_SCREEN_H } from '../lib/videoBanner';
import { checkTotp } from './customerAccount';
import { toCsv, sendCsv, thaiDateTime } from '../lib/csv';

export const customerRouter = Router();

customerRouter.post('/login', bucketLimiter('customer_login', 10, 60_000), async (req, res) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'missing_credentials' });
  }

  const [rows] = await pool.query(
    'SELECT id, password_hash, is_active, totp_enabled, totp_secret FROM customers WHERE email = ? LIMIT 1',
    [email]
  );
  const customer = (rows as any[])[0];

  const bcrypt = await import('bcryptjs');
  const valid = customer ? await bcrypt.compare(password, customer.password_hash) : false;

  if (!customer || !valid || Number(customer.is_active) !== 1) {
    return res.status(401).json({ success: false, error: 'invalid_credentials' });
  }

  // ถ้าเปิด 2FA ไว้ ต้องผ่านรหัส 6 หลักก่อนถึงจะออก session ให้
  // รอบแรกที่ยังไม่ส่ง otp มา ตอบ otp_required กลับไปให้หน้าเว็บขึ้นช่องกรอก
  if (Number(customer.totp_enabled) === 1) {
    const otp = String(req.body.otp || '').replace(/\s/g, '');
    if (!otp) {
      return res.status(401).json({ success: false, error: 'otp_required' });
    }
    if (!checkTotp(otp, customer.totp_secret)) {
      return res.status(401).json({ success: false, error: 'invalid_otp' });
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO customer_sessions (customer_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [customer.id, token]
  );

  res.json({ success: true, token });
});

customerRouter.get('/devices', bucketLimiter('customer_devices'), requireCustomer, async (req: CustomerRequest, res) => {
  const [feeRows] = await pool.query(
    `SELECT fee_tier, fee_percent, flat_fee_amount
     FROM customers WHERE id = ? LIMIT 1`,
    [req.customer!.id]
  );
  const feeInfoRow = (feeRows as any[])[0];

  const [deviceRows] = await pool.query(
    `SELECT id, name, shop_name, is_active, firmware_version, created_at, last_seen_at
     FROM devices WHERE customer_id = ? ORDER BY id DESC`,
    [req.customer!.id]
  );

  const devices = [];
  for (const d of deviceRows as any[]) {
    const [sumRows] = await pool.query(
      `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount), 0) AS total_amount,
              COALESCE(SUM(fee_amount), 0) AS total_fee, COALESCE(SUM(net_amount), 0) AS total_net
       FROM transactions WHERE device_id = ? AND status = 'succeeded'`,
      [d.id]
    );
    const sum = (sumRows as any[])[0];
    devices.push({
      id: d.id,
      name: d.name,
      shop_name: d.shop_name,
      is_active: Boolean(d.is_active),
      firmware_version: d.firmware_version,
      last_seen_at: d.last_seen_at,
      total_transactions: Number(sum.tx_count),
      tx_count: Number(sum.tx_count),
      total_amount: Number(sum.total_amount),
      total_fee: Number(sum.total_fee),
      total_net: Number(sum.total_net),
    });
  }

  const billing = feeInfoRow
    ? {
        fee_tier: feeInfoRow.fee_tier,
        fee_percent: Number(feeInfoRow.fee_percent),
        flat_fee_amount: Number(feeInfoRow.flat_fee_amount),
      }
    : null;

  res.json({
    success: true,
    customer: { name: req.customer!.name, email: req.customer!.email },
    billing,
    // ชื่อ fee_info เป็นของเดิมที่หน้าเว็บใช้อยู่ ไม่เปลี่ยนเพื่อไม่ให้ต้องแก้หลายที่โดยไม่จำเป็น
    fee_info: billing,
    devices,
  });
});

// ---- วันที่ตามเวลาไทย ----
// ทุก container รันบน UTC และ MySQL เก็บเวลาเป็น UTC แต่ผู้ใช้ทั้งหมดอยู่ไทย (+7) การจัดกลุ่ม
// ด้วย DATE(created_at) ตรงๆ จึงผลักรายการที่เกิดช่วง 00:00–07:00 ตามเวลาไทยไปอยู่ในถังของ
// "เมื่อวาน" — ตรวจกับข้อมูลจริงแล้วพบว่ากระทบ 2 จาก 10 รายการที่สำเร็จ
//
// ใช้ DATE_ADD แทน CONVERT_TZ เพราะไม่ต้องพึ่งตาราง timezone ของ MySQL ที่อาจไม่ได้ถูกโหลด
// และประเทศไทยไม่มี DST ออฟเซ็ต +7 จึงคงที่ตลอดปี ไม่มีเคสขอบให้พลาด
const THAI_OFFSET_HOURS = 7;
const thaiDate = (col: string) => `DATE(DATE_ADD(${col}, INTERVAL ${THAI_OFFSET_HOURS} HOUR))`;

/** อ่านช่วงวันที่จาก query — รับเฉพาะรูปแบบ YYYY-MM-DD เท่านั้น ค่าอื่นถือว่าไม่ได้ส่งมา */
function readRange(req: CustomerRequest): { from: string; to: string } {
  const ok = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const to = ok(req.query.to) || new Date(Date.now() + THAI_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
  const fromDefault = new Date(Date.now() + THAI_OFFSET_HOURS * 3600_000 - 29 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const from = ok(req.query.from) || fromDefault;
  return from <= to ? { from, to } : { from: to, to: from };
}

customerRouter.get(
  '/transactions',
  bucketLimiter('customer_transactions'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    let limit = parseInt((req.query.limit as string) || '50', 10);
    if (!limit || limit <= 0 || limit > 200) limit = 50;
    const beforeId = parseInt((req.query.before_id as string) || '0', 10);
    const deviceIdFilter = parseInt((req.query.device_id as string) || '0', 10);
    const statusFilter = String(req.query.status || '').trim();
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : null;
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : null;

    let sql = `SELECT t.id, t.device_id, d.name AS device_name, t.payment_intent_id, t.amount, t.currency,
                      t.status, t.fee_amount, t.fee_tier_snapshot, t.net_amount, t.created_at, t.updated_at
               FROM transactions t
               JOIN devices d ON d.id = t.device_id
               WHERE d.customer_id = ?`;
    const params: any[] = [req.customer!.id];

    if (deviceIdFilter > 0) {
      sql += ' AND t.device_id = ?';
      params.push(deviceIdFilter);
    }
    if (statusFilter) {
      sql += ' AND t.status = ?';
      params.push(statusFilter);
    }
    if (dateFrom) {
      sql += ` AND ${thaiDate('t.created_at')} >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND ${thaiDate('t.created_at')} <= ?`;
      params.push(dateTo);
    }
    if (beforeId > 0) {
      sql += ' AND t.id < ?';
      params.push(beforeId);
    }
    sql += ' ORDER BY t.id DESC LIMIT ' + limit;

    const [rows] = await pool.query(sql, params);
    const transactions = (rows as any[]).map((r) => ({
      id: r.id,
      device_id: r.device_id,
      device_name: r.device_name,
      payment_intent_id: r.payment_intent_id,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      fee_amount: Number(r.fee_amount),
      fee_tier: r.fee_tier_snapshot,
      net_amount: Number(r.net_amount),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    res.json({ success: true, transactions, has_more: transactions.length >= limit });
  }
);

// ---- ดาวน์โหลด CSV ----
// ส่งออกตามตัวกรองเดียวกับหน้าเว็บ แต่ไม่จำกัดหน้า (เพดาน 10,000 แถวกันดึงทั้งฐานข้อมูลพลาด)
// มีไว้ให้ร้านค้าเอาไปทำบัญชี/ยื่นภาษี ซึ่งเป็นเหตุผลหลักที่ต้องมีตัวเลขครบไม่ใช่แค่หน้าแรก
const CSV_MAX_ROWS = 10_000;

customerRouter.get(
  '/transactions.csv',
  bucketLimiter('customer_export', 10, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const deviceIdFilter = parseInt((req.query.device_id as string) || '0', 10);
    const statusFilter = String(req.query.status || '').trim();
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : null;
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : null;

    let sql = `SELECT t.id, t.created_at, d.name AS device_name, d.shop_name, t.payment_intent_id,
                      t.amount, t.fee_amount, t.net_amount, t.status, t.fee_tier_snapshot, t.settlement_id
               FROM transactions t JOIN devices d ON d.id = t.device_id
               WHERE d.customer_id = ?`;
    const params: any[] = [req.customer!.id];
    if (deviceIdFilter > 0) {
      sql += ' AND t.device_id = ?';
      params.push(deviceIdFilter);
    }
    if (statusFilter) {
      sql += ' AND t.status = ?';
      params.push(statusFilter);
    }
    if (dateFrom) {
      sql += ` AND ${thaiDate('t.created_at')} >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND ${thaiDate('t.created_at')} <= ?`;
      params.push(dateTo);
    }
    sql += ` ORDER BY t.id DESC LIMIT ${CSV_MAX_ROWS}`;

    const [rows] = await pool.query(sql, params);
    const csv = toCsv(
      ['เลขที่รายการ', 'วันที่-เวลา', 'เครื่อง', 'ชื่อร้าน', 'รหัสอ้างอิง Stripe', 'ยอดชำระ', 'ค่าธรรมเนียม', 'ยอดสุทธิ', 'สถานะ', 'รูปแบบค่าธรรมเนียม', 'รอบโอนที่'],
      (rows as any[]).map((r) => [
        r.id,
        thaiDateTime(r.created_at),
        r.device_name,
        r.shop_name || '',
        r.payment_intent_id,
        Number(r.amount).toFixed(2),
        Number(r.fee_amount).toFixed(2),
        Number(r.net_amount).toFixed(2),
        r.status,
        r.fee_tier_snapshot || '',
        r.settlement_id ?? '',
      ])
    );
    sendCsv(res, `paybox-transactions-${dateFrom || 'all'}-${dateTo || 'all'}.csv`, csv);
  }
);

customerRouter.get(
  '/settlements.csv',
  bucketLimiter('customer_export', 10, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const [rows] = await pool.query(
      `SELECT id, created_at, settled_at, tx_count, total_amount, total_fee, total_net, status, proof_reference, note
       FROM settlements WHERE customer_id = ? ORDER BY id DESC LIMIT ${CSV_MAX_ROWS}`,
      [req.customer!.id]
    );
    const csv = toCsv(
      ['รอบที่', 'วันที่สร้าง', 'วันที่โอน', 'จำนวนรายการ', 'ยอดรวม', 'ค่าธรรมเนียม', 'รับโอนสุทธิ', 'สถานะ', 'อ้างอิงการโอน', 'หมายเหตุ'],
      (rows as any[]).map((r) => [
        r.id,
        thaiDateTime(r.created_at),
        thaiDateTime(r.settled_at),
        r.tx_count,
        Number(r.total_amount).toFixed(2),
        Number(r.total_fee).toFixed(2),
        Number(r.total_net).toFixed(2),
        r.status,
        r.proof_reference || '',
        r.note || '',
      ])
    );
    sendCsv(res, 'paybox-settlements.csv', csv);
  }
);

// ---- สรุปยอดพร้อมมิติเวลา ----
// เดิมหน้าภาพรวมของร้านค้ามีแต่ยอดสะสมตลอดกาล ตอบไม่ได้ว่าวันนี้ขายได้เท่าไหร่ หรือเดือนนี้โตขึ้นไหม
// และไม่มีตัวเลข "เงินที่ยังรอรับโอน" ซึ่งเป็นตัวเลขที่เจ้าของร้านสนใจที่สุด
customerRouter.get('/summary', bucketLimiter('customer_summary'), requireCustomer, async (req: CustomerRequest, res) => {
  const cid = req.customer!.id;
  const { from, to } = readRange(req);

  // 1) ยอดรอรับโอน — ไม่ผูกกับช่วงเวลาที่เลือก เพราะเป็นยอดค้างสะสมที่เรายังไม่ได้โอนให้
  const [pendingRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(t.net_amount),0) AS net,
            MIN(t.created_at) AS oldest_tx
     FROM transactions t JOIN devices d ON d.id = t.device_id
     WHERE d.customer_id = ? AND t.status = 'succeeded' AND t.settlement_id IS NULL`,
    [cid]
  );
  const pending = (pendingRows as any[])[0];

  // 2) ยอดสะสมตลอดกาล (คงไว้เพื่อให้หน้าเดิมยังมีบริบท)
  const [allRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(t.amount),0) AS amount,
            COALESCE(SUM(t.fee_amount),0) AS fee, COALESCE(SUM(t.net_amount),0) AS net
     FROM transactions t JOIN devices d ON d.id = t.device_id
     WHERE d.customer_id = ? AND t.status = 'succeeded'`,
    [cid]
  );

  // 3) สรุปเฉพาะช่วงที่เลือก
  const [periodRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(t.amount),0) AS amount,
            COALESCE(SUM(t.fee_amount),0) AS fee, COALESCE(SUM(t.net_amount),0) AS net
     FROM transactions t JOIN devices d ON d.id = t.device_id
     WHERE d.customer_id = ? AND t.status = 'succeeded'
       AND ${thaiDate('t.created_at')} BETWEEN ? AND ?`,
    [cid, from, to]
  );

  // 4) วันนี้ (ตามเวลาไทย) — ตัวเลขที่ร้านค้าเปิดดูบ่อยที่สุด
  const [todayRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(t.amount),0) AS amount, COALESCE(SUM(t.net_amount),0) AS net
     FROM transactions t JOIN devices d ON d.id = t.device_id
     WHERE d.customer_id = ? AND t.status = 'succeeded'
       AND ${thaiDate('t.created_at')} = ${thaiDate('NOW()')}`,
    [cid]
  );

  // 5) ชุดข้อมูลรายวันสำหรับกราฟ
  const [dailyRows] = await pool.query(
    `SELECT ${thaiDate('t.created_at')} AS day, COUNT(*) AS tx_count,
            COALESCE(SUM(t.amount),0) AS amount, COALESCE(SUM(t.net_amount),0) AS net
     FROM transactions t JOIN devices d ON d.id = t.device_id
     WHERE d.customer_id = ? AND t.status = 'succeeded'
       AND ${thaiDate('t.created_at')} BETWEEN ? AND ?
     GROUP BY day ORDER BY day ASC`,
    [cid, from, to]
  );

  // mysql2 คืนคอลัมน์ชนิด DATE มาเป็น Date object ไม่ใช่สตริง — String(date) ได้ "Fri Aug 07 2026 …"
  // ซึ่ง slice(0,10) แล้วกลายเป็น "Fri Aug 07" ไม่มีทางตรงกับคีย์ ISO ที่ใช้ค้น (เจอตอนทดสอบจริง:
  // กราฟขึ้นศูนย์ทั้งแผงทั้งที่ในช่วงมี 8 รายการ) จึงต้องอ่านค่าจากส่วนประกอบของ Date ตรงๆ
  const dayKey = (v: unknown): string => {
    if (v instanceof Date) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v).slice(0, 10);
  };

  // เติมวันที่ไม่มียอดขายให้ครบ — ถ้าปล่อยให้ขาด แกนเวลาบนกราฟจะถูกบีบให้ชิดกันและอ่านผิดว่า
  // ขายได้ทุกวันติดกัน ทั้งที่จริงเว้นไปหลายวัน
  const byDay = new Map<string, any>();
  for (const r of dailyRows as any[]) {
    byDay.set(dayKey(r.day), r);
  }
  const daily: any[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    daily.push({
      day: key,
      tx_count: Number(hit?.tx_count ?? 0),
      amount: Number(hit?.amount ?? 0),
      net: Number(hit?.net ?? 0),
    });
  }

  // 6) แยกรายเครื่องเฉพาะช่วงที่เลือก
  const [deviceRows] = await pool.query(
    `SELECT d.id, d.name, d.shop_name, d.is_active, d.last_seen_at,
            COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.amount),0) AS amount,
            COALESCE(SUM(t.fee_amount),0) AS fee,
            COALESCE(SUM(t.net_amount),0) AS net
     FROM devices d
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded'
       AND ${thaiDate('t.created_at')} BETWEEN ? AND ?
     WHERE d.customer_id = ?
     GROUP BY d.id ORDER BY net DESC, d.id ASC`,
    [from, to, cid]
  );

  const num = (row: any, k: string) => Number(row?.[k] ?? 0);
  const all = (allRows as any[])[0];
  const period = (periodRows as any[])[0];
  const today = (todayRows as any[])[0];

  res.json({
    success: true,
    range: { from, to },
    pending_payout: {
      tx_count: num(pending, 'tx_count'),
      net: num(pending, 'net'),
      oldest_tx: pending?.oldest_tx ?? null,
    },
    today: { tx_count: num(today, 'tx_count'), amount: num(today, 'amount'), net: num(today, 'net') },
    period: {
      tx_count: num(period, 'tx_count'),
      amount: num(period, 'amount'),
      fee: num(period, 'fee'),
      net: num(period, 'net'),
    },
    all_time: {
      tx_count: num(all, 'tx_count'),
      amount: num(all, 'amount'),
      fee: num(all, 'fee'),
      net: num(all, 'net'),
    },
    daily,
    devices: (deviceRows as any[]).map((d) => ({
      id: d.id,
      name: d.name,
      shop_name: d.shop_name,
      is_active: Number(d.is_active),
      last_seen_at: d.last_seen_at,
      tx_count: Number(d.tx_count),
      amount: Number(d.amount),
      fee: Number(d.fee),
      net: Number(d.net),
    })),
  });
});

customerRouter.get(
  '/settlements',
  bucketLimiter('customer_settlements'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const [rows] = await pool.query(
      `SELECT id, tx_count, total_amount, total_fee, total_net, status, proof_reference, proof_file, note,
              settled_at, created_at
       FROM settlements WHERE customer_id = ? ORDER BY id DESC`,
      [req.customer!.id]
    );

    const settlements = (rows as any[]).map((r) => ({
      id: r.id,
      tx_count: r.tx_count,
      total_amount: Number(r.total_amount),
      total_fee: Number(r.total_fee),
      total_net: Number(r.total_net),
      status: r.status,
      proof_reference: r.proof_reference,
      // เหตุผลที่รอบนี้ติดปัญหา (เช่น เลขบัญชีผิด ธนาคารตีกลับ) — ต้องส่งให้ลูกค้าเห็นด้วย
      // ไม่ใช่แค่แอดมิน เพราะคนที่แก้เลขบัญชีได้คือลูกค้าเอง
      note: r.note,
      proof_url: r.proof_file
        ? `${config.publicBaseUrl}/files/settlement-proofs/${encodeURIComponent(r.proof_file)}`
        : null,
      settled_at: r.settled_at,
      created_at: r.created_at,
    }));

    res.json({ success: true, settlements });
  }
);

// ---- Banner (สไลด์ตอน idle) ของเครื่องที่ลูกค้าเป็นเจ้าของ ----
// ลูกค้าจัดการ banner เองได้เต็มที่ (แทนที่แอดมิน) เฉพาะเครื่องที่ตัวเองเป็นเจ้าของเท่านั้น
//
// หมายเหตุ: เคยมีฟีเจอร์ "theme" (สี/พื้นหลังของหน้า payment screen) อยู่คู่กับส่วนนี้ แต่ firmware
// ไม่เคยอ่านค่าไปใช้เลย จึงถูกถอดออกทั้งหมด — banner เป็นคนละเรื่องและยังใช้งานจริงอยู่
const MAX_BANNER_SLOTS = 5;

async function loadOwnedDevice(deviceId: number, customerId: number) {
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ? AND customer_id = ? LIMIT 1', [
    deviceId,
    customerId,
  ]);
  return (rows as any[])[0] || null;
}

customerRouter.get(
  '/devices/:deviceId/banner',
  bucketLimiter('customer_banner'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const device = await loadOwnedDevice(Number(req.params.deviceId), req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });

    const slots = [];
    for (let i = 1; i <= MAX_BANNER_SLOTS; i++) {
      slots.push({
        slot: i,
        url: device[`banner_url_${i}`] || null,
        type: device[`banner_type_${i}`] || 'image',
        fps: device[`banner_fps_${i}`] ?? 8,
        version: device[`banner_version_${i}`] ?? 1,
      });
    }
    res.json({ success: true, banner_idle_sec: device.banner_idle_sec ?? 20, slots });
  }
);

// ---- สั่งรีสตาร์ตเครื่องของตัวเอง ----
// ร้านค้ามักเจอเครื่องค้างนอกเวลาทำการของผู้ดูแลระบบ การต้องรอแอดมินมากดให้จึงเสียโอกาสขาย
// จำกัดเฉพาะเครื่องที่ตัวเองเป็นเจ้าของเท่านั้น (loadOwnedDevice ตรวจ customer_id ให้อยู่แล้ว)
customerRouter.post(
  '/devices/:deviceId/restart',
  bucketLimiter('customer_restart', 6, 60_000),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const device = await loadOwnedDevice(Number(req.params.deviceId), req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });

    const [existing] = await pool.query(
      "SELECT id FROM device_commands WHERE device_id = ? AND command = 'restart' AND status IN ('pending','dispatched') LIMIT 1",
      [device.id]
    );
    if ((existing as any[]).length > 0) {
      return res.json({ success: true, already_queued: true });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command, status, requested_by_username)
       VALUES (?, 'restart', 'pending', ?)`,
      [device.id, `customer:${req.customer!.email}`]
    );
    res.json({ success: true, already_queued: false });
  }
);

customerRouter.post(
  '/devices/:deviceId/banner/idle',
  bucketLimiter('customer_banner'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const device = await loadOwnedDevice(Number(req.params.deviceId), req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });

    const idleSec = Math.max(5, parseInt(req.body.banner_idle_sec || '20', 10));
    await pool.query('UPDATE devices SET banner_idle_sec = ? WHERE id = ?', [idleSec, device.id]);
    res.json({ success: true });
  }
);

// บอร์ดแสดง banner บนแคนวาส 480x320 (landscape) จริง ไม่ใช่ 320x480 ตาม LCD_H_RES/V_RES ใน
// display.h (นั่นคือ resolution ดิบของจอ portrait ก่อน LVGL หมุนเป็น landscape) — เจอบั๊กจริงตอน
// ทดสอบว่าส่งรูป 320x480 ไปแล้วจอโชว์แคบตรงกลาง มีขอบขาวซ้ายขวา เพราะ banner_show_slide() ใน
// main.cpp ใช้ zoom แบบ "contain" (คงสัดส่วนเดิม ไม่ครอบตัด) ไปหา box 480x320 เสมอ — ค่าคงที่เดียวกัน
// ใช้ร่วมกับ videoBanner.ts (BANNER_SCREEN_W/H) เพื่อไม่ให้ hardcode ซ้ำสองที่
const bannerImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// รับรูปฟอร์แมตไหนก็ได้ (jpg/jpeg/png/webp) แต่ transcode เป็น PNG เสมอก่อนเซฟ — บอร์ดถอดรหัส banner
// รูปนิ่งได้แค่ PNG เท่านั้น (PNGdec) เจอบั๊กจริงตอนทดสอบว่าอัปโหลด .jpg แล้วบอร์ด error
// "openRAM failed, rc=6" (PNG_INVALID_FILE) เพราะเจอไบต์ JPEG ไม่ใช่ PNG
customerRouter.post(
  '/devices/:deviceId/banner/:slot/image',
  bucketLimiter('customer_banner', 20, 60_000),
  requireCustomer,
  bannerImageUpload.single('image'),
  async (req: CustomerRequest, res) => {
    const deviceId = Number(req.params.deviceId);
    const slot = Number(req.params.slot);
    if (slot < 1 || slot > MAX_BANNER_SLOTS) {
      return res.status(400).json({ success: false, error: 'invalid_slot' });
    }
    const device = await loadOwnedDevice(deviceId, req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'no_file' });

    const bgDir = path.join(config.uploadsDir, 'customer_backgrounds');
    fs.mkdirSync(bgDir, { recursive: true });
    const filename = `device_${deviceId}_banner_${slot}_${crypto.randomBytes(8).toString('hex')}.png`;
    const destPath = path.join(bgDir, filename);

    try {
      await sharp(req.file.buffer)
        .resize(BANNER_SCREEN_W, BANNER_SCREEN_H, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(destPath);
    } catch {
      return res.status(400).json({ success: false, error: 'invalid_image' });
    }

    const version = Number(device[`banner_version_${slot}`] || 1) + 1;
    const url = `${config.publicBaseUrl}/files/customer-backgrounds/${filename}?v=${version}`;
    await pool.query(
      `UPDATE devices SET banner_url_${slot} = ?, banner_type_${slot} = 'image', banner_version_${slot} = ? WHERE id = ?`,
      [url, version, deviceId]
    );

    res.json({ success: true, url });
  }
);

// รับวิดีโอฟอร์แมตทั่วไป (mp4/mov/webm ฯลฯ) ตรงๆ จากลูกค้า — แปลงเป็น .mjpeg ที่บอร์ดเล่นได้ทั้งหมด
// ฝั่งเซิร์ฟเวอร์ผ่าน ffmpeg (ดู lib/videoBanner.ts) ลูกค้าไม่ต้องแปลงไฟล์เองจากข้างนอก
// limit ไฟล์ดิบที่รับเข้ามาให้กว้างกว่าผลลัพธ์สุดท้าย เพราะยังไม่ได้บีบอัด (คลิปสั้น <20 วิ ต้นทางอาจ
// หลาย MB ได้ตามปกติ) — ตัวไฟล์ที่แปลงเสร็จแล้วถูกบังคับให้เล็กพอสำหรับบอร์ดเสมอโดย videoBanner.ts
const MAX_RAW_VIDEO_BYTES = 60 * 1024 * 1024;
const bannerVideoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RAW_VIDEO_BYTES } });

customerRouter.post(
  '/devices/:deviceId/banner/:slot/video',
  bucketLimiter('customer_banner', 10, 60_000),
  requireCustomer,
  bannerVideoUpload.single('video'),
  async (req: CustomerRequest, res) => {
    const deviceId = Number(req.params.deviceId);
    const slot = Number(req.params.slot);
    if (slot < 1 || slot > MAX_BANNER_SLOTS) {
      return res.status(400).json({ success: false, error: 'invalid_slot' });
    }
    const device = await loadOwnedDevice(deviceId, req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'no_file' });

    // ค่าเริ่มต้น/เพดาน fps มาจากการทดสอบจริงบนฮาร์ดแวร์ — SD การ์ดต่อแบบ 1-bit เท่านั้น (อ่านช้า)
    // เกิน ~4-6fps จะกระตุกชัดเจนเพราะ playback loop เป็นแบบ synchronous ไม่มี prefetch
    const fps = Math.max(2, Math.min(6, parseInt(req.body.fps || '4', 10)));

    let result;
    try {
      result = await transcodeVideoToMjpeg(req.file.buffer, req.file.originalname, { fps });
    } catch (err: any) {
      if (err instanceof VideoBannerError) {
        return res.status(400).json({ success: false, error: err.code, message: err.message });
      }
      console.error('Video banner transcode failed:', err);
      return res.status(500).json({ success: false, error: 'transcode_failed' });
    }

    const videoDir = path.join(config.uploadsDir, 'banner_videos');
    fs.mkdirSync(videoDir, { recursive: true });
    fs.writeFileSync(path.join(videoDir, `${deviceId}_${slot}.mjpeg`), result.buffer);

    const url = `${config.publicBaseUrl}/devices/banner-videos/${deviceId}_${slot}.mjpeg`;
    await pool.query(
      `UPDATE devices SET banner_url_${slot} = ?, banner_type_${slot} = 'video', banner_fps_${slot} = ?,
              banner_version_${slot} = banner_version_${slot} + 1
       WHERE id = ?`,
      [url, fps, deviceId]
    );

    res.json({ success: true, frame_count: result.frameCount });
  }
);

customerRouter.post(
  '/devices/:deviceId/banner/:slot/clear',
  bucketLimiter('customer_banner'),
  requireCustomer,
  async (req: CustomerRequest, res) => {
    const deviceId = Number(req.params.deviceId);
    const slot = Number(req.params.slot);
    if (slot < 1 || slot > MAX_BANNER_SLOTS) {
      return res.status(400).json({ success: false, error: 'invalid_slot' });
    }
    const device = await loadOwnedDevice(deviceId, req.customer!.id);
    if (!device) return res.status(404).json({ success: false, error: 'not_found' });

    await pool.query(`UPDATE devices SET banner_url_${slot} = NULL, banner_type_${slot} = 'image' WHERE id = ?`, [
      deviceId,
    ]);
    res.json({ success: true });
  }
);