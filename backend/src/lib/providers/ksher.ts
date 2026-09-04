// Ksher — Native Pay (C scan B)
//
// เซ็นทุกคำขอด้วย RSA-MD5 ด้วยกุญแจส่วนตัวของร้านค้า: เรียงชื่อพารามิเตอร์ ทำเป็น key=value
// เรียงสตริงอีกรอบ ต่อกันโดยไม่มีตัวคั่น แล้วเซ็น ผลลัพธ์เป็นเลขฐานสิบหก
//
// ลายเซ็นที่ Ksher ส่งกลับมาครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response — เอาทั้งก้อนไปตรวจ
// จะไม่ผ่านเสมอ ยืนยันกับคำตอบจริงมาแล้ว
import crypto from 'crypto';
import { config } from '../../config';
import { ChargeResult, PaymentProvider, ProviderNotConfiguredError, StatusResult } from './types';
import { signParams, verifyResponse, mapKsherStatus, timeStamp, nonce, toSatang } from './ksherSign';

// ส่งออกต่อเพื่อให้ที่อื่นเรียกจากที่เดียวได้ ตัวจริงอยู่ใน ksherSign.ts ที่ไม่พึ่ง config
export { buildSignString, mapKsherStatus, verifyResponse } from './ksherSign';

const CREATE_URL = 'https://api.mch.ksher.net/KsherPay/native_pay';
const QUERY_URL = 'https://api.mch.ksher.net/KsherPay/order_query';
const CHANNEL = 'promptpay';
const TIMEOUT_MS = 20_000;

async function post(url: string, params: Record<string, unknown>, privateKey: string) {
  const body = new URLSearchParams({
    ...(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))),
    sign: signParams(params, privateKey),
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  try {
    return { httpCode: res.status, body: JSON.parse(raw) };
  } catch {
    return { httpCode: res.status, body: { _raw: raw.slice(0, 500) } };
  }
}

export const ksherProvider: PaymentProvider = {
  name: 'ksher',

  // รหัสอ้างอิงเป็นเลขที่สั่งซื้อที่เราตั้งเอง จำกัดความยาวตามสเปกและกันอักขระแปลกปลอม
  isValidRef: (ref) => /^[A-Za-z0-9_-]{1,32}$/.test(ref),

  isConfigured: () => Boolean(config.ksher.appid && config.ksher.privateKey),

  async createCharge(amountBaht: number): Promise<ChargeResult> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('ksher', 'ยังไม่ได้ตั้ง KSHER_APPID หรือ KSHER_PRIVATE_KEY');
    }
    // เลขที่สั่งซื้อต้องไม่ซ้ำ ใช้เวลาเป็นฐานแล้วต่อท้ายด้วยค่าสุ่มกันชนกันเองเมื่อยิงพร้อมกัน
    const ref = 'P' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

    const params: Record<string, unknown> = {
      appid: config.ksher.appid,
      channel: CHANNEL,
      fee_type: 'THB',
      img_type: 'png',
      mch_order_no: ref,
      nonce_str: nonce(),
      time_stamp: timeStamp(),
      total_fee: toSatang(amountBaht),
      version: '2.0.0',
    };
    if (config.ksherExpireSeconds > 0) params.expire_time = config.ksherExpireSeconds;

    const { httpCode, body } = await post(CREATE_URL, params, config.ksher.privateKey);
    if (body?.code !== 0 || !body?.data?.code_url) {
      const why = body?.data?.err_msg || body?.msg || `http ${httpCode}`;
      throw new Error(`ksher สร้าง QR ไม่สำเร็จ: ${why}`);
    }
    if (!verifyResponse(body)) {
      // ลายเซ็นไม่ผ่านแปลว่าคำตอบอาจถูกแก้ระหว่างทาง ไม่ควรเอา QR นั้นไปแสดงให้ลูกค้าจ่าย
      throw new Error('ksher สร้าง QR แล้วแต่ลายเซ็นคำตอบไม่ถูกต้อง');
    }

    return { ref, qrPayload: body.data.code_url };
  },

  async getStatus(ref: string): Promise<StatusResult> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('ksher', 'ยังไม่ได้ตั้ง KSHER_APPID หรือ KSHER_PRIVATE_KEY');
    }
    const params: Record<string, unknown> = {
      appid: config.ksher.appid,
      channel: CHANNEL,
      mch_order_no: ref,
      nonce_str: nonce(),
      time_stamp: timeStamp(),
      version: '2.0.0',
    };
    const { httpCode, body } = await post(QUERY_URL, params, config.ksher.privateKey);

    // code ที่ไม่ใช่ 0 แปลว่าถามไม่สำเร็จ ไม่ใช่ว่ารายการอยู่ในสถานะที่ไม่รู้จัก
    // ต้องแยกสองอย่างนี้ ไม่งั้นตัวตามเก็บจะนึกว่าถามได้แล้วแต่ไม่มีอะไรเปลี่ยน แล้วเงียบไปเลย
    if (body?.code !== 0) {
      throw new Error(`ksher ถามสถานะไม่สำเร็จ: ${body?.msg || `http ${httpCode}`}`);
    }

    return {
      status: mapKsherStatus(body?.data?.result),
      // Ksher ไม่ได้บอกค่าธรรมเนียมที่หักไปในคำตอบนี้ ระบบจึงคิดจากอัตราที่ตั้งไว้ใน config แทน
      providerFeeBaht: null,
      raw: body,
    };
  },
};
