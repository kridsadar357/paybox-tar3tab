// Ksher — Native Pay (C scan B)
//
// เซ็นทุกคำขอด้วย RSA-MD5 ด้วยกุญแจส่วนตัวของร้านค้า: เรียงชื่อพารามิเตอร์ ทำเป็น key=value
// เรียงสตริงอีกรอบ ต่อกันโดยไม่มีตัวคั่น แล้วเซ็น ผลลัพธ์เป็นเลขฐานสิบหก
//
// ลายเซ็นที่ Ksher ส่งกลับมาครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response — เอาทั้งก้อนไปตรวจ
// จะไม่ผ่านเสมอ ยืนยันกับคำตอบจริงมาแล้ว
import crypto from 'crypto';
import { config } from '../../config';
import {
  ChargeResult, NormalizedStatus, PaymentProvider, ProviderNotConfiguredError, StatusResult,
} from './types';

const CREATE_URL = 'https://api.mch.ksher.net/KsherPay/native_pay';
const QUERY_URL = 'https://api.mch.ksher.net/KsherPay/order_query';
const CHANNEL = 'promptpay';
const TIMEOUT_MS = 20_000;

/** กุญแจสาธารณะของ Ksher เป็นค่าเดียวกันทุกร้านค้า มาพร้อม SDK ทางการ (@kshersolution/ksher, ISC) */
const KSHER_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MEgCQQC+/eeTgrjeCPHmDS/5osWViFyIAryFRIr5canaYhz3Di3UNkT0sf6TkabF
LvxPcM9JmEtj2O4TXNpgYATkE/sFAgMBAAE=
-----END RSA PUBLIC KEY-----
`;

/** ประกอบสตริงที่จะเซ็น — ตัดเฉพาะคีย์ sign และค่าที่ไม่ได้ส่งจริง แล้วเรียงสองชั้นตาม SDK */
export function buildSignString(params: Record<string, unknown>): string {
  const list: string[] = [];
  for (const k of Object.keys(params).sort()) {
    if (k === 'sign') continue;
    const v = params[k];
    if (v === undefined || v === null) continue;
    list.push(k + '=' + (typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)));
  }
  list.sort();
  return list.join('');
}

function signParams(params: Record<string, unknown>, privateKeyPem: string): string {
  const signer = crypto.createSign('RSA-MD5');
  signer.update(buildSignString(params), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'hex');
}

/** ตรวจว่าคำตอบมาจาก Ksher จริง — ลายเซ็นครอบแค่ก้อน data */
export function verifyResponse(body: any): boolean {
  if (!body?.sign || !body?.data) return false;
  const verifier = crypto.createVerify('RSA-MD5');
  verifier.update(buildSignString(body.data), 'utf8');
  verifier.end();
  try {
    return verifier.verify(KSHER_PUBLIC_KEY, body.sign, 'hex');
  } catch {
    return false;
  }
}

function timeStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

function nonce(len = 32): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

/** Ksher รับยอดเป็นจำนวนเต็มหน่วยสตางค์ — ต่างจาก Stripe ที่ก็เป็นสตางค์เหมือนกัน แต่ Payso เป็นบาท */
function toSatang(baht: number): number {
  return Math.round(baht * 100);
}

/** แปลงสถานะของ Ksher มาเป็นชุดคำที่ระบบใช้ภายใน */
const STATUS_MAP: Record<string, NormalizedStatus> = {
  SUCCESS: 'succeeded',
  NOTPAY: 'requires_action',
  USERPAYING: 'processing',
  PENDING: 'processing',
  PAYERROR: 'failed',
  FAIL: 'failed',
  CLOSED: 'canceled',
  REFUND: 'refunded',
  NOTSURE: 'unknown',
};

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
    const { body } = await post(QUERY_URL, params, config.ksher.privateKey);
    const result = body?.data?.result;
    return {
      status: (result && STATUS_MAP[result]) || 'unknown',
      // Ksher ไม่ได้บอกค่าธรรมเนียมที่หักไปในคำตอบนี้ ระบบจึงคิดจากอัตราที่ตั้งไว้ใน config แทน
      providerFeeBaht: null,
      raw: body,
    };
  },
};
