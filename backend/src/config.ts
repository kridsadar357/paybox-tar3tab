// ตั้งค่า/environment variables — ทดแทน config.php + secrets.php ของ PHP เดิม
import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  // ไม่ใช้ requireEnv โดยตั้งใจ — ระบบต้องบูตขึ้นได้แม้ยังไม่ได้ลงทะเบียน webhook
  // ตัว endpoint จะตอบ 503 เองถ้าค่านี้ว่าง ดีกว่าทำให้ทั้งระบบขึ้นไม่ได้
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  adminPassword: requireEnv('ADMIN_PASSWORD'),
  maxAmount: parseFloat(process.env.PAYBOX_MAX_AMOUNT || '100000'),
  currency: process.env.PAYBOX_CURRENCY || 'thb',
  billingEmail: process.env.PAYBOX_BILLING_EMAIL || 'guest@orca-paybox.com',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://orca-paybox.com',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASS || '',
    database: requireEnv('DB_NAME'),
  },
  // อัตราที่ผู้ให้บริการรับชำระเงินแต่ละเจ้าเก็บจากเรา ใช้เป็นพื้นขั้นต่ำของค่าธรรมเนียมที่ตั้งให้ร้านค้า
  // ตัวเลขของ Stripe มาจากการวัดค่าธรรมเนียมจริงในรายการที่ผ่านระบบ ส่วนเจ้าอื่นต้องยืนยันกับสัญญาเอง
  providerFeePercent: {
    stripe: parseFloat(process.env.PROVIDER_FEE_PERCENT_STRIPE || process.env.PROVIDER_FEE_PERCENT || '1.77'),
    ksher: parseFloat(process.env.PROVIDER_FEE_PERCENT_KSHER || '1.77'),
    payso: parseFloat(process.env.PROVIDER_FEE_PERCENT_PAYSO || '1.77'),
  } as Record<string, number>,

  ksher: {
    appid: process.env.KSHER_APPID || '',
    // PEM ใน environment variable ขึ้นบรรทัดใหม่จริงไม่ได้ จึงเขียนเป็นตัวอักษร backslash ตามด้วย n
    // แล้วแปลงกลับตรงนี้ ใช้ fromCharCode เพื่อไม่ให้ escape ซ้อนกันจนอ่านผิด
    // (92 คือ backslash, 110 คือ n, 10 คือขึ้นบรรทัดใหม่)
    privateKey: (process.env.KSHER_PRIVATE_KEY || '')
      .split(String.fromCharCode(92, 110))
      .join(String.fromCharCode(10)),
  },

  // อายุของ QR ที่สร้างผ่าน Ksher หน่วยวินาที
  //
  // หน้าจอเครื่องนับถอยหลังแค่ 2 นาที การให้ QR อยู่ได้นานกว่านั้นทำให้ลูกค้าที่สแกนช้า
  // แล้วจ่ายทีหลังยังจ่ายได้ และตัวตามเก็บจะไปเจอเองว่าเงินเข้าแล้ว
  //
  // พอเลยเวลานี้ Ksher จะปิดรายการ ซึ่งแปลงมาเป็น canceled ที่เป็นสถานะจบ
  // ตัวตามเก็บจึงเลิกถามทันทีแทนที่จะถามซ้ำไปจนครบ 24 ชั่วโมง
  ksherExpireSeconds: parseInt(process.env.KSHER_EXPIRE_SECONDS || '900', 10),

  payso: {
    merchantId: process.env.PAYSO_MERCHANT_ID || '',
    // ยังไม่ได้ใช้จริง Payso ยังไม่เปิดสิทธิ์ API แบบ none-UI ให้บัญชีนี้
    token: process.env.PAYSO_TOKEN || '',
  },
  uploadsDir: process.env.UPLOADS_DIR || '/app/uploads',
  // โฟลเดอร์ที่ bind-mount ร่วมกับ host — backend เขียน credential ลงไป cron บน host อ่านไปใช้
  alertsDir: process.env.ALERTS_DIR || '/app/alerts',
  // สถานะที่ cron เขียนไว้ mount แบบอ่านอย่างเดียว ใช้แสดงว่าตัวเฝ้าระวังยังเดินอยู่ไหม
  alertStateDir: process.env.ALERT_STATE_DIR || '/app/alert-state',
};
