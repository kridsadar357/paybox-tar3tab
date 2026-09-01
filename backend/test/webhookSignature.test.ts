// ด่านเดียวที่กันไม่ให้ใครก็ได้ยิงคำสั่งเข้ามาเปลี่ยนสถานะการชำระเงิน
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyStripeSignature, verifyLineSignature } from '../src/lib/webhookSignature';

const SECRET = 'whsec_test_secret_value';
const BODY = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');
const NOW = 1_700_000_000;

function stripeHeader(ts: number, body: Buffer, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body.toString('utf8')}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  it('ยอมรับลายเซ็นที่ถูกต้อง', () => {
    expect(verifyStripeSignature(BODY, stripeHeader(NOW, BODY, SECRET), SECRET, NOW)).toBe(true);
  });

  it('ปฏิเสธเมื่อ secret ผิด', () => {
    expect(verifyStripeSignature(BODY, stripeHeader(NOW, BODY, 'whsec_wrong'), SECRET, NOW)).toBe(false);
  });

  it('ปฏิเสธเมื่อเนื้อหาถูกแก้แม้แต่ไบต์เดียว', () => {
    const header = stripeHeader(NOW, BODY, SECRET);
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), header, SECRET, NOW)).toBe(false);
  });

  it('ปฏิเสธ payload เก่าที่ถูกดักไว้แล้วส่งซ้ำ', () => {
    const old = stripeHeader(NOW - 400, BODY, SECRET);
    expect(verifyStripeSignature(BODY, old, SECRET, NOW)).toBe(false);
  });

  it('ยอมรับที่ขอบของช่วงเวลาที่อนุญาต', () => {
    expect(verifyStripeSignature(BODY, stripeHeader(NOW - 300, BODY, SECRET), SECRET, NOW)).toBe(true);
    expect(verifyStripeSignature(BODY, stripeHeader(NOW - 301, BODY, SECRET), SECRET, NOW)).toBe(false);
  });

  it('ปฏิเสธเมื่อเวลาในอนาคตไกลเกินไป (นาฬิกาเพี้ยนหรือปลอมมา)', () => {
    expect(verifyStripeSignature(BODY, stripeHeader(NOW + 400, BODY, SECRET), SECRET, NOW)).toBe(false);
  });

  it('ปฏิเสธ header ที่ผิดรูปแบบ หรือไม่มี secret', () => {
    expect(verifyStripeSignature(BODY, '', SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, 'ไม่ใช่ลายเซ็น', SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, `t=${NOW}`, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, stripeHeader(NOW, BODY, SECRET), '', NOW)).toBe(false);
  });

  it('ยอมรับเมื่อมีหลายลายเซ็นและมีตัวหนึ่งถูก (ตอนหมุน secret)', () => {
    const good = crypto.createHmac('sha256', SECRET).update(`${NOW}.${BODY.toString('utf8')}`).digest('hex');
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=deadbeef,v1=${good}`, SECRET, NOW)).toBe(true);
  });
});

describe('verifyLineSignature', () => {
  const lineSecret = '0123456789abcdef0123456789abcdef';
  const lineBody = Buffer.from('{"destination":"U1","events":[]}');
  const sign = (b: Buffer, s: string) => crypto.createHmac('sha256', s).update(b).digest('base64');

  it('ยอมรับลายเซ็นที่ถูกต้อง รวมถึงกรณี events ว่างจากปุ่ม Verify', () => {
    expect(verifyLineSignature(lineBody, sign(lineBody, lineSecret), lineSecret)).toBe(true);
  });

  it('ปฏิเสธเมื่อ secret ผิดหรือเนื้อหาถูกแก้', () => {
    expect(verifyLineSignature(lineBody, sign(lineBody, 'ffff'), lineSecret)).toBe(false);
    expect(verifyLineSignature(Buffer.from('{"events":[{}]}'), sign(lineBody, lineSecret), lineSecret)).toBe(false);
  });

  it('ปฏิเสธเมื่อไม่มี header หรือยังไม่ได้ตั้ง secret', () => {
    expect(verifyLineSignature(lineBody, '', lineSecret)).toBe(false);
    expect(verifyLineSignature(lineBody, sign(lineBody, lineSecret), '')).toBe(false);
  });
});
