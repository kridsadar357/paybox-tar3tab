// รับเหตุการณ์จาก Stripe โดยตรง
//
// ทำไมต้องมี: เดิมสถานะรายการอัปเดตได้ทางเดียวคือบอร์ดถาม check_status ถ้าเครื่องดับ เน็ตหลุด
// หรือลูกค้าเดินหนีตอนสแกน รายการนั้นค้างตลอดกาล — ที่แย่กว่านั้นคือ QR ของ PromptPay ยังจ่ายได้
// หลังบอร์ดเลิกถามแล้ว (บอร์ดนับถอยหลังแค่ 2 นาที) กรณีนั้นเงินเข้า Stripe จริงแต่ระบบเราไม่รู้
// และร้านค้าไม่ได้เงิน
//
// webhook เป็นแหล่งความจริงที่ไม่ขึ้นกับว่าบอร์ดยังมีชีวิตอยู่หรือไม่
import { Router, raw } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { verifyStripeSignature } from '../lib/webhookSignature';
import { stripeRequest } from '../stripe';
import { applyProviderStatus } from '../lib/transactionSync';
import { stripeIntentToStatus } from '../lib/providers/stripe';

export const stripeWebhookRouter = Router();

// ต้องใช้ raw body เพื่อคำนวณลายเซ็น — router นี้จึงต้องถูก mount ก่อน express.json() ใน server.ts
stripeWebhookRouter.post('/', raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const secret = config.stripeWebhookSecret;
  if (!secret) {
    console.error('[stripe-webhook] ยังไม่ได้ตั้ง STRIPE_WEBHOOK_SECRET — ปฏิเสธทุก event');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }

  const sigHeader = String(req.headers['stripe-signature'] || '');
  const rawBody = req.body as Buffer;

  if (!Buffer.isBuffer(rawBody) || !verifyStripeSignature(rawBody, sigHeader, secret)) {
    console.error(`[stripe-webhook] ลายเซ็นไม่ผ่าน จาก ${req.ip}`);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // ตอบ 200 ให้เร็วที่สุดเท่าที่ทำได้หลังยืนยันตัวตนแล้ว — Stripe จะยิงซ้ำถ้าเราตอบช้าหรือพัง
  // และเราออกแบบให้ประมวลผลซ้ำได้อยู่แล้ว จึงปลอดภัยที่จะตอบก่อนทำงานจริง
  res.json({ received: true });

  try {
    await handleEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] ประมวลผล event ล้มเหลว:', err);
  }
});

async function handleEvent(event: any): Promise<void> {
  const type = String(event?.type || '');
  if (!type.startsWith('payment_intent.')) {
    return; // ยังไม่สนใจ event ชนิดอื่น
  }

  const intent = event?.data?.object;
  const intentId = intent?.id;
  if (!intentId) return;

  const [rows] = await pool.query(
    'SELECT id, device_id, status, amount, settlement_id FROM transactions WHERE payment_intent_id = ? LIMIT 1',
    [intentId]
  );
  const txn = (rows as any[])[0];
  if (!txn) {
    // เกิดได้ถ้ามีคนใช้ Stripe key เดียวกันทำอย่างอื่น — ไม่ใช่ความผิดพลาดของเรา
    console.warn(`[stripe-webhook] ไม่พบรายการของ ${intentId} (${type})`);
    return;
  }

  const status = String(intent.status || '');

  // payload ของ webhook ส่ง latest_charge มาเป็น id เปล่าๆ ไม่ได้ expand — ถ้าใช้ตรงๆ ค่าธรรมเนียม
  // ที่ Stripe หักจะกลายเป็น 0 และกำไรแพลตฟอร์มเพี้ยนทุกรายการ จึงต้องดึงตัวเต็มมาเองเมื่อสำเร็จ
  let full = intent;
  if (status === 'succeeded') {
    const res = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(intentId)}`, {
      expand: ['latest_charge.balance_transaction'],
    });
    if (res.ok && res.data) {
      full = res.data;
    } else {
      console.error(`[stripe-webhook] ดึงรายละเอียด ${intentId} ไม่ได้ — ค่าธรรมเนียม Stripe จะถูกบันทึกเป็น 0`);
    }
  }

  const changed = await applyProviderStatus(txn, stripeIntentToStatus(full));
  if (changed) {
    console.log(`[stripe-webhook] ${intentId}: ${txn.status} -> ${status} (${type})`);
  }
}
