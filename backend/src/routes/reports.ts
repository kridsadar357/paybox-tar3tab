// ทดแทน admin_reports.php — สรุป P&L รายวัน, อุปกรณ์สูงสุด/ต่ำสุด, แยกตามภาค/จังหวัด, แผนที่ Leaflet
// เก็บเป็นหน้า HTML server-rendered เหมือนเดิม (ฝัง iframe ใน paybox-control ได้เหมือนตอนเป็น PHP)
import { Router } from 'express';
import { pool } from '../db';
import { requireAdmin } from '../middleware/auth';
import { toCsv, sendCsv } from '../lib/csv';

export const reportsRouter = Router();

// วันที่ตามเวลาไทย — container รันบน UTC แต่ผู้ใช้อยู่ไทย (+7) การจัดกลุ่มด้วย DATE() ตรงๆ
// ผลักรายการที่เกิดช่วง 00:00–07:00 ตามเวลาไทยไปอยู่ในถังของ "เมื่อวาน" (ตรวจกับข้อมูลจริงแล้ว
// พบว่ากระทบ 2 จาก 10 รายการที่สำเร็จ) ไทยไม่มี DST ออฟเซ็ต +7 จึงคงที่ตลอดปี ใช้ DATE_ADD ได้
// โดยไม่ต้องพึ่งตาราง timezone ของ MySQL ที่อาจไม่ได้ถูกโหลด
const THAI_DATE = (col: string) => `DATE(DATE_ADD(${col}, INTERVAL 7 HOUR))`;
reportsRouter.use(requireAdmin);

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function deviceLabel(r: any): string {
  let label = r.name;
  if (r.shop_name && r.shop_name !== r.name && r.shop_name !== '357 PAYBOX') {
    label += ` (${r.shop_name})`;
  }
  return label;
}

function fmt(n: any): string {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// ดาวน์โหลดรายงานเป็น CSV — สองไฟล์ให้เลือกตามที่จะเอาไปใช้: รายวัน (ดูแนวโน้ม/กระทบยอด)
// และรายเครื่อง (ดูว่าเครื่องไหนทำเงิน) ใช้ช่วงวันที่และ query ชุดเดียวกับหน้ารายงาน
// อยู่หลัง reportsRouter.use(requireAdmin) ที่ประกาศไว้ด้านบนแล้ว
// ---------------------------------------------------------------------------
reportsRouter.get('/export.csv', async (req, res) => {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from as string) ? (req.query.from as string) : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to as string) ? (req.query.to as string) : today;
  const kind = req.query.kind === 'devices' ? 'devices' : 'daily';

  if (kind === 'devices') {
    const [rows] = await pool.query(
      `SELECT d.name, d.shop_name, d.region_zone, d.province,
              COALESCE(c.name, '') AS customer_name,
              COUNT(t.id) AS tx_count, COALESCE(SUM(t.amount),0) AS total_amount,
              COALESCE(SUM(t.fee_amount),0) AS total_fee, COALESCE(SUM(t.stripe_fee_amount),0) AS total_stripe_fee,
              COALESCE(SUM(t.profit_amount),0) AS total_profit
       FROM devices d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded'
            AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
       GROUP BY d.id ORDER BY total_amount DESC`,
      [from, to]
    );
    const csv = toCsv(
      ['อุปกรณ์', 'ชื่อร้าน', 'ภาค', 'จังหวัด', 'เจ้าของ', 'จำนวนรายการ', 'ยอดรับชำระ', 'ค่าธรรมเนียมลูกค้า', 'ค่าธรรมเนียม Stripe', 'กำไรแพลตฟอร์ม'],
      (rows as any[]).map((r) => [
        r.name,
        r.shop_name || '',
        r.region_zone || '',
        r.province || '',
        r.customer_name,
        r.tx_count,
        Number(r.total_amount).toFixed(2),
        Number(r.total_fee).toFixed(2),
        Number(r.total_stripe_fee).toFixed(2),
        Number(r.total_profit).toFixed(2),
      ])
    );
    return sendCsv(res, `paybox-report-devices-${from}-${to}.csv`, csv);
  }

  const [rows] = await pool.query(
    `SELECT ${THAI_DATE('created_at')} AS day, COUNT(*) AS tx_count,
            COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(fee_amount),0) AS total_fee,
            COALESCE(SUM(stripe_fee_amount),0) AS total_stripe_fee,
            COALESCE(SUM(profit_amount),0) AS total_profit,
            COALESCE(SUM(net_amount),0) AS total_net
     FROM transactions
     WHERE status = 'succeeded' AND ${THAI_DATE('created_at')} BETWEEN ? AND ?
     GROUP BY ${THAI_DATE('created_at')} ORDER BY day ASC`,
    [from, to]
  );
  const dayText = (v: any) => {
    if (v instanceof Date) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v).slice(0, 10);
  };
  const csv = toCsv(
    ['วันที่ (เวลาไทย)', 'จำนวนรายการ', 'ยอดรับชำระ', 'ค่าธรรมเนียมลูกค้า', 'ค่าธรรมเนียม Stripe', 'กำไรแพลตฟอร์ม', 'ยอดสุทธิถึงร้านค้า'],
    (rows as any[]).map((r) => [
      dayText(r.day),
      r.tx_count,
      Number(r.total_amount).toFixed(2),
      Number(r.total_fee).toFixed(2),
      Number(r.total_stripe_fee).toFixed(2),
      Number(r.total_profit).toFixed(2),
      Number(r.total_net).toFixed(2),
    ])
  );
  sendCsv(res, `paybox-report-daily-${from}-${to}.csv`, csv);
});

