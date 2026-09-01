// รับ webhook จาก LINE เพื่อให้รู้ว่าจะส่งการแจ้งเตือนไปที่ไหน
//
// LINE ไม่แสดง groupId ที่ไหนในหน้า console เลย และไม่มี API ให้ถามย้อนหลังแบบ getUpdates ของ
// Telegram ทางเดียวคือดักตอนที่ event วิ่งเข้ามาแล้วจดไว้ — endpoint นี้จึงมีไว้เพื่อการนั้นอย่างเดียว
// ไม่ได้ตอบโต้อะไรกลับไปหาผู้ใช้ LINE
//
// endpoint นี้เปิดสาธารณะโดยจำเป็น (LINE ต้องเรียกได้) ความปลอดภัยจึงมาจากลายเซ็นล้วนๆ
import { Router, raw } from 'express';
import { readSecrets } from '../lib/alertConfig';
import { rememberSource } from '../lib/lineSources';
import { verifyLineSignature } from '../lib/webhookSignature';

export const lineWebhookRouter = Router();

/** ถามชื่อที่อ่านออกจาก LINE ถ้าถามไม่ได้ก็ใช้ id ไปก่อน ดีกว่าทำให้ทั้ง webhook ล้ม */
async function resolveName(token: string, source: any): Promise<string> {
  const url =
    source.type === 'group'
      ? `https://api.line.me/v2/bot/group/${source.groupId}/summary`
      : source.type === 'user'
        ? `https://api.line.me/v2/bot/profile/${source.userId}`
        : '';
  if (!url || !token) return source.type === 'group' ? 'กลุ่ม' : 'ผู้ใช้';

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return source.type === 'group' ? 'กลุ่ม' : 'ผู้ใช้';
    const data: any = await res.json();
    return String(data.groupName || data.displayName || 'ไม่ทราบชื่อ').slice(0, 80);
  } catch {
    return source.type === 'group' ? 'กลุ่ม' : 'ผู้ใช้';
  }
}

lineWebhookRouter.post('/', raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const { token, secret } = readSecrets('line');

  // ยังไม่ได้ใส่ channel secret = ตรวจลายเซ็นไม่ได้ ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน
  if (!secret) return res.status(503).send('no secret configured');

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyLineSignature(body, String(req.headers['x-line-signature'] || ''), secret)) {
    return res.status(401).send('bad signature');
  }

  // ตอบ 200 ให้เร็วที่สุด แล้วค่อยทำงานต่อ — LINE ตัดที่ไม่กี่วินาทีและปิด endpoint ที่ตอบช้าบ่อยๆ
  res.status(200).send('ok');

  let payload: any;
  try {
    payload = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    return;
  }

  // ปุ่ม Verify ใน console ส่ง events ว่างมา ลายเซ็นถูกต้องแต่ไม่มีอะไรให้จด — ถือว่าสำเร็จ
  for (const event of payload.events || []) {
    const src = event?.source;
    if (!src) continue;
    const id = src.groupId || src.roomId || src.userId;
    if (!id) continue;

    rememberSource({ id, type: src.type || 'unknown', name: await resolveName(token, src) });
  }
});
