// เครื่องมือทดสอบสร้าง QR ผ่าน Ksher (Native Pay / C scan B)
//
// แยกจากระบบจริง ไม่แตะฐานข้อมูล ใช้ดูว่า Ksher ตอบอะไรกลับมาก่อนจะเขียนเป็นผู้ให้บริการ
// ตัวที่สองในระบบ
//
//   node tools/ksher-test/server.mjs   แล้วเปิด http://127.0.0.1:8788
//
// ต้องมีเซิร์ฟเวอร์คั่นเพราะการเซ็นต้องใช้กุญแจส่วนตัวของร้านค้า ซึ่งห้ามอยู่ในเบราว์เซอร์เด็ดขาด
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sign, verifyResponse, timeStamp, nonce, baht, buildSignString } from './ksherSign.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const ENDPOINT = 'https://api.mch.ksher.net/KsherPay/native_pay';
const QUERY_ENDPOINT = 'https://api.mch.ksher.net/KsherPay/order_query';

function readLocalEnv() {
  // .env.local ถูก .gitignore กันไว้ — ห้ามเอากุญแจจริงใส่ไฟล์ที่ commit
  try {
    const out = {};
    let key = null;
    for (const line of readFileSync(join(DIR, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (m) {
        key = m[1];
        out[key] = m[2];
      } else if (key && line.length) {
        // กุญแจ PEM กินหลายบรรทัด ต่อบรรทัดถัดไปเข้ากับคีย์ล่าสุด
        out[key] += '\n' + line;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const LOCAL = readLocalEnv();
const PRIVATE_KEY = process.env.KSHER_PRIVATE_KEY || LOCAL.KSHER_PRIVATE_KEY || '';
// กุญแจสาธารณะของ Ksher เป็นค่าเดียวกันทุกร้านค้า แจกมาพร้อม SDK ทางการ (@kshersolution/ksher)
// merchant ไม่ต้องไปหามาเอง จึงเก็บไว้ในโฟลเดอร์นี้เลย
const PUBLIC_KEY = (() => {
  try {
    return readFileSync(join(DIR, 'ksher_pubkey.pem'), 'utf8');
  } catch {
    return process.env.KSHER_PUBLIC_KEY || LOCAL.KSHER_PUBLIC_KEY || '';
  }
})();
const DEFAULTS = {
  appid: process.env.KSHER_APPID || LOCAL.KSHER_APPID || '',
  hasPrivateKey: Boolean(PRIVATE_KEY),
  hasPublicKey: Boolean(PUBLIC_KEY),
};

function validate(p) {
  const errs = [];
  if (!/^mch\d+$/.test(p.appid)) errs.push('appid ต้องอยู่ในรูป mch ตามด้วยตัวเลข เช่น mch20163');
  if (!PRIVATE_KEY) errs.push('ยังไม่ได้ใส่กุญแจส่วนตัวใน tools/ksher-test/.env.local');
  if (!p.mch_order_no || p.mch_order_no.length > 32) errs.push('เลขที่สั่งซื้อต้องมีและยาวไม่เกิน 32 ตัว');
  const amt = Number(p.amountBaht);
  if (!Number.isFinite(amt) || amt <= 0) errs.push('จำนวนเงินต้องมากกว่า 0');
  if (!p.channel) errs.push('ยังไม่ได้เลือกช่องทาง');
  return errs;
}

async function createQr(p) {
  // พารามิเตอร์ที่จะถูกเซ็น — sign ไม่รวมอยู่ในนั้น
  const params = {
    appid: p.appid,
    channel: p.channel,
    fee_type: 'THB',
    img_type: p.img_type || 'png',
    mch_order_no: p.mch_order_no,
    nonce_str: nonce(),
    time_stamp: timeStamp(),
    total_fee: baht(p.amountBaht),
    version: '2.0.0',
  };
  if (p.notify_url) params.notify_url = p.notify_url;
  if (p.expire_time) params.expire_time = Number(p.expire_time);

  const signString = buildSignString(params);
  const body = new URLSearchParams({ ...params, sign: sign(params, PRIVATE_KEY) });

  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(25000),
  });

  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { _parseError: 'ตอบกลับมาไม่ใช่ JSON', _raw: raw.slice(0, 800) };
  }

  // ลายเซ็นครอบแค่ก้อน data ข้างใน ไม่ใช่ทั้ง response
  let signOk = null;
  if (PUBLIC_KEY && parsed && parsed.sign && parsed.data) {
    signOk = verifyResponse(parsed, PUBLIC_KEY);
  }

  return {
    httpStatus: res.status,
    ms: Date.now() - started,
    sentParams: params,
    signString: signString.length > 400 ? signString.slice(0, 400) + '…' : signString,
    responseSignatureValid: signOk,
    body: parsed,
  };
}

async function queryOrder(p) {
  const params = {
    appid: p.appid,
    channel: p.channel,
    mch_order_no: p.mch_order_no,
    nonce_str: nonce(),
    time_stamp: timeStamp(),
    version: '2.0.0',
  };
  const body = new URLSearchParams({ ...params, sign: sign(params, PRIVATE_KEY) });
  const res = await fetch(QUERY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { _parseError: 'ตอบกลับมาไม่ใช่ JSON', _raw: raw.slice(0, 400) };
  }
  let signOk = null;
  if (PUBLIC_KEY && parsed && parsed.sign && parsed.data) signOk = verifyResponse(parsed, PUBLIC_KEY);
  return { httpStatus: res.status, responseSignatureValid: signOk, body: parsed };
}

const server = createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const html = readFileSync(join(DIR, 'index.html'), 'utf8').replace('__DEFAULTS__', JSON.stringify(DEFAULTS));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'POST' && req.url === '/create') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      return json(400, { errors: ['ส่งข้อมูลมาไม่ถูกรูปแบบ'] });
    }
    const errs = validate(p);
    if (errs.length) return json(400, { errors: errs });
    try {
      return json(200, await createQr(p));
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'หมดเวลารอ 25 วินาที' : String(err?.message || err);
      return json(502, { errors: [`ติดต่อ Ksher ไม่ได้: ${why}`] });
    }
  }

  if (req.method === 'POST' && req.url === '/query') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      return json(400, { errors: ['ส่งข้อมูลมาไม่ถูกรูปแบบ'] });
    }
    if (!PRIVATE_KEY) return json(400, { errors: ['ยังไม่ได้ใส่กุญแจส่วนตัว'] });
    if (!p.mch_order_no) return json(400, { errors: ['ไม่มีเลขที่สั่งซื้อให้ถาม'] });
    try {
      return json(200, await queryOrder(p));
    } catch (err) {
      return json(502, { errors: ['ถามสถานะไม่สำเร็จ: ' + String(err?.message || err)] });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ไม่มีหน้านี้');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ทดสอบ Ksher Native Pay: http://127.0.0.1:${PORT}`);
  if (!DEFAULTS.hasPrivateKey) console.log('ยังไม่มีกุญแจส่วนตัว — ใส่ KSHER_PRIVATE_KEY ใน tools/ksher-test/.env.local');
});
