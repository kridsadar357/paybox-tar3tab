// การแปลงสถานะของ Ksher มาเป็นคำที่ระบบใช้ภายใน
//
// แปลงผิดหมายถึงรายการที่จ่ายแล้วถูกมองว่ายังไม่จ่าย หรือกลับกัน — กระทบยอดที่ต้องโอนให้ร้านค้า
// โดยตรง จึงล็อกความหมายไว้ด้วยเทสต์
import { describe, it, expect } from 'vitest';
import { mapKsherStatus, buildSignString } from '../src/lib/providers/ksherSign';

describe('แปลงสถานะของ Ksher', () => {
  it('จ่ายสำเร็จ', () => {
    expect(mapKsherStatus('SUCCESS')).toBe('succeeded');
  });

  it('ยังไม่จ่าย ต้องไม่ถูกมองว่าจบแล้ว', () => {
    // requires_action แปลว่ายังรอลูกค้าอยู่ ตัวตามเก็บจะยังถามต่อ
    expect(mapKsherStatus('NOTPAY')).toBe('requires_action');
  });

  it('กำลังกดยืนยันอยู่', () => {
    expect(mapKsherStatus('USERPAYING')).toBe('processing');
    expect(mapKsherStatus('PENDING')).toBe('processing');
  });

  it('ล้มเหลวและถูกปิด', () => {
    expect(mapKsherStatus('PAYERROR')).toBe('failed');
    expect(mapKsherStatus('FAIL')).toBe('failed');
    expect(mapKsherStatus('CLOSED')).toBe('canceled');
    expect(mapKsherStatus('REFUND')).toBe('refunded');
  });

  it('NOTSURE ต้องเป็น unknown ไม่ใช่เดาว่าล้มเหลว', () => {
    // เอกสารบอกให้ถามซ้ำ การเดาว่าล้มเหลวจะทำให้รายการที่จ่ายจริงถูกทิ้ง
    expect(mapKsherStatus('NOTSURE')).toBe('unknown');
  });

  it('คำที่ไม่รู้จักหรือไม่มีค่า ต้องเป็น unknown ไม่ใช่ succeeded', () => {
    expect(mapKsherStatus('SOMETHING_NEW')).toBe('unknown');
    expect(mapKsherStatus('')).toBe('unknown');
    expect(mapKsherStatus(null)).toBe('unknown');
    expect(mapKsherStatus(undefined)).toBe('unknown');
  });
});

describe('สตริงที่เอาไปเซ็นของ Ksher', () => {
  it('ตัด sign ออกและเรียงตาม ASCII ต่อกันไม่มีตัวคั่น', () => {
    const s = buildSignString({ b: '2', a: '1', sign: 'ไม่ควรอยู่' });
    expect(s).toBe('a=1b=2');
  });

  it('ตัดเฉพาะค่าที่ไม่ได้ส่ง ไม่ตัดค่าว่าง', () => {
    expect(buildSignString({ a: '1', b: '', c: null, d: undefined })).toBe('a=1b=');
  });

  it('ตัวเลขไม่ถูกแปลงเป็น JSON', () => {
    expect(buildSignString({ total_fee: 1750 })).toBe('total_fee=1750');
  });
});

describe('expire_time ต้องอยู่ในลายเซ็นด้วย', () => {
  // พารามิเตอร์ทุกตัวที่ส่งไปต้องถูกเซ็น ถ้าใส่ตัวใหม่แล้วลืมรวมในลายเซ็น Ksher จะปฏิเสธทั้งคำขอ
  const base = {
    appid: 'mch43525',
    channel: 'promptpay',
    fee_type: 'THB',
    img_type: 'png',
    mch_order_no: 'Pabc123',
    nonce_str: 'n',
    time_stamp: '20260905000000',
    total_fee: 1000,
    version: '2.0.0',
  };

  it('เรียงเข้าที่ตามลำดับ ASCII ไม่ใช่ต่อท้าย', () => {
    const s = buildSignString({ ...base, expire_time: 900 });
    // e มาก่อน f (fee_type) และหลัง c (channel)
    expect(s).toContain('channel=promptpayexpire_time=900fee_type=THB');
  });

  it('ส่งเป็นตัวเลขหรือข้อความให้ผลเหมือนกัน', () => {
    expect(buildSignString({ ...base, expire_time: 900 })).toBe(
      buildSignString({ ...base, expire_time: '900' })
    );
  });

  it('ไม่ใส่ expire_time แล้วสตริงต้องต่างจากใส่', () => {
    expect(buildSignString(base)).not.toBe(buildSignString({ ...base, expire_time: 900 }));
  });
});
