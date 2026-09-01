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
  // อัตราที่ผู้ให้บริการรับชำระเงินเก็บจากเรา ใช้เป็นพื้นขั้นต่ำของค่าธรรมเนียมที่ตั้งให้ร้านค้า
  // ค่าเริ่มต้น 1.77 มาจากการวัดค่าธรรมเนียมจริงที่ Stripe เก็บในรายการที่ผ่านระบบ
  // ถ้าเจรจาราคาใหม่ได้หรือย้ายไปต่อธนาคารโดยตรง ให้แก้ค่านี้ ระบบจะใช้เป็นพื้นใหม่ทันที
  providerFeePercent: parseFloat(process.env.PROVIDER_FEE_PERCENT || '1.77'),
  uploadsDir: process.env.UPLOADS_DIR || '/app/uploads',
  // โฟลเดอร์ที่ bind-mount ร่วมกับ host — backend เขียน credential ลงไป cron บน host อ่านไปใช้
  alertsDir: process.env.ALERTS_DIR || '/app/alerts',
  // สถานะที่ cron เขียนไว้ mount แบบอ่านอย่างเดียว ใช้แสดงว่าตัวเฝ้าระวังยังเดินอยู่ไหม
  alertStateDir: process.env.ALERT_STATE_DIR || '/app/alert-state',
};
