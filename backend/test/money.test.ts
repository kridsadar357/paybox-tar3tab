// เทสต์ตรรกะที่ตัดสินว่าร้านค้าได้เงินเท่าไหร่ — ผิดตรงนี้แปลว่าจ่ายเงินผิด ไม่ใช่แค่ UI เพี้ยน
import { describe, it, expect } from 'vitest';
import {
  round2, feeFor, subunitsToBaht, settle,
  netMarginPercent, grossPercentForNetMargin, isFeeBelowCost,
} from '../src/lib/money';

describe('round2', () => {
  it('ปัดเป็นสองตำแหน่ง', () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(10.004)).toBe(10);
    expect(round2(0.1 + 0.2)).toBe(0.3); // เลขทศนิยมของ JS ให้ 0.30000000000000004
  });
});

describe('feeFor', () => {
  it('คิดเป็นเปอร์เซ็นต์ของยอด', () => {
    expect(feeFor(100, 'percentage', 3.5)).toBe(3.5);
    expect(feeFor(10, 'percentage', 3.5)).toBe(0.35);
  });

  it('ปัดเศษสตางค์ก่อนคืนค่า ไม่ปล่อยให้ MySQL ปัดเอง', () => {
    // 15 * 3.5% = 0.525 -> ถ้าไม่ปัด ยอดที่โชว์กับยอดที่เก็บจะต่างกันหนึ่งสตางค์
    expect(feeFor(15, 'percentage', 3.5)).toBe(0.53);
  });

  it('แบบเหมาจ่ายไม่หักรายรายการ เพราะไปหักตอนปิดรอบแล้ว', () => {
    expect(feeFor(100, 'flat', 3.5)).toBe(0);
  });

  it('ไม่มีชั้นค่าธรรมเนียม หรือค่าที่ใช้ไม่ได้ ให้เป็นศูนย์ ไม่ใช่ NaN', () => {
    expect(feeFor(100, null, 3.5)).toBe(0);
    expect(feeFor(100, 'percentage', NaN)).toBe(0);
    expect(feeFor(NaN, 'percentage', 3.5)).toBe(0);
    expect(feeFor(-100, 'percentage', 3.5)).toBe(0);
    expect(feeFor(100, 'percentage', 0)).toBe(0);
  });
});

describe('subunitsToBaht', () => {
  it('แปลงสตางค์เป็นบาท', () => {
    expect(subunitsToBaht(1000)).toBe(10);
    expect(subunitsToBaht(1)).toBe(0.01);
  });

  it('ไม่มีค่าจาก Stripe ให้เป็นศูนย์ ไม่ใช่ NaN ที่จะไหลลงฐานข้อมูล', () => {
    expect(subunitsToBaht(null)).toBe(0);
    expect(subunitsToBaht(undefined)).toBe(0);
  });
});

describe('settle', () => {
  it('แบ่งยอดระหว่างร้านค้ากับแพลตฟอร์ม', () => {
    expect(settle(100, 3.5, 2.15)).toEqual({ net: 96.5, profit: 1.35 });
  });

  it('ยอมให้กำไรติดลบ เพราะรายการยอดน้อยขาดทุนได้จริง', () => {
    // ฿10 เก็บ 3.5% = 0.35 แต่ Stripe เก็บ 2.15 -> ขาดทุน 1.80
    expect(settle(10, 0.35, 2.15).profit).toBe(-1.8);
  });

  it('ยอดที่ร้านได้ไม่ขึ้นกับค่าธรรมเนียมของ Stripe', () => {
    expect(settle(100, 3.5, 0).net).toBe(settle(100, 3.5, 99).net);
  });
});

// ตัวเลขที่ตั้งในหน้าแอดมินคือที่เก็บจากร้านค้า ไม่ใช่ที่เราได้ — ความสับสนนี้ทำให้ระบบตั้งไว้ 1%
// ทั้งที่ต้นทุน 1.77% แล้วขาดทุนทุกรายการโดยไม่มีอะไรเตือน
describe('กำไรสุทธิเทียบกับต้นทุนของผู้ให้บริการ', () => {
  const STRIPE = 1.77; // วัดจากค่าธรรมเนียมจริงที่บันทึกไว้ในรายการที่ผ่านระบบ

  it('คิดกำไรสุทธิจากอัตราที่เก็บ', () => {
    expect(netMarginPercent(2.8, STRIPE)).toBe(1.03);
    expect(netMarginPercent(1.0, STRIPE)).toBe(-0.77);
  });

  it('คิดย้อนกลับว่าต้องเก็บเท่าไหร่จึงจะได้กำไรตามต้องการ', () => {
    expect(grossPercentForNetMargin(1, STRIPE)).toBe(2.77);
    expect(netMarginPercent(grossPercentForNetMargin(1, STRIPE), STRIPE)).toBe(1);
  });

  it('บอกได้ว่าอัตราไหนขาดทุนแน่นอน', () => {
    expect(isFeeBelowCost(1.0, STRIPE)).toBe(true);
    expect(isFeeBelowCost(1.77, STRIPE)).toBe(true); // เท่าทุนพอดี = ทำงานฟรี ถือว่าไม่ผ่าน
    expect(isFeeBelowCost(1.78, STRIPE)).toBe(false);
    expect(isFeeBelowCost(2.8, STRIPE)).toBe(false);
  });

  it('อัตราที่ตั้งไว้จริงตอนนี้ทำให้ขาดทุน — เป็นเหตุผลที่เทสต์ชุดนี้มีอยู่', () => {
    const volume = 275;
    const collected = (volume * 1.0) / 100;
    const providerCost = (volume * STRIPE) / 100;
    expect(round2(collected - providerCost)).toBeLessThan(0);
  });
});
