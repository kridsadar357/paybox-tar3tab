// สัญญาที่ผู้ให้บริการรับชำระเงินทุกเจ้าต้องทำตาม
//
// มีไว้เพื่อให้ส่วนที่เหลือของระบบ — endpoint ของเครื่อง, การคิดค่าธรรมเนียม, การเคลียร์บิล —
// ไม่ต้องรู้เลยว่ากำลังคุยกับใคร เพิ่มเจ้าใหม่ = เขียนไฟล์เดียวแล้วลงทะเบียนใน index.ts

export type ProviderName = 'stripe' | 'ksher' | 'payso';

/**
 * สถานะที่ระบบใช้ภายใน — ยึดคำของ Stripe ไว้เพราะข้อมูลเดิมทั้งหมดใช้ชุดนี้อยู่แล้ว
 * และหน้าเว็บก็แปลจากคำเหล่านี้ ผู้ให้บริการเจ้าอื่นต้องแปลงมาให้ตรงชุดนี้
 */
export type NormalizedStatus =
  | 'requires_payment_method'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'refunded'
  | 'unknown';

export interface ChargeResult {
  /** รหัสอ้างอิงฝั่งผู้ให้บริการ เก็บลงคอลัมน์ payment_intent_id และเครื่องเอาไปถามสถานะต่อ */
  ref: string;
  /** สตริง EMVCo ที่เครื่องเอาไปวาดเป็น QR เอง — ทุกเจ้าต้องให้ค่านี้ ไม่ใช่รูปภาพ */
  qrPayload: string;
}

export interface StatusResult {
  status: NormalizedStatus;
  /** ค่าธรรมเนียมที่ผู้ให้บริการหักไปจริง หน่วยบาท ถ้าเจ้านั้นไม่บอกให้เป็น null */
  providerFeeBaht: number | null;
  /** ข้อมูลดิบไว้ดูตอนไล่ปัญหา ไม่มีใครพึ่งพารูปร่างของมัน */
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: ProviderName;

  /** ตรวจรูปแบบรหัสอ้างอิงที่เครื่องส่งกลับมา กันไม่ให้เอา id ของเจ้าอื่นมาถามผิดที่ */
  isValidRef(ref: string): boolean;

  /** พร้อมใช้งานไหม — ยังไม่ได้ตั้ง credential ก็ถือว่าไม่พร้อม */
  isConfigured(): boolean;

  /** สร้างรายการรับเงินใหม่ คืนรหัสอ้างอิงกับ payload ของ QR */
  createCharge(amountBaht: number, currency: string): Promise<ChargeResult>;

  /** ถามสถานะล่าสุดของรายการ */
  getStatus(ref: string): Promise<StatusResult>;
}

/** ผู้ให้บริการที่ยังตั้งค่าไม่ครบ โยนตัวนี้เพื่อให้ข้อความที่ผู้ใช้เห็นบอกสาเหตุตรงๆ */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: string, detail: string) {
    super(`ยังใช้ ${provider} ไม่ได้: ${detail}`);
    this.name = 'ProviderNotConfiguredError';
  }
}
