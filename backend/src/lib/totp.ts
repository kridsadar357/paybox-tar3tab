// ตรวจรหัส TOTP 6 หลัก — ใช้ร่วมกันทั้งฝั่งลูกค้าและฝั่งแอดมิน
//
// เดิมฟังก์ชันนี้อยู่ใน routes/customerAccount.ts แล้ว routes อื่นต้อง import ข้ามมาจากที่นั่น
// ย้ายมาไว้ตรงกลางตอนเพิ่ม 2FA ให้แอดมิน เพื่อไม่ให้ route ฝั่งแอดมินต้องพึ่ง route ฝั่งลูกค้า
import { generateSecret, generateURI, verifySync } from 'otplib';

export const TOTP_ISSUER = 'PayBox';

/** ยอมให้คลาดได้ 1 ช่วงเวลา (±30 วิ) — นาฬิกามือถือกับเซิร์ฟเวอร์ไม่ตรงกันเป๊ะเป็นเรื่องปกติ
 *  otplib v13 ใช้ counterTolerance แทน window ของ v12 และคืนค่าเป็น { valid, delta } */
export function checkTotp(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  try {
    return verifySync({ token, secret, counterTolerance: 1 }).valid;
  } catch {
    return false;
  }
}

export { generateSecret, generateURI };
