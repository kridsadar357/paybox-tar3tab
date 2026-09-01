// ตั้งค่าช่องทางแจ้งเตือนจากหน้าแอดมิน
//
// token ที่บันทึกแล้วจะไม่ถูกส่งกลับออกไปทาง response อีกเลย — หน้าเว็บเห็นได้แค่ว่า "ตั้งไว้แล้ว"
// กับสี่ตัวท้าย พอให้ยืนยันว่าใส่ตัวไหนไว้ แต่ไม่พอให้เอาไปใช้ต่อถ้าหน้าจอถูกแอบดู
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAdmin, AdminRequest } from '../middleware/auth';
import { bucketLimiter } from '../middleware/rateLimit';
import { logAudit } from '../lib/audit';
import { config } from '../config';
import { ChannelKey, ChannelPatch, readStatus, readSecrets, saveChannel, clearChannel } from '../lib/alertConfig';
import { sendTest, discoverTelegramChats } from '../lib/alertSend';
import { readSources } from '../lib/lineSources';

export const alertsRouter = Router();

alertsRouter.use(requireAdmin);

const CHANNEL_NAME: Record<ChannelKey, string> = { telegram: 'Telegram', line: 'LINE' };

/** ต้องตรงกับที่ mount ไว้ใน server.ts — แสดงให้แอดมินคัดลอกไปวางใน LINE console */
const WEBHOOK_URL = () => `${config.publicBaseUrl}/api/line/webhook`;

function parseChannel(v: unknown): ChannelKey | null {
  return v === 'telegram' || v === 'line' ? v : null;
}

/**
 * ตรวจรูปแบบตั้งแต่ตอนกรอก แทนที่จะปล่อยให้รู้ตัวตอนที่ระบบล่มจริงแล้วไม่มีเสียงเตือน
 * ดักเฉพาะค่าที่ "หน้าตาผิดชัดเจน" ค่าที่ถูกรูปแบบแต่ผิดตัวยังต้องพิสูจน์ด้วยปุ่มทดสอบ
 */
function validate(ch: ChannelKey, patch: ChannelPatch): string | null {
  if (ch === 'telegram') {
    if (patch.token && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(patch.token)) {
      return 'รูปแบบ token ไม่ถูกต้อง — ต้องเป็นแบบ 123456789:AAE… ที่ได้จาก @BotFather';
    }
    if (patch.target && !/^-?\d{1,20}$/.test(patch.target)) {
      return 'chat id ต้องเป็นตัวเลข (ของกลุ่มจะติดลบ เช่น -1001234567890)';
    }
  } else {
    if (patch.token && patch.token.length < 40) {
      return 'channel access token สั้นผิดปกติ — ต้องใช้แบบ long-lived ที่ยาวประมาณ 170 ตัวอักษร';
    }
    if (patch.secret && !/^[0-9a-f]{32}$/i.test(patch.secret)) {
      return 'channel secret ต้องเป็นเลขฐานสิบหก 32 ตัว (คนละตัวกับ access token)';
    }
    if (patch.target && !/^[UCR][0-9a-fA-F]{32}$/.test(patch.target)) {
      return 'ปลายทางต้องเป็น id ของ LINE — user id ขึ้นต้นด้วย U, group id ขึ้นต้นด้วย C ตามด้วยเลขฐานสิบหก 32 ตัว';
    }
  }
  return null;
}

/** สถานะของตัวเฝ้าระวังที่รันเป็น cron อยู่บน host — อ่านอย่างเดียว ถ้าอ่านไม่ได้ให้ถือว่าไม่ทราบ */
function watcherStatus() {
  const dir = config.alertStateDir;
  const read = (name: string): string | null => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8').trim() || null;
    } catch {
      return null;
    }
  };

  try {
    return {
      last_run: read('last-run'),
      states: fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.state'))
        .sort()
        .map((f) => ({ key: f.replace(/\.state$/, ''), status: (read(f) || '').split(' ')[0] || 'unknown' })),
    };
  } catch {
    return { last_run: read('last-run'), states: [] as { key: string; status: string }[] };
  }
}

alertsRouter.get('/config', bucketLimiter('alerts'), (_req, res) => {
  res.json({
    success: true,
    channels: readStatus(),
    watcher: watcherStatus(),
    line_webhook_url: WEBHOOK_URL(),
  });
});

