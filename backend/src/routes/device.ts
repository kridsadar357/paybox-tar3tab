// Endpoint ที่ตัวเครื่อง PayBox จริงเรียกโดยตรง — ทดแทน gen_qrcode.php, check_status.php,
// device_config.php, provision_register.php, provision_status.php, firmware_check.php เดิม
// ต้องคง business logic เดิมทุกจุดให้ตรงเป๊ะ เพราะอุปกรณ์ที่ deploy ไปแล้วพึ่งพา contract นี้อยู่
import { Router } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { getProvider } from '../lib/providers';
import { requireDevice, DeviceRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { claimPendingCommands } from '../lib/deviceCommands';
import { compareVersions } from '../lib/version';
import { applyProviderStatus } from '../lib/transactionSync';

export const deviceRouter = Router();

// ---- gen_qrcode: pay_gen_qr ----
deviceRouter.get('/gen_qrcode', bucketLimiter('gen_qrcode'), requireDevice, async (req: DeviceRequest, res) => {
  const amountRaw = req.query.amount as string;
  if (!amountRaw || isNaN(Number(amountRaw))) {
    return res.json({ success: false, error: 'invalid_amount' });
  }
  const amount = parseFloat(amountRaw);
  if (amount <= 0 || amount > config.maxAmount) {
    return res.json({ success: false, error: 'amount_out_of_range' });
  }

  // ผู้ให้บริการถูกเลือกไว้ต่อเครื่อง ร้านคนละร้านอาจใช้คนละเจ้า
  const provider = getProvider(req.device!.payment_provider);

  let charge;
  try {
    charge = await provider.createCharge(amount, config.currency);
  } catch (err: any) {
    console.error(`gen_qrcode: ${provider.name} ล้มเหลว:`, err?.message);
    return res.json({ success: false, error: 'payment_provider_error', detail: err?.message });
  }

  // บันทึกชื่อผู้ให้บริการไว้กับรายการด้วย ถ้าเครื่องเปลี่ยนเจ้าทีหลัง รายการเก่าต้องยังถามสถานะถูกที่
  await pool.query(
    'INSERT INTO transactions (device_id, provider, payment_intent_id, amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.device!.id, provider.name, charge.ref, amount, config.currency, 'pending']
  );

  // รูปแบบคำตอบเหมือนเดิมทุกประการ เฟิร์มแวร์ที่ใช้อยู่จึงไม่ต้องแก้อะไรเลย
  res.json({ success: true, qrCodeRawData: charge.qrPayload, paymentIntentId: charge.ref });
});

// ---- check_status: pay_chk_stat ----
deviceRouter.get('/check_status', requireDevice, bucketLimiter('check_status'), async (req: DeviceRequest, res) => {
  const id = req.query.id as string;
  // ไม่ตรวจรูปแบบตายตัวตรงนี้แล้ว เพราะแต่ละผู้ให้บริการใช้รูปแบบรหัสของตัวเอง
  // ตรวจแบบกว้างๆ พอกันอักขระแปลก แล้วให้ provider ของรายการนั้นตรวจละเอียดอีกที
  if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.json({ success: false, error: 'invalid_id' });
  }

  const [rows] = await pool.query(
    'SELECT id, device_id, provider, status, amount, settlement_id FROM transactions WHERE payment_intent_id = ? AND device_id = ? LIMIT 1',
    [id, req.device!.id]
  );
  const txn = (rows as any[])[0];
  if (!txn) {
    return res.status(404).json({ success: false, error: 'not_found' });
  }

  // ใช้ผู้ให้บริการที่บันทึกไว้กับรายการ ไม่ใช่ของเครื่อง ณ ตอนนี้ — เครื่องอาจถูกเปลี่ยนเจ้าไปแล้ว
  const provider = getProvider(txn.provider);
  if (!provider.isValidRef(id)) {
    return res.json({ success: false, error: 'invalid_id' });
  }

  let statusResult;
  try {
    statusResult = await provider.getStatus(id);
  } catch (err: any) {
    console.error(`check_status: ${provider.name} ล้มเหลวสำหรับ ${id}:`, err?.message);
    return res.status(404).json({ success: false, error: 'not_found' });
  }

  const status = statusResult.status;

  // ตรรกะคิดค่าธรรมเนียม/สุทธิอยู่ที่ lib/transactionSync.ts ที่เดียว ใช้ร่วมกับ webhook และงาน
  // ตามเก็บรายการค้าง — ถ้าปล่อยให้แต่ละทางคำนวณเองจะเพี้ยนจากกันเมื่อไหร่ก็ได้
  await applyProviderStatus(txn, statusResult);

  res.json({ success: true, status });
});

