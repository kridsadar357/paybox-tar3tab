// เครื่องมือทดสอบสร้าง QR PromptPay ผ่าน Payso
//
// เป็นของเล่นแยกต่างหาก ไม่ได้ต่อกับระบบจริงและไม่แตะฐานข้อมูล ใช้ดูว่า API ของ Payso
// ตอบอะไรกลับมาจริงๆ ก่อนจะเอาไปเขียนเป็นผู้ให้บริการตัวที่สองในระบบ
//
//   node tools/payso-test/server.mjs
//   เปิด http://127.0.0.1:8787
//
// ทำไมต้องมีเซิร์ฟเวอร์ ไม่ยิงจากเบราว์เซอร์ตรงๆ: Payso ต้องใช้ Bearer token ซึ่งเป็นความลับ
// ถ้ายิงจากหน้าเว็บ token จะอยู่ในเครื่องลูกค้า และ Payso ก็ไม่ได้เปิด CORS ให้อยู่แล้ว
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const ENDPOINT = 'https://apis.paysolutions.asia/tep/api/v2/promptpaynew';

// ค่าเริ่มต้นจาก environment เพื่อไม่ต้องพิมพ์ใหม่ทุกครั้ง แต่กรอกทับในหน้าเว็บได้
const DEFAULTS = {
  merchantID: process.env.PAYSO_MERCHANT_ID || '',
  token: process.env.PAYSO_TOKEN || '',
};

/** ข้อจำกัดตามเอกสารของ Payso — ดักที่นี่ก่อนเพื่อให้เห็นสาเหตุชัดกว่ารอ error จากปลายทาง */
function validate(p) {
  const errs = [];
  if (!/^\d{8}$/.test(p.merchantID)) errs.push('merchantID ต้องเป็นตัวเลข 8 หลัก');
  if (!p.token) errs.push('ยังไม่ได้ใส่ Bearer token');
  if (!/^\d{12}$/.test(p.referenceNo)) errs.push('referenceNo ต้องเป็นตัวเลข 12 หลักและห้ามซ้ำกับที่เคยส่ง');
  const total = Number(p.total);
  if (!Number.isFinite(total) || total < 6) errs.push('total ต้องเป็นตัวเลขและไม่ต่ำกว่า 6 บาท');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.customerEmail)) errs.push('customerEmail รูปแบบไม่ถูกต้อง');
  if (!p.customerName) errs.push('ยังไม่ได้ใส่ customerName');
  if (!p.productDetail) errs.push('ยังไม่ได้ใส่ productDetail');
  return errs;
}

async function createQr(p) {
  const qs = new URLSearchParams({
    merchantID: p.merchantID,
    productDetail: p.productDetail,
    customerEmail: p.customerEmail,
    customerName: p.customerName,
    total: Number(p.total).toFixed(2),
    referenceNo: p.referenceNo,
  });
  const url = `${ENDPOINT}?${qs}`;
  const started = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { _parseError: 'ตอบกลับมาไม่ใช่ JSON', _raw: raw.slice(0, 800) };
  }

  // ส่ง URL กลับไปให้ดูด้วย แต่ตัด token ออก — มันอยู่ใน header ไม่ใช่ query จึงปลอดภัยอยู่แล้ว
  return { httpStatus: res.status, ms: Date.now() - started, requestUrl: url, body };
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const html = readFileSync(join(DIR, 'index.html'), 'utf8')
      .replace('__DEFAULTS__', JSON.stringify(DEFAULTS));
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
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errors: ['ส่งข้อมูลมาไม่ถูกรูปแบบ'] }));
    }

    const errs = validate(p);
    if (errs.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errors: errs }));
    }

    try {
      const out = await createQr(p);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'หมดเวลารอ 20 วินาที' : String(err?.message || err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errors: [`ติดต่อ Payso ไม่ได้: ${why}`] }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ไม่มีหน้านี้');
});

// ผูกกับ 127.0.0.1 อย่างเดียว ไม่ให้เครื่องอื่นในเครือข่ายยิงเข้ามาใช้ token ของเรา
server.listen(PORT, '127.0.0.1', () => {
  console.log(`ทดสอบ Payso PromptPay: http://127.0.0.1:${PORT}`);
  if (!DEFAULTS.merchantID || !DEFAULTS.token) {
    console.log('ตั้ง PAYSO_MERCHANT_ID กับ PAYSO_TOKEN ไว้ก่อนได้ จะได้ไม่ต้องพิมพ์ใหม่ทุกครั้ง');
  }
});
