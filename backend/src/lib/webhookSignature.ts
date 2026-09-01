// ตรวจลายเซ็นของ webhook ที่วิ่งเข้ามาจากภายนอก
//
// แยกออกมาจากไฟล์ route เพื่อให้เทสต์ได้ นี่เป็นด่านเดียวที่กันไม่ให้ใครก็ได้ยิงคำสั่งเข้ามา
// เปลี่ยนสถานะการชำระเงิน — โค้ดแบบนี้ควรมีเทสต์มากกว่าโค้ดส่วนอื่นทั้งหมด
import crypto from 'crypto';

/** ยอมให้เวลาคลาดได้เท่านี้ กัน replay ของ payload เก่าที่ถูกดักไว้ */
export const STRIPE_TOLERANCE_SEC = 300;

/** เทียบแบบใช้เวลาคงที่ ไม่ให้ผู้โจมตีเดาลายเซ็นทีละตัวอักษรจากเวลาที่ใช้ตอบ */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * ตรวจลายเซ็นตามสเปกของ Stripe
 * header: Stripe-Signature: t=<unix>,v1=<hex>,v1=<hex>...
 * ข้อความที่เซ็นคือ "<t>.<raw body>" ด้วย HMAC-SHA256 และ webhook secret
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || !secret) return false;

  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't') timestamp = v;
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(nowSec - Number(timestamp));
  if (!Number.isFinite(age) || age > STRIPE_TOLERANCE_SEC) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  return signatures.some((sig) => safeEqual(expected, sig));
}

/**
 * ตรวจลายเซ็นของ LINE: X-Line-Signature = base64( HMAC-SHA256( raw body, channel secret ) )
 *
 * ไม่มี timestamp ให้ตรวจแบบ Stripe จึงกัน replay ไม่ได้ — ยอมรับได้เพราะ endpoint ที่ใช้ตัวนี้
 * ไม่แตะเงินและไม่เปลี่ยนสถานะอะไรนอกจากรายชื่อปลายทางที่แอดมินต้องกดเลือกเองอยู่ดี
 */
export function verifyLineSignature(rawBody: Buffer, header: string, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return safeEqual(expected, header);
}
