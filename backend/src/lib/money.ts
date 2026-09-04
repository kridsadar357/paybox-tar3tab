// การคำนวณเงินทั้งหมดของระบบ
//
// แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์ได้โดยไม่ต้องมีฐานข้อมูล เดิมตรรกะนี้ฝังอยู่กลาง
// transactionSync.ts ที่ต้องมี MySQL ถึงจะเรียกได้ จึงไม่เคยมีใครเทสต์มันเลยทั้งที่เป็นโค้ดที่
// ตัดสินว่าร้านค้าได้เงินเท่าไหร่
//
// ทุกอย่างปัดเป็นทศนิยม 2 ตำแหน่งเสมอ เพราะเลขที่ลงฐานข้อมูลเป็น DECIMAL(10,2) ถ้าไม่ปัดตรงนี้
// MySQL จะปัดให้เอง แล้วยอดที่โชว์ในหน้าเว็บกับยอดที่เก็บจริงจะไม่ตรงกันทีละสตางค์

/** ปัดเป็นทศนิยม 2 ตำแหน่งแบบเดียวกันทั้งระบบ */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FeeTier = 'percentage' | 'flat' | string | null | undefined;

/**
 * ค่าธรรมเนียมที่แพลตฟอร์มหักจากยอดหนึ่งรายการ
 *
 * แบบเหมาจ่าย (flat) คิดกันเป็นรอบ ไม่ใช่รายรายการ จึงคืน 0 ตรงนี้ — ไปหักตอนปิดรอบโอนเงินแทน
 * ถ้าคิดที่นี่ด้วยจะกลายเป็นเก็บสองเด้ง
 */
export function feeFor(amount: number, tier: FeeTier, feePercent: number): number {
  if (tier !== 'percentage') return 0;
  if (!Number.isFinite(amount) || !Number.isFinite(feePercent)) return 0;
  if (amount <= 0 || feePercent <= 0) return 0;
  return round2(amount * (feePercent / 100));
}

/** แปลงหน่วยย่อยของ Stripe (สตางค์) เป็นบาท */
export function subunitsToBaht(subunits: number | null | undefined): number {
  if (subunits === null || subunits === undefined || !Number.isFinite(subunits)) return 0;
  return round2(subunits / 100);
}

export interface Settlement {
  /** ยอดที่ร้านค้าได้รับ */
  net: number;
  /** ส่วนที่เหลือของแพลตฟอร์มหลังหักค่าธรรมเนียมที่ผู้ให้บริการเก็บไป */
  profit: number;
}

/**
 * แบ่งยอดหนึ่งรายการออกเป็นส่วนของร้านค้ากับส่วนของแพลตฟอร์ม
 *
 * profit ติดลบได้จริงและไม่ถือว่าผิด — รายการยอดน้อยที่ค่าธรรมเนียมของผู้ให้บริการแพงกว่าที่เราเก็บ
 * จะขาดทุน การไปบังคับให้เป็น 0 จะทำให้รายงานกำไรดูดีกว่าความจริง
 */
export function settle(amount: number, feeAmount: number, providerFeeAmount: number): Settlement {
  return {
    net: round2(amount - feeAmount),
    profit: round2(feeAmount - providerFeeAmount),
  };
}

/**
 * กำไรสุทธิที่เหลือจริงหลังหักส่วนที่ผู้ให้บริการรับชำระเงินเก็บไป
 *
 * มีอยู่เพราะตัวเลขที่ตั้งในหน้าแอดมินคืออัตราที่ "เก็บจากร้านค้า" ซึ่งไม่ใช่สิ่งที่เราได้ —
 * เคยตั้งไว้ 1.00% โดยเข้าใจว่าเป็นกำไร ทั้งที่ต้นทุนอยู่ที่ 1.77% ผลคือขาดทุนทุกรายการ
 * โดยไม่มีอะไรในระบบเตือน
 */
export function netMarginPercent(grossPercent: number, providerPercent: number): number {
  return round2(grossPercent - providerPercent);
}

/** อัตราที่ต้องเก็บจากร้านค้าเพื่อให้เหลือกำไรสุทธิตามที่ต้องการ */
export function grossPercentForNetMargin(netPercent: number, providerPercent: number): number {
  return round2(netPercent + providerPercent);
}

/**
 * อัตราขั้นต่ำที่ยอมให้ตั้งได้ ต่ำกว่านี้คือรับประกันว่าขาดทุน
 *
 * ตั้งเป็น "มากกว่าต้นทุน" ไม่ใช่ "เท่ากับต้นทุน" เพราะเท่ากับต้นทุนพอดีแปลว่าทำงานฟรี
 * และเมื่อผู้ให้บริการขึ้นราคาแม้แต่นิดเดียวก็ติดลบทันที
 */
export function isFeeBelowCost(grossPercent: number, providerPercent: number): boolean {
  return grossPercent <= providerPercent;
}