// ---------------------------------------------------------------------------
// JSON endpoint สำหรับหน้ารายงานที่เขียนใหม่เป็น React (แทน HTML ที่เรนเดอร์จากเซิร์ฟเวอร์ใน iframe)
// ใช้ query ชุดเดียวกับหน้า HTML เดิมทุกประการ + เพิ่มยอดรายวันไว้ทำกราฟแนวโน้ม
// ---------------------------------------------------------------------------
reportsRouter.get('/data', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from as string) ? (req.query.from as string) : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to as string) ? (req.query.to as string) : today;

  const [summaryRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(fee_amount),0) AS total_fee,
            COALESCE(SUM(stripe_fee_amount),0) AS total_stripe_fee, COALESCE(SUM(profit_amount),0) AS total_profit,
            COALESCE(SUM(net_amount),0) AS total_net
     FROM transactions WHERE status = 'succeeded' AND ${THAI_DATE('created_at')} BETWEEN ? AND ?`,
    [from, to]
  );

  // แนวโน้มรายวัน — หน้ารายงาน P&L ต้องเห็นทิศทาง ไม่ใช่แค่ยอดรวมก้อนเดียว
  const [dailyRows] = await pool.query(
    `SELECT ${THAI_DATE('created_at')} AS day, COUNT(*) AS tx_count,
            COALESCE(SUM(amount),0) AS total_amount,
            COALESCE(SUM(profit_amount),0) AS total_profit
     FROM transactions
     WHERE status = 'succeeded' AND ${THAI_DATE('created_at')} BETWEEN ? AND ?
     GROUP BY ${THAI_DATE('created_at')} ORDER BY day ASC`,
    [from, to]
  );

  const [deviceRows] = (await pool.query(
    `SELECT d.id, d.name, d.shop_name, d.region_zone, d.province, d.lat, d.lng,
            COALESCE(c.name, '— ไม่มีเจ้าของ —') AS customer_name,
            COUNT(t.id) AS tx_count, COALESCE(SUM(t.amount),0) AS total_amount,
            COALESCE(SUM(t.fee_amount),0) AS total_fee, COALESCE(SUM(t.stripe_fee_amount),0) AS total_stripe_fee,
            COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN customers c ON c.id = d.customer_id
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY d.id
     ORDER BY total_amount DESC`,
    [from, to]
  )) as any;

  const [regionRows] = await pool.query(
    `SELECT COALESCE(d.region_zone, 'ไม่ระบุ') AS region_zone, COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.amount),0) AS total_amount, COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY region_zone HAVING tx_count > 0 ORDER BY total_amount DESC`,
    [from, to]
  );

  const [provinceRows] = await pool.query(
    `SELECT COALESCE(d.province, 'ไม่ระบุ') AS province, COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.amount),0) AS total_amount, COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY province HAVING tx_count > 0 ORDER BY total_amount DESC`,
    [from, to]
  );

  const active = (deviceRows as any[]).filter((r) => Number(r.tx_count) > 0);

  res.json({
    success: true,
    range: { from, to },
    summary: (summaryRows as any[])[0],
    daily: dailyRows,
    devices: deviceRows,
    top_device: active[0] || null,
    bottom_device: active.length > 0 ? active[active.length - 1] : null,
    regions: regionRows,
    provinces: provinceRows,
    map_points: (deviceRows as any[])
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        name: deviceLabel(r),
        customer: r.customer_name,
        total_amount: Number(r.total_amount),
        tx_count: Number(r.tx_count),
      })),
  });
});

reportsRouter.get('/', async (req, res) => {
  const adminPassword = (req.query.admin_password as string) || '';
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from as string) ? (req.query.from as string) : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to as string) ? (req.query.to as string) : today;

  const [summaryRows] = await pool.query(
    `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(fee_amount),0) AS total_fee,
            COALESCE(SUM(stripe_fee_amount),0) AS total_stripe_fee, COALESCE(SUM(profit_amount),0) AS total_profit,
            COALESCE(SUM(net_amount),0) AS total_net
     FROM transactions WHERE status = 'succeeded' AND ${THAI_DATE('created_at')} BETWEEN ? AND ?`,
    [from, to]
  );
  const summary = (summaryRows as any[])[0];

  const [deviceRows] = await pool.query(
    `SELECT d.id, d.name, d.shop_name, d.region_zone, d.province, d.district, d.subdistrict, d.lat, d.lng,
            COALESCE(c.name, '— ไม่มีเจ้าของ —') AS customer_name,
            COUNT(t.id) AS tx_count, COALESCE(SUM(t.amount),0) AS total_amount,
            COALESCE(SUM(t.fee_amount),0) AS total_fee, COALESCE(SUM(t.stripe_fee_amount),0) AS total_stripe_fee,
            COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN customers c ON c.id = d.customer_id
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY d.id
     ORDER BY total_amount DESC`,
    [from, to]
  ) as any;

  const activeDevices = deviceRows.filter((r: any) => Number(r.tx_count) > 0);
  const topDevice = activeDevices[0] || null;
  const bottomDevice = activeDevices.length > 0 ? activeDevices[activeDevices.length - 1] : null;

  const [regionRows] = await pool.query(
    `SELECT COALESCE(d.region_zone, 'ไม่ระบุ') AS region_zone, COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.amount),0) AS total_amount, COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY region_zone
     HAVING tx_count > 0
     ORDER BY total_amount DESC`,
    [from, to]
  );

  const [provinceRows] = await pool.query(
    `SELECT COALESCE(d.province, 'ไม่ระบุ') AS province, COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.amount),0) AS total_amount, COALESCE(SUM(t.profit_amount),0) AS total_profit
     FROM devices d
     LEFT JOIN transactions t ON t.device_id = d.id AND t.status = 'succeeded' AND ${THAI_DATE('t.created_at')} BETWEEN ? AND ?
     GROUP BY province
     HAVING tx_count > 0
     ORDER BY total_amount DESC`,
    [from, to]
  );

  const mapDevices = deviceRows.filter((r: any) => r.lat !== null && r.lng !== null);
  const profitClass = Number(summary.total_profit) >= 0 ? 'profit' : 'loss';

  const mapPoints = mapDevices.map((r: any) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    name: deviceLabel(r),
    customer: r.customer_name,
    total: fmt(r.total_amount),
    tx: Number(r.tx_count),
  }));

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>PayBox — รายงาน P&amp;L / Geo</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1000px; margin: 30px auto; padding: 0 20px; color: #222; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; font-size: 14px; }
th { background: #f5f5f5; }
a { color: #1d4ed8; }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.card { flex: 1 1 150px; border: 1px solid #ddd; border-radius: 8px; padding: 14px; }
.card .label { font-size: 12px; color: #666; text-transform: uppercase; }
.card .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
.card.profit .value { color: #16a34a; }
.card.loss .value { color: #c0392b; }
.highlight-top { background: #ecfdf5; }
.highlight-bottom { background: #fef2f2; }
#map { height: 420px; margin-top: 12px; border-radius: 8px; }
form.filter { margin-top: 16px; display: flex; gap: 10px; align-items: end; }
form.filter label { font-size: 13px; font-weight: 600; }
input[type=date] { padding: 6px; }
button { padding: 8px 14px; cursor: pointer; }
h2 { margin-top: 32px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
</style>
</head>
<body>
<h1>รายงานกำไร-ขาดทุน &amp; ที่ตั้งเครื่อง</h1>

<form class="filter" method="get">
    <input type="hidden" name="admin_password" value="${esc(adminPassword)}">
    <div><label>จาก</label><br><input type="date" name="from" value="${esc(from)}"></div>
    <div><label>ถึง</label><br><input type="date" name="to" value="${esc(to)}"></div>
    <button type="submit">ดูรายงาน</button>
</form>

<h2>สรุปช่วง ${esc(from)} ถึง ${esc(to)}</h2>
<div class="cards">
    <div class="card"><div class="label">ธุรกรรมสำเร็จ</div><div class="value">${summary.tx_count}</div></div>
    <div class="card"><div class="label">ยอดรวม (Gross)</div><div class="value">${fmt(summary.total_amount)}</div></div>
    <div class="card"><div class="label">Fee ที่เก็บจากลูกค้า</div><div class="value">${fmt(summary.total_fee)}</div></div>
    <div class="card"><div class="label">Fee ที่ Stripe หักเรา</div><div class="value">${fmt(summary.total_stripe_fee)}</div></div>
    <div class="card ${profitClass}"><div class="label">กำไรแพลตฟอร์ม</div><div class="value">${fmt(summary.total_profit)}</div></div>
    <div class="card"><div class="label">ยอดสุทธิที่ต้องโอนลูกค้า</div><div class="value">${fmt(summary.total_net)}</div></div>
</div>
<small>กำไรแพลตฟอร์ม = Fee ที่เก็บจากลูกค้า − Fee จริงที่ Stripe หักเรา ลูกค้าที่ตั้งเป็น "เหมาจ่าย" จะไม่มี fee
ต่อรายการ ทำให้ธุรกรรมของลูกค้ากลุ่มนี้โชว์เป็นขาดทุนต่อรายการในรายงานนี้ (ปกติ)</small>

${(topDevice || bottomDevice) ? `
<h2>อุปกรณ์ยอดสูงสุด / ต่ำสุด (เฉพาะเครื่องที่มีธุรกรรมในช่วงนี้)</h2>
<table>
    <tr><th></th><th>เครื่อง</th><th>ลูกค้า</th><th>จำนวนรายการ</th><th>ยอดรวม</th><th>กำไร</th></tr>
    ${topDevice ? `<tr class="highlight-top"><td>สูงสุด</td><td>${esc(deviceLabel(topDevice))}</td><td>${esc(topDevice.customer_name)}</td><td>${topDevice.tx_count}</td><td>${fmt(topDevice.total_amount)}</td><td>${fmt(topDevice.total_profit)}</td></tr>` : ''}
    ${(bottomDevice && bottomDevice !== topDevice) ? `<tr class="highlight-bottom"><td>ต่ำสุด</td><td>${esc(deviceLabel(bottomDevice))}</td><td>${esc(bottomDevice.customer_name)}</td><td>${bottomDevice.tx_count}</td><td>${fmt(bottomDevice.total_amount)}</td><td>${fmt(bottomDevice.total_profit)}</td></tr>` : ''}