// ---- device_config: ตั้งค่าทั้งหมดที่แอดมินตั้งไว้ ----
deviceRouter.get('/device_config', bucketLimiter('device_config'), requireDevice, async (req: DeviceRequest, res) => {
  const [rows] = await pool.query(
    `SELECT shop_name, entry_method, preset_amounts, fixed_amount, op_mode, pulse_pin, pulse_baht_inc,
            ty_api, ty_msg, pay_inc, pay_ty_msg,
            banner_url_1, banner_url_2, banner_url_3, banner_url_4, banner_url_5, banner_idle_sec,
            banner_type_1, banner_type_2, banner_type_3, banner_type_4, banner_type_5,
            banner_fps_1, banner_fps_2, banner_fps_3, banner_fps_4, banner_fps_5,
            banner_version_1, banner_version_2, banner_version_3, banner_version_4, banner_version_5
     FROM devices WHERE id = ? LIMIT 1`,
    [req.device!.id]
  );
  const row = (rows as any[])[0];
  if (!row) {
    return res.status(404).json({ success: false, error: 'not_found' });
  }

  const presets = (row.preset_amounts || '')
    .split(',')
    .map((p: string) => parseInt(p.trim(), 10))
    .filter((v: number) => v > 0);

  res.json({
    success: true,
    shop_name: row.shop_name || '357 PAYBOX',
    entry_method: ['button', 'fixed'].includes(row.entry_method) ? row.entry_method : 'keypad',
    preset_amounts: presets.length > 0 ? presets : [5, 10, 20, 50, 100, 500, 1000],
    fixed_amount: Number(row.fixed_amount || 0),
    op_mode: row.op_mode,
    pulse_pin: row.pulse_pin ?? 14,
    pulse_baht_inc: row.pulse_baht_inc,
    ty_api: row.ty_api || '',
    ty_msg: row.ty_msg || 'Thank You!',
    pay_inc: row.pay_inc,
    pay_ty_msg: row.pay_ty_msg || 'Payment Received!',
    banner_urls: [row.banner_url_1, row.banner_url_2, row.banner_url_3, row.banner_url_4, row.banner_url_5].map(
      (v) => v || ''
    ),
    banner_types: [1, 2, 3, 4, 5].map((i) => (row[`banner_type_${i}`] === 'video' ? 'video' : 'image')),
    banner_fps: [1, 2, 3, 4, 5].map((i) => row[`banner_fps_${i}`]),
    banner_frame_counts: [0, 0, 0, 0, 0],
    banner_versions: [1, 2, 3, 4, 5].map((i) => row[`banner_version_${i}`]),
    banner_idle_sec: row.banner_idle_sec || 20,
  });
});

// ---- provision_register: ลงทะเบียน/จำอุปกรณ์ด้วย MAC address ----
deviceRouter.get('/provision_register', bucketLimiter('provision_register'), async (req, res) => {
  const mac = (req.query.mac as string) || '';
  if (!/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac)) {
    return res.status(400).json({ error: 'invalid_mac' });
  }
  const macUpper = mac.toUpperCase();

  const [existingRows] = await pool.query(
    'SELECT device_key, is_active FROM devices WHERE mac_address = ? LIMIT 1',
    [macUpper]
  );
  const existing = (existingRows as any[])[0];
  if (existing) {
    return res.json({ code: existing.device_key, is_active: Boolean(existing.is_active) });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxRows] = await pool.query(
      "SELECT MAX(CAST(device_key AS UNSIGNED)) AS mx FROM devices WHERE device_key REGEXP '^[0-9]+$'"
    );
    const next = (Number((maxRows as any[])[0]?.mx) || 0) + 1;
    const code = String(next).padStart(8, '0');

    try {
      await pool.query('INSERT INTO devices (device_key, name, is_active, mac_address) VALUES (?, ?, 0, ?)', [
        code,
        `รอตั้งชื่อ (MAC: ${macUpper})`,
        macUpper,
      ]);
      return res.json({ code, is_active: false });
    } catch (e: any) {
      if (e.code !== 'ER_DUP_ENTRY') {
        console.error('provision_register: DB error:', e.message);
        return res.status(500).json({ error: 'server_error' });
      }
      const [raceRows] = await pool.query(
        'SELECT device_key, is_active FROM devices WHERE mac_address = ? LIMIT 1',
        [macUpper]
      );
      const race = (raceRows as any[])[0];
      if (race) {
        return res.json({ code: race.device_key, is_active: Boolean(race.is_active) });
      }
      // ชนที่ device_key ตัวเลข ลองรหัสถัดไปใหม่
    }
  }

  console.error(`provision_register: failed to allocate a device_key after retries for MAC ${macUpper}`);
  res.status(500).json({ error: 'server_error' });
});

