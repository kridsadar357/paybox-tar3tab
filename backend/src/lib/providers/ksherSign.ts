// ตรรกะบริสุทธิ์ของ Ksher — เซ็นลายเซ็น แปลงสถานะ แปลงหน่วยเงิน
//
// แยกออกจาก ksher.ts ที่ import config เพราะ config เรียก process.exit เมื่อ env ไม่ครบ
// ไฟล์ไหนที่ import มันจึงเทสต์ไม่ได้เลย ตรรกะที่สำคัญที่สุดจึงต้องอยู่ในไฟล์ที่ไม่พึ่งอะไรเลย
import crypto from 'crypto';
import { NormalizedStatus } from './types';

/** กุญแจสาธารณะของ Ksher เป็นค่าเดียวกันทุกร้านค้า มาพร้อม SDK ทางการ (@kshersolution/ksher, ISC) */
export const KSHER_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MEgCQQC+/eeTgrjeCPHmDS/5osWViFyIAryFRIr5canaYhz3Di3UNkT0sf6TkabF
LvxPcM9JmEtj2O4TXNpgYATkE/sFAgMBAAE=
-----END RSA PUBLIC KEY-----
`;

/**
 * ประกอบสตริงที่จะเซ็น
 *
 * เรียงชื่อคีย์ ตัดเฉพาะ sign ทำเป็น key=value แล้วเรียงสตริงอีกชั้นก่อนต่อกันโดยไม่มีตัวคั่น
 * เรียงสองชั้นตามที่ SDK ทางการทำ ไม่ตัดค่าว่างทิ้ง ตัดเฉพาะค่าที่ไม่ได้ส่งจริง
 */
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

export function signParams(params: Record<string, unknown>, privateKeyPem: string): string {
  const signer = crypto.createSign('RSA-MD5');
  signer.update(buildSignString(params), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'hex');
}

/**
 * ตรวจว่าคำตอบมาจาก Ksher จริง
 *
 * ลายเซ็นครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response — เอาทั้งก้อนไปตรวจจะไม่ผ่านเสมอ
 * ยืนยันกับคำตอบจริงมาแล้ว
 */
export function verifyResponse(body: any, publicKeyPem = KSHER_PUBLIC_KEY): boolean {
  if (!body?.sign || !body?.data) return false;
  const verifier = crypto.createVerify('RSA-MD5');
  verifier.update(buildSignString(body.data), 'utf8');
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, body.sign, 'hex');
  } catch {
    return false;
  }
}

export const STATUS_MAP: Record<string, NormalizedStatus> = {
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

/**
 * แปลงคำที่ Ksher ใช้มาเป็นคำที่ระบบใช้ภายใน
 *
 * คำที่ไม่รู้จักต้องเป็น unknown เสมอ ไม่ใช่เดาว่าล้มเหลว เพราะ applyProviderStatus จะไม่แตะ
 * ฐานข้อมูลเมื่อได้ unknown — ปลอดภัยกว่าการเดาผิดแล้วทิ้งรายการที่จ่ายจริง
 */
export function mapKsherStatus(result: string | null | undefined): NormalizedStatus {
  if (!result) return 'unknown';
  return STATUS_MAP[result] ?? 'unknown';
}

export function timeStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

export function nonce(len = 32): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

/**
 * Ksher รับยอดเป็นจำนวนเต็มหน่วยสตางค์ — 150.50 บาท ส่งเป็น 15050
 *
 * รับได้ถึงทศนิยมสองตำแหน่งซึ่งเป็นความละเอียดที่สุดของเงินบาทอยู่แล้ว
 */
export function toSatang(baht: number): number {
  return Math.round(Number(baht) * 100);
}
