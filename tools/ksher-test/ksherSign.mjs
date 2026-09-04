// การเซ็นลายเซ็นของ Ksher
//
// แยกออกมาเป็นไฟล์เดียวที่ไม่ยุ่งกับเครือข่าย เพื่อให้เทสต์ได้โดยไม่ต้องมีบัญชีจริง —
// นี่เป็นส่วนที่พลาดง่ายที่สุดและพลาดแล้วจะได้แค่ error กว้างๆ กลับมาโดยไม่บอกว่าผิดตรงไหน
//
// วิธีตามเอกสาร: เรียงชื่อพารามิเตอร์ตาม ASCII (ไม่รวม sign) ต่อกันเป็น key=value ติดกันไป
// โดยไม่มีตัวคั่น แล้วเซ็นด้วย RSA-MD5 ด้วยกุญแจส่วนตัวของร้านค้า ผลลัพธ์เป็นเลขฐานสิบหก
import crypto from 'crypto';

/**
 * ประกอบสตริงที่จะเอาไปเซ็น
 *
 * ไม่ใส่ค่าที่ว่างเข้าไป เพราะพารามิเตอร์ที่ไม่ได้ส่งก็ไม่ควรอยู่ในลายเซ็น —
 * ถ้าใส่เข้าไปแล้วฝั่ง Ksher ไม่ได้ใส่ ลายเซ็นจะไม่ตรงกันทันที
 */
export function buildSignString(params) {
  const list = [];
  for (const k of Object.keys(params).sort()) {
    if (k === 'sign') continue;
    const v = params[k];
    if (v === undefined || v === null) continue;
    // ค่าที่ไม่ใช่ข้อความหรือตัวเลขถูกแปลงเป็น JSON แบบไม่เว้นวรรค ตามที่ SDK ทางการทำ
    list.push(k + '=' + (typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)));
  }
  // เรียงอีกรอบที่ระดับสตริง ไม่ใช่แค่ที่ระดับชื่อคีย์ — SDK ทำสองชั้นแบบนี้
  list.sort();
  return list.join('');
}

/** เซ็นด้วยกุญแจส่วนตัวของร้านค้า ได้ผลเป็นเลขฐานสิบหก */
export function sign(params, privateKeyPem) {
  const signer = crypto.createSign('RSA-MD5');
  signer.update(buildSignString(params), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'hex');
}

/**
 * ตรวจลายเซ็นของคำตอบจาก Ksher
 *
 * จุดที่พลาดง่าย: ลายเซ็นครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response —
 * ถ้าเอาทั้งก้อนไปตรวจจะไม่ผ่านเสมอ ยืนยันกับคำตอบจริงแล้วว่าเป็นแบบนี้
 */
export function verifyResponse(response, publicKeyPem) {
  if (!response || !response.sign || !response.data) return false;
  return verify(response.data, response.sign, publicKeyPem);
}

/** ตรวจลายเซ็นของอ็อบเจกต์ใดๆ ด้วยกุญแจสาธารณะ */
export function verify(params, signatureHex, publicKeyPem) {
  const verifier = crypto.createVerify('RSA-MD5');
  verifier.update(buildSignString(params), 'utf8');
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, signatureHex, 'hex');
  } catch {
    return false;
  }
}

/** เวลาในรูปแบบที่ Ksher ต้องการ: yyyyMMddHHmmss ตามเวลาเครื่อง */
export function timeStamp(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

/** สตริงสุ่มสำหรับ nonce_str — เอกสารบอกว่าต้องไม่ซ้ำในแต่ละคำขอ */
export function nonce(len = 32) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

/**
 * แปลงจำนวนเงินบาทเป็นหน่วยย่อยที่ Ksher ใช้
 *
 * เอกสารระบุว่า total_fee เป็นจำนวนเต็มหน่วยย่อยที่สุด — 150.50 บาท ส่งเป็น 15050
 * ต่างจาก Payso ที่ส่งเป็นบาททศนิยมสองตำแหน่ง ถ้าสลับกันจะจ่ายผิดร้อยเท่า
 *
 * รับได้ถึงทศนิยมสองตำแหน่งซึ่งเป็นความละเอียดที่สุดของเงินบาทอยู่แล้ว ถ้าใส่มากกว่านั้น
 * จะถูกปัดตามที่ทศนิยมลอยตัวทำได้ ไม่ควรพึ่งพาผลลัพธ์ในกรณีนั้น
 */
export function baht(amount) {
  return Math.round(Number(amount) * 100);
}