// ---- provision_status: poll สถานะระหว่างรอแอดมินอนุมัติ ----
deviceRouter.get('/provision_status', bucketLimiter('provision_status'), async (req, res) => {
  const code = (req.query.code as string) || '';
  if (!/^\d{8}$/.test(code)) {
    return res.status(400).json({ error: 'invalid_code' });
  }
  const [rows] = await pool.query('SELECT is_active FROM devices WHERE device_key = ? LIMIT 1', [code]);
  const row = (rows as any[])[0];
  if (!row) {
    return res.json({ found: false, is_active: false });
  }
  res.json({ found: true, is_active: Boolean(row.is_active) });
});

// ---- firmware_check: ตรวจ OTA ----
deviceRouter.get('/firmware_check', bucketLimiter('firmware_check'), requireDevice, async (req: DeviceRequest, res) => {
  const currentVersion = (req.query.version as string) || '';
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) {
    return res.status(400).json({ update_available: false, error: 'invalid_version' });
  }

  await pool.query('UPDATE devices SET firmware_version = ? WHERE id = ?', [currentVersion, req.device!.id]);

  const [rows] = await pool.query(
    'SELECT version, filename FROM firmware_releases ORDER BY id DESC LIMIT 1'
  );
  const latest = (rows as any[])[0];
  if (!latest) {
    return res.json({ update_available: false });
  }

  if (compareVersions(latest.version, currentVersion) > 0) {
    return res.json({
      update_available: true,
      version: latest.version,
      url: `${config.publicBaseUrl}/devices/firmware/${latest.filename}`,
    });
  }
  res.json({ update_available: false });
});

// ---- Heartbeat ----
// ตัว middleware requireDevice อัปเดต last_seen_at ให้อยู่แล้วทุก request ที่ยืนยันตัวตนผ่าน
// endpoint นี้จึงไม่ต้องทำอะไรเพิ่ม นอกจากตอบสั้นที่สุดเท่าที่ทำได้
//
// ทำไมต้องมี: ก่อนหน้านี้บอร์ดเรียก backend เฉพาะตอนบูตกับตอนมีคนจ่ายเงิน last_seen_at จึงบอกได้แค่
// "ติดต่อล่าสุด" ไม่ใช่ "ออนไลน์อยู่" — เครื่องที่เสียบไฟทั้งวันแต่ไม่มีลูกค้าจะดูเหมือนหายไป
// firmware 1.3.0 ขึ้นไปเรียกทุก 5 นาที ทำให้ตอบได้จริงว่าเครื่องยังติดต่อได้อยู่หรือไม่
deviceRouter.get('/heartbeat', bucketLimiter('heartbeat', 60, 60_000), requireDevice, async (req: DeviceRequest, res) => {
  const version = (req.query.version as string) || '';
  // เก็บเวอร์ชันไปด้วยเลยระหว่างทาง จะได้ไม่ต้องรอรอบ OTA 6 ชั่วโมงกว่าจะรู้ว่าบอร์ดอัปเดตแล้ว
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    await pool.query('UPDATE devices SET firmware_version = ? WHERE id = ?', [version, req.device!.id]);
  }

  // นี่คือช่องทางเดียวที่ backend สั่งงานบอร์ดได้ — บอร์ดอยู่หลัง NAT เป็นฝ่ายเรียกเข้ามาอย่างเดียว
  // คำสั่งจะถูกปล่อยก็ต่อเมื่อเครื่องนิ่งพอ (ดูกติกาใน lib/deviceCommands.ts)
  let cmds = { checkUpdate: false, restart: false };
  try {
    cmds = await claimPendingCommands(req.device!.id, version);
  } catch (err) {
    // คิวคำสั่งมีปัญหาต้องไม่ทำให้ heartbeat ล้ม ไม่งั้นเครื่องจะดูเหมือนออฟไลน์ทั้งที่ปกติดี
    console.error('[heartbeat] อ่านคิวคำสั่งไม่สำเร็จ:', err);
  }

  res.json({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    check_update: cmds.checkUpdate,
    restart: cmds.restart,
  });
});

