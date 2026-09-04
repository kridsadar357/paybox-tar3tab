// Payso (Pay Solutions) — PromptPay แบบ none-UI
//
// ยังใช้งานไม่ได้ ณ ตอนนี้ ไม่ใช่เพราะโค้ด แต่เพราะบัญชีร้านค้ายังไม่ได้เปิดสิทธิ์ใช้ API แบบนี้
// เรียกแล้วได้ {"message":"error : the shop is not open yet. Please contact the store."}
// ทั้งที่ Auth Key ถูกต้องและช่องทาง redirect ของ merchantID เดียวกันใช้ได้ปกติ
//
// เก็บไว้ให้ครบเพื่อให้เพิ่มเข้าไปได้ทันทีเมื่อ Payso เปิดให้ และเพื่อให้หน้าแอดมินแสดงเป็น
// ตัวเลือกที่บอกเหตุผลได้ว่าทำไมยังเลือกไม่ได้
import { config } from '../../config';
import { ChargeResult, PaymentProvider, ProviderNotConfiguredError, StatusResult } from './types';

const CREATE_URL = 'https://apis.paysolutions.asia/tep/api/v2/promptpaynew';

export const paysoProvider: PaymentProvider = {
  name: 'payso',

  isValidRef: (ref) => /^\d{12}$/.test(ref),

  // ยังไม่เปิดใช้จนกว่าจะตั้ง token และ Payso เปิดสิทธิ์ให้
  isConfigured: () => Boolean(config.payso?.token && config.payso?.merchantId),

  async createCharge(amountBaht: number): Promise<ChargeResult> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('payso', 'ยังไม่ได้ตั้ง PAYSO_TOKEN หรือ PAYSO_MERCHANT_ID');
    }
    // เลขอ้างอิงต้องเป็นตัวเลข 12 หลักและห้ามซ้ำ ใช้เวลาเป็นฐาน
    const ref = (Date.now() % 1e12).toString().padStart(12, '0');
    const qs = new URLSearchParams({
      merchantID: config.payso.merchantId,
      productDetail: 'PayBox',
      customerEmail: config.billingEmail,
      customerName: 'PayBox',
      total: amountBaht.toFixed(2),
      referenceNo: ref,
    });
    const res = await fetch(`${CREATE_URL}?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.payso.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (body?.status !== 'success' || !body?.data?.image) {
      throw new Error(`payso สร้าง QR ไม่สำเร็จ: ${body?.message || `http ${res.status}`}`);
    }
    // Payso คืนมาเป็นรูป base64 ไม่ใช่สตริง EMVCo — เครื่องต้องการสตริง จึงยังต่อเข้าระบบไม่ได้
    // จนกว่าจะหาวิธีให้ได้ payload ดิบ หรือเปลี่ยนให้เครื่องรับรูปได้
    throw new Error('payso คืน QR มาเป็นรูปภาพ ยังไม่รองรับเพราะเครื่องต้องการสตริง EMVCo');
  },

  async getStatus(): Promise<StatusResult> {
    throw new ProviderNotConfiguredError('payso', 'ยังไม่ได้ทำส่วนถามสถานะ');
  },
};