</table>` : ''}

<h2>ยอดแยกตามอุปกรณ์ (${deviceRows.length})</h2>
<table>
    <tr><th>เครื่อง</th><th>ลูกค้า</th><th>ที่ตั้ง</th><th>จำนวนรายการ</th><th>ยอดรวม</th><th>Fee</th><th>กำไร</th></tr>
    ${deviceRows.map((r: any) => `<tr><td>${esc(deviceLabel(r))}</td><td>${esc(r.customer_name)}</td><td>${esc([r.province, r.region_zone].filter(Boolean).join(' / ') || '-')}</td><td>${r.tx_count}</td><td>${fmt(r.total_amount)}</td><td>${fmt(r.total_fee)}</td><td>${fmt(r.total_profit)}</td></tr>`).join('')}
</table>

<h2>แยกตามภาค</h2>
<table>
    <tr><th>ภาค</th><th>จำนวนรายการ</th><th>ยอดรวม</th><th>กำไร</th></tr>
    ${(regionRows as any[]).map((r) => `<tr><td>${esc(r.region_zone)}</td><td>${r.tx_count}</td><td>${fmt(r.total_amount)}</td><td>${fmt(r.total_profit)}</td></tr>`).join('')}
</table>

<h2>แยกตามจังหวัด</h2>
<table>
    <tr><th>จังหวัด</th><th>จำนวนรายการ</th><th>ยอดรวม</th><th>กำไร</th></tr>
    ${(provinceRows as any[]).map((r) => `<tr><td>${esc(r.province)}</td><td>${r.tx_count}</td><td>${fmt(r.total_amount)}</td><td>${fmt(r.total_profit)}</td></tr>`).join('')}
</table>

<h2>แผนที่จุดติดตั้งเครื่อง (${mapDevices.length} จุดมีพิกัด)</h2>
${mapDevices.length === 0 ? '<p>ยังไม่มีอุปกรณ์ไหนตั้งพิกัดไว้ — ตั้งได้จากหน้าตั้งค่าของแต่ละเครื่อง</p>' : `
<div id="map"></div>
<script>
var map = L.map('map').setView([13.7563, 100.5018], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
}).addTo(map);

var points = ${JSON.stringify(mapPoints)};

var bounds = [];
points.forEach(function (p) {
    var marker = L.marker([p.lat, p.lng]).addTo(map);
    marker.bindPopup('<b>' + p.name + '</b><br>ลูกค้า: ' + p.customer + '<br>ธุรกรรมช่วงนี้: ' + p.tx + ' รายการ<br>ยอดรวม: ' + p.total);
    bounds.push([p.lat, p.lng]);
});
if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
}
</script>`}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});
