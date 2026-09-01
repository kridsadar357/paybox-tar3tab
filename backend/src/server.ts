// Entry point — ประกอบ router ทั้งหมดเข้าด้วยกัน + เสิร์ฟไฟล์สแตติก + เสิร์ฟ paybox-control (SPA)
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { deviceRouter } from './routes/device';
import { adminRouter } from './routes/admin';
import { deviceSettingsRouter } from './routes/deviceSettings';
import { reportsRouter } from './routes/reports';
import { customerRouter } from './routes/customer';
import { customerAccountRouter } from './routes/customerAccount';
import { adminAccountRouter } from './routes/adminAccount';
import { alertsRouter } from './routes/alerts';
import { ensureAdminAccount } from './lib/bootstrapAdmin';
import { stripeWebhookRouter } from './routes/stripeWebhook';
import { lineWebhookRouter } from './routes/lineWebhook';
import { startReconcileLoop } from './lib/reconcile';

const app = express();

// อยู่หลัง Traefik เสมอ (VPS deploy) — เชื่อถือ X-Forwarded-For แค่ 1 hop (จาก Traefik เท่านั้น)
// ไม่งั้น express-rate-limit จะ mis-key ทุก request เป็น IP เดียวกันหมด (ปฏิเสธ header เพื่อความ
// ปลอดภัยเมื่อไม่รู้ว่าควรเชื่อถือกี่ hop)
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors());

// บีบอัดทุก response ที่ client รองรับ — วัดจากของจริงก่อนเปิด: หน้าเว็บส่ง JS/CSS ไปดิบๆ 392KB
// ต่อการเข้าครั้งแรก พอบีบแล้วเหลือราว 109KB ซึ่งเป็นการลดที่มากกว่าการแยกก้อนโค้ดทั้งหมดรวมกัน
// ต้องอยู่ก่อน static handler ทั้งหมด ไม่งั้นไฟล์ถูกส่งออกไปก่อนจะผ่าน middleware นี้
app.use(compression());

// ต้อง mount ก่อน express.json() — การตรวจลายเซ็นของ Stripe ต้องใช้ raw body ตัวจริง
// ถ้าปล่อยให้ json parser กินไปก่อน จะคำนวณ HMAC ไม่ตรงและตีกลับทุก event
app.use('/api/stripe/webhook', stripeWebhookRouter);
// ด้วยเหตุผลเดียวกัน — ลายเซ็นของ LINE คำนวณจาก raw body เช่นกัน
app.use('/api/line/webhook', lineWebhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Device-facing + admin + customer JSON API ----
// mount ตัวที่มี path เจาะจงกว่าก่อน (device_settings/reports เป็น sub-path ของ /api/admin)
app.use('/api/admin/device_settings', deviceSettingsRouter);
app.use('/api/admin/reports', reportsRouter);
app.use('/api/admin/account', adminAccountRouter);
// ต้องมาก่อน adminRouter ที่ mount ไว้ที่ /api/admin ไม่งั้นเส้นทางกว้างกว่าจะรับไปก่อน
app.use('/api/admin/alerts', alertsRouter);
app.use('/api/admin', adminRouter);
// ต้อง mount ก่อน customerRouter เพราะ path เจาะจงกว่า (/account/... ไม่ชนกับ route อื่นของ customer)
app.use('/api/customer/account', customerAccountRouter);
app.use('/api/customer', customerRouter);
app.use('/api', deviceRouter);

// ---- Uploaded/static files ----
// โฟลเดอร์บนดิสก์ใช้ underscore (customer_backgrounds, settlement_proofs, banner_videos, firmware)
// แต่ URL ที่ route handlers สร้างไว้ใช้ hyphen (customer-backgrounds, settlement-proofs, banner-videos)
// เพื่อความสวยงาม — เลย map แยกกันตรงนี้แทนที่จะเปลี่ยนชื่อโฟลเดอร์จริง
const uploadsDir = config.uploadsDir;
for (const dir of ['firmware', 'banner_videos', 'settlement_proofs', 'customer_backgrounds']) {
  fs.mkdirSync(path.join(uploadsDir, dir), { recursive: true });
}
app.use('/devices/firmware', express.static(path.join(uploadsDir, 'firmware')));
app.use('/devices/banner-videos', express.static(path.join(uploadsDir, 'banner_videos')));
app.use('/files/settlement-proofs', express.static(path.join(uploadsDir, 'settlement_proofs')));
app.use('/files/customer-backgrounds', express.static(path.join(uploadsDir, 'customer_backgrounds')));

// ไฟล์เสียง .wav ที่บอร์ดโหลดไปเล่นตอนกดจำนวนเงิน/ยืนยันชำระ — ไฟล์นิ่งล้วน ไม่มี logic
// (เดิมโฮสต์อยู่ที่ <โฮสต์เดิม>/paybox-api/audio/*.wav เป็น static files อยู่แล้ว ย้ายมาเฉยๆ)
app.use('/api/audio', express.static(path.join(__dirname, '..', 'assets', 'audio')));

// ---- paybox-control SPA (admin + customer portal, same build, client-side routed) ----
// build จาก ../paybox-control/dist ถูก copy เข้ามาตอน build image (ดู Dockerfile)
const spaDir = path.join(__dirname, '..', 'public', 'paybox-control');
if (fs.existsSync(spaDir)) {
  for (const mountPath of ['/customer', '/portal/administrator']) {
    // ไฟล์ใน assets/ มี content hash อยู่ในชื่อ เปลี่ยนเนื้อหาเมื่อไหร่ชื่อเปลี่ยนตาม จึงเก็บได้ยาว
    // ส่วน index.html ต้องไม่ cache เลย ไม่งั้นผู้ใช้จะค้างอยู่กับ HTML เก่าที่ชี้ไปไฟล์ที่ถูกลบไปแล้ว
    app.use(
      mountPath,
      express.static(spaDir, {
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get(`${mountPath}/*splat`, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(spaDir, 'index.html'));
    });
  }
} else {
  // eslint-disable-next-line no-console
  console.warn(`[server] SPA build not found at ${spaDir} — /customer and /portal/administrator will 404`);
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'paybox-backend' }));

app.use((_req, res) => res.status(404).json({ success: false, error: 'not_found' }));

app.listen(config.port, async () => {
  // eslint-disable-next-line no-console
  console.log(`paybox-backend listening on :${config.port}`);
  // สร้างบัญชีแอดมินเริ่มต้นจาก ADMIN_PASSWORD ถ้ายังไม่มีบัญชีไหนเลย — ทำหลัง listen เพื่อไม่ให้
  // ปัญหาที่ DB หน่วงบล็อกการเปิดพอร์ต (health check ของ Traefik จะไม่ล้มระหว่างรอ)
  await ensureAdminAccount();
  // ตามเก็บรายการที่ค้างสถานะเป็นระยะ — กันเงินที่จ่ายสำเร็จหลังบอร์ดเลิกถามหายไปเงียบๆ
  startReconcileLoop();
});