alertsRouter.post('/config', bucketLimiter('alerts', 20), async (req: AdminRequest, res) => {
  const ch = parseChannel(req.body?.channel);
  if (!ch) return res.status(400).json({ success: false, error: 'invalid_channel' });

  // ช่องที่เว้นว่าง = เก็บของเดิมไว้ ไม่ใช่ลบทิ้ง — หน้าเว็บไม่เคยได้ token กลับไปจึงเติมกลับมาไม่ได้
  const patch: ChannelPatch = {
    token: String(req.body?.token || '').trim() || undefined,
    target: String(req.body?.target || '').trim() || undefined,
    secret: String(req.body?.secret || '').trim() || undefined,
  };

  if (!patch.token && !patch.target && !patch.secret) {
    return res.status(400).json({ success: false, error: 'nothing_to_save', message: 'ไม่มีค่าที่จะบันทึก' });
  }

  const problem = validate(ch, patch);
  if (problem) return res.status(400).json({ success: false, error: 'invalid_value', message: problem });

  saveChannel(ch, patch);

  // บันทึกว่าใครแก้และแก้อะไร แต่ไม่บันทึกตัวความลับลงฐานข้อมูล ไม่งั้นจะไปโผล่ในไฟล์สำรอง
  await logAudit(req, 'alerts_config_update', {
    targetType: 'alert_channel',
    targetId: ch,
    summary: `ตั้งค่าแจ้งเตือน ${CHANNEL_NAME[ch]}`,
    detail: {
      channel: ch,
      target: patch.target ?? null,
      token_changed: Boolean(patch.token),
      secret_changed: Boolean(patch.secret),
    },
  });

  res.json({ success: true, channels: readStatus() });
});

alertsRouter.delete('/config/:channel', bucketLimiter('alerts', 20), async (req: AdminRequest, res) => {
  const ch = parseChannel(req.params.channel);
  if (!ch) return res.status(400).json({ success: false, error: 'invalid_channel' });

  clearChannel(ch);
  await logAudit(req, 'alerts_config_update', {
    targetType: 'alert_channel',
    targetId: ch,
    summary: `ลบการตั้งค่าแจ้งเตือน ${CHANNEL_NAME[ch]}`,
    detail: { channel: ch, cleared: true },
  });

  res.json({ success: true, channels: readStatus() });
});

alertsRouter.post('/test', bucketLimiter('alerts_test', 6), async (req: AdminRequest, res) => {
  const ch = parseChannel(req.body?.channel);
  if (!ch) return res.status(400).json({ success: false, error: 'invalid_channel' });

  const { token, target } = readSecrets(ch);
  if (!token || !target) {
    return res.status(400).json({ success: false, error: 'not_configured', message: 'ยังไม่ได้ตั้งค่าช่องทางนี้' });
  }

  const who = req.admin?.username || 'admin';
  const result = await sendTest(
    ch,
    token,
    target,
    `🔔 PayBox: ทดสอบการแจ้งเตือน\nถ้าเห็นข้อความนี้แปลว่าตั้งค่าถูกแล้ว\nสั่งทดสอบโดย ${who}`
  );

  await logAudit(req, 'alerts_test', {
    targetType: 'alert_channel',
    targetId: ch,
    summary: `ทดสอบส่งแจ้งเตือน ${CHANNEL_NAME[ch]} — ${result.ok ? 'สำเร็จ' : 'ไม่สำเร็จ'}`,
    detail: { channel: ch, ok: result.ok },
  });

  res.json({ success: result.ok, message: result.message });
});

// ค้นหา chat id ของ Telegram — รับ token ที่เพิ่งพิมพ์มาได้เลยโดยยังไม่ต้องบันทึก
// เพราะลำดับที่เป็นธรรมชาติคือได้ token มาก่อน แล้วค่อยหาปลายทาง
alertsRouter.post('/telegram/chats', bucketLimiter('alerts_test', 10), async (req: AdminRequest, res) => {
  const token = String(req.body?.token || '').trim() || readSecrets('telegram').token;
  if (!token) return res.status(400).json({ success: false, message: 'ยังไม่มี token ให้ใช้ค้นหา' });

  const result = await discoverTelegramChats(token);
  res.json({ success: result.ok, message: result.message, chats: result.chats });
});

// ปลายทาง LINE ที่ webhook จดไว้ — ต่างจาก Telegram ตรงที่ถามย้อนหลังไม่ได้ ต้องรอให้มีคนทัก
// บอทเข้ามาหลังผูก webhook แล้วเท่านั้น
alertsRouter.get('/line/sources', bucketLimiter('alerts'), (_req, res) => {
  const { secret } = readSecrets('line');
  res.json({ success: true, sources: readSources(), secret_configured: Boolean(secret), webhook_url: WEBHOOK_URL() });
});
