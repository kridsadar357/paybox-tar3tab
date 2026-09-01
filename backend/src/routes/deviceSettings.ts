// ทดแทน device_settings.php (ตั้งค่าอุปกรณ์แบบละเอียด: ชื่อร้าน/Keypad-Button/pulse/thank you/banner/
// ที่ตั้งเครื่อง) และ device_banner_video.php (อัปโหลดวิดีโอ banner แบบไฟล์ .mjpeg เดียว)
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { config } from '../config';
import { requireAdmin } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';

export const deviceSettingsRouter = Router();
deviceSettingsRouter.use(bucketLimiter('device_settings', 60, 60_000));
deviceSettingsRouter.use(requireAdmin);

// GET ค่าปัจจุบันของอุปกรณ์หนึ่งตัว (ทุกคอลัมน์ที่ device_config.php ใช้ + ที่ตั้ง)
deviceSettingsRouter.get('/:deviceId', async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ? LIMIT 1', [deviceId]);
  const device = (rows as any[])[0];
  if (!device) {
    return res.status(404).json({ success: false, error: 'not_found' });
  }
  res.json({ success: true, device });
});

// POST บันทึกค่าตั้งค่าอุปกรณ์ (ตรงกับฟอร์มของ device_settings.php เดิม)
deviceSettingsRouter.post('/:deviceId', async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const body = req.body;

  const shopName = (body.shop_name || '').trim() || '357 PAYBOX';
  // fixed = ยอดเดียวตายตัวต่อการสแกน 1 รอบ (ตู้ขายของราคาเดียว) ไม่มีทางเลือกจำนวนเงินอื่น
  const entryMethod = ['button', 'fixed'].includes(body.entry_method) ? body.entry_method : 'keypad';

  // ยอดคงที่ต้องมากกว่า 0 เสมอเมื่อเลือกโหมดนี้ ไม่งั้นเครื่องจะสร้าง QR ยอด 0 ไม่ได้แล้วค้าง
  const fixedAmountRaw = parseFloat(body.fixed_amount || '0');
  const fixedAmount = isNaN(fixedAmountRaw) || fixedAmountRaw < 0 ? 0 : Math.min(fixedAmountRaw, 100000);
  if (entryMethod === 'fixed' && fixedAmount <= 0) {
    return res.status(400).json({ success: false, error: 'fixed_amount_required' });
  }

  const presets = String(body.preset_amounts || '')
    .split(',')
    .map((p: string) => parseInt(p.trim(), 10))
    .filter((v: number) => v > 0);
  const presetsStr = (presets.length > 0 ? presets : [5, 10, 20, 50, 100, 500, 1000]).join(',');

  const opModeMap: Record<string, number> = { pulse: 1, thankyou: 2, payment: 3 };
  const opMode = opModeMap[body.op_mode] || 3;

  const pulsePin = parseInt(body.pulse_pin || '14', 10);
  const pulseBahtInc = Math.max(0, parseInt(body.pulse_baht_inc || '0', 10));
  const tyApi = (body.ty_api || '').trim() || null;
  const tyMsg = (body.ty_msg || '').trim() || 'Thank You!';
  const payInc = Math.max(1, parseInt(body.pay_inc || '10', 10));
  const payTyMsg = (body.pay_ty_msg || '').trim() || 'Payment Received!';

  const bannerUrls: (string | null)[] = [];
  for (let i = 1; i <= 5; i++) {
    const v = (body[`banner_url_${i}`] || '').trim();
    bannerUrls.push(v || null);
  }
  const bannerIdleSec = Math.max(5, parseInt(body.banner_idle_sec || '20', 10));

  const regionZone = (body.region_zone || '').trim() || null;
  const province = (body.province || '').trim() || null;
  const district = (body.district || '').trim() || null;
  const subdistrict = (body.subdistrict || '').trim() || null;
  const lat = body.lat && !isNaN(parseFloat(body.lat)) ? parseFloat(body.lat) : null;
  const lng = body.lng && !isNaN(parseFloat(body.lng)) ? parseFloat(body.lng) : null;

  await pool.query(
    `UPDATE devices SET shop_name = ?, entry_method = ?, preset_amounts = ?, fixed_amount = ?, op_mode = ?,
            pulse_pin = ?, pulse_baht_inc = ?, ty_api = ?, ty_msg = ?, pay_inc = ?, pay_ty_msg = ?,
            banner_url_1 = ?, banner_url_2 = ?, banner_url_3 = ?, banner_url_4 = ?, banner_url_5 = ?,
            banner_idle_sec = ?, region_zone = ?, province = ?, district = ?, subdistrict = ?,
            lat = ?, lng = ?
     WHERE id = ?`,
    [
      shopName,
      entryMethod,
      presetsStr,
      fixedAmount,
      opMode,
      pulsePin,
      pulseBahtInc,
      tyApi,
      tyMsg,
      payInc,
      payTyMsg,
      ...bannerUrls,
      bannerIdleSec,
      regionZone,
      province,
      district,
      subdistrict,
      lat,
      lng,
      deviceId,
    ]
  );

  res.json({ success: true });
});

// ---- Video banner (.mjpeg ไฟล์เดียว) ----
const MAX_MJPEG_BYTES = 5 * 1024 * 1024;
const mjpegUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MJPEG_BYTES } });

deviceSettingsRouter.post(
  '/:deviceId/banner_video/:slot',
  mjpegUpload.single('mjpeg_file'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    const slot = Number(req.params.slot);
    if (slot < 1 || slot > 5) {
      return res.status(400).json({ success: false, error: 'invalid_slot' });
    }

    const action = req.body.action;
    if (action === 'revert_image') {
      await pool.query(`UPDATE devices SET banner_type_${slot} = 'image' WHERE id = ?`, [deviceId]);
      return res.json({ success: true });
    }

    const fps = Math.max(1, Math.min(15, parseInt(req.body.fps || '8', 10)));

    if (!req.file) {
      return res.json({ success: false, error: 'no_file' });
    }
    if (req.file.buffer[0] !== 0xff || req.file.buffer[1] !== 0xd8) {
      return res.json({ success: false, error: 'invalid_mjpeg' });
    }

    const videoDir = path.join(config.uploadsDir, 'banner_videos');
    fs.mkdirSync(videoDir, { recursive: true });
    const destPath = path.join(videoDir, `${deviceId}_${slot}.mjpeg`);
    fs.writeFileSync(destPath, req.file.buffer);

    const baseUrl = `${config.publicBaseUrl}/devices/banner-videos/${deviceId}_${slot}.mjpeg`;
    await pool.query(
      `UPDATE devices SET banner_url_${slot} = ?, banner_type_${slot} = 'video', banner_fps_${slot} = ?,
              banner_version_${slot} = banner_version_${slot} + 1
       WHERE id = ?`,
      [baseUrl, fps, deviceId]
    );

    res.json({ success: true });
  }
);
