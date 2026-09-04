// พิสูจน์ว่าการเซ็นลายเซ็นถูกต้องตามเอกสาร โดยไม่ต้องมีบัญชี Ksher จริง
//   node tools/ksher-test/sign.test.mjs
import crypto from 'crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSignString, sign, verify, verifyResponse, timeStamp, nonce, baht } from './ksherSign.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));

let fail = 0;
const ok = (name, cond) => { console.log((cond ? '  ผ่าน  ' : '  ไม่ผ่าน ') + name); if (!cond) fail++; };

// ตัวอย่างจริงจากเอกสารของ Ksher
const example = {
  appid: 'mch20163', channel: 'wechat', fee_type: 'THB', img_type: 'svg',
  mch_order_no: '1495773587', nonce_str: 'sQ8gfSpeeV5Ld8ulW9q7JxUnXSOiZ90Y',
  notify_url: 'http://www.yoursweb.com/notify', time_stamp: '20170526113947',
  total_fee: 10, version: '1.0.0',
  sign: 'ไม่ควรถูกนับ',
};
const s = buildSignString(example);
ok('ไม่มี sign อยู่ในสตริง', !s.includes('ไม่ควรถูกนับ') && !s.includes('sign='));
ok('เรียงตาม ASCII (appid มาก่อน channel)', s.indexOf('appid=') < s.indexOf('channel='));
ok('เรียงตาม ASCII (version อยู่ท้าย)', s.endsWith('version=1.0.0'));
ok('ต่อกันโดยไม่มีตัวคั่น', s.startsWith('appid=mch20163channel=wechat'));
ok('ไม่มีเครื่องหมาย & หรือ ,', !s.includes('&') && !s.includes(','));

// ค่าว่างยังอยู่ในลายเซ็น ตามที่ SDK ทางการทำ — ตัดออกเฉพาะ null/undefined ที่ไม่ได้ส่งจริง
// (เดิมผมตัดค่าว่างทิ้งด้วย ซึ่งไม่ตรงกับ SDK)
ok('เก็บค่าว่าง ตัดเฉพาะที่ไม่มีค่า', buildSignString({ a: '1', b: '', c: null, d: undefined }) === 'a=1b=');
ok('อ็อบเจกต์ถูกแปลงเป็น JSON ไม่เว้นวรรค', buildSignString({ z: { k: 1 } }) === 'z={"k":1}');

// เซ็นแล้วตรวจกลับได้ ด้วยคู่กุญแจที่สร้างขึ้นเอง
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const sig = sign(example, privateKey);
ok('ลายเซ็นเป็นเลขฐานสิบหก', /^[0-9a-f]+$/.test(sig));
ok('ยาว 512 ตัว (RSA 2048 บิต)', sig.length === 512);
ok('ตรวจกลับด้วยกุญแจสาธารณะผ่าน', verify(example, sig, publicKey));
ok('แก้ข้อมูลแล้วตรวจไม่ผ่าน', !verify({ ...example, total_fee: 999 }, sig, publicKey));
ok('ลายเซ็นมั่วตรวจไม่ผ่าน', !verify(example, 'ab'.repeat(256), publicKey));

// แปลงหน่วยเงิน — จุดที่ต่างจาก Payso และพลาดแล้วผิดร้อยเท่า
ok('150.50 บาท -> 15050', baht(150.5) === 15050);
ok('6 บาท -> 600', baht(6) === 600);
ok('0.01 บาท -> 1', baht(0.01) === 1);
ok('ยอดทศนิยมสองตำแหน่งแปลงตรงเป๊ะ', baht(19.99) === 1999 && baht(0.99) === 99 && baht(1234.56) === 123456);
// ยอดที่มีทศนิยมเกินสองตำแหน่งไม่ใช่จำนวนเงินที่มีจริง (บาทมีแค่สตางค์) และ 1.005 * 100
// ในทศนิยมลอยตัวได้ 100.4999... จึงปัดลงเสมอ ยืนยันไว้ให้เห็นว่าเป็นพฤติกรรมที่รู้อยู่แล้ว
ok('ทศนิยมเกินสองตำแหน่งให้ผลแน่นอนไม่สุ่ม', baht(1.005) === 100 && baht(1.005) === baht(1.005));

ok('time_stamp เป็น yyyyMMddHHmmss', /^\d{14}$/.test(timeStamp(new Date(2026, 8, 4, 19, 5, 3))));
ok('time_stamp เติมศูนย์หน้า', timeStamp(new Date(2026, 0, 2, 3, 4, 5)) === '20260102030405');
ok('nonce ยาว 32 และไม่ซ้ำ', nonce().length === 32 && nonce() !== nonce());


// ตรวจลายเซ็นของคำตอบจาก Ksher — จุดที่เคยทำผิดมาแล้ว
// ลายเซ็นครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response ถ้าเอาทั้งก้อนไปตรวจจะไม่ผ่านเสมอ
//
// ไฟล์ตัวอย่างไม่ได้อยู่ใน git เพราะ payload ของ QR มี Biller ID ซึ่งมีเลขผู้เสียภาษีของร้าน
// อยู่ข้างใน สร้างเองได้ด้วยการยิงหนึ่งครั้งแล้วเซฟ body ที่ได้ลง sample_response.json
const samplePath = join(HERE, 'sample_response.json');
const pub = readFileSync(join(HERE, 'ksher_pubkey.pem'), 'utf8');
if (!existsSync(samplePath)) {
  console.log('  ข้าม   ตรวจลายเซ็นคำตอบจริง (ยังไม่มี sample_response.json)');
} else {
  const real = JSON.parse(readFileSync(samplePath, 'utf8'));
  ok('ตรวจลายเซ็นคำตอบจริงของ Ksher ผ่าน', verifyResponse(real, pub) === true);
  ok('แก้ยอดเงินในคำตอบแล้วลายเซ็นต้องไม่ผ่าน',
    verifyResponse({ ...real, data: { ...real.data, total_fee: 999999 } }, pub) === false);
  ok('เอาทั้ง response ไปตรวจต้องไม่ผ่าน (ที่ถูกคือตรวจแค่ data)',
    verify(real, real.sign, pub) === false);
}

console.log(fail === 0 ? '\nผ่านทั้งหมด' : `\nไม่ผ่าน ${fail} ข้อ`);
process.exit(fail ? 1 : 0);
