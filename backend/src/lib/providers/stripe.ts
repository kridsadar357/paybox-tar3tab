// Stripe — PromptPay ผ่าน PaymentIntent
//
// ห่อโค้ดเดิมที่เคยอยู่ใน routes/device.ts ให้เข้ารูปแบบเดียวกับผู้ให้บริการเจ้าอื่น
// พฤติกรรมเหมือนเดิมทุกอย่าง เครื่องที่ใช้อยู่จึงไม่รู้สึกถึงการเปลี่ยนแปลง
import { config } from '../../config';
import { stripeRequest } from '../../stripe';
import { ChargeResult, NormalizedStatus, PaymentProvider, ProviderNotConfiguredError, StatusResult } from './types';

const KNOWN: NormalizedStatus[] = [
  'requires_payment_method', 'requires_action', 'processing', 'succeeded', 'canceled',
];

export const stripeProvider: PaymentProvider = {
  name: 'stripe',

  isValidRef: (ref) => /^pi_[a-zA-Z0-9]+$/.test(ref),

  isConfigured: () => Boolean(config.stripeSecretKey),

  async createCharge(amountBaht: number, currency: string): Promise<ChargeResult> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('stripe', 'ยังไม่ได้ตั้ง STRIPE_SECRET_KEY');
    }
    const result = await stripeRequest('POST', '/payment_intents', {
      amount: Math.round(amountBaht * 100),
      currency,
      payment_method_types: ['promptpay'],
      payment_method_data: { type: 'promptpay', billing_details: { email: config.billingEmail } },
      confirm: 'true',
    });
    if (!result.ok) throw new Error(`stripe สร้าง QR ไม่สำเร็จ: ${result.error}`);

    const intent: any = result.data;
    const qrPayload = intent?.next_action?.promptpay_display_qr_code?.data ?? null;
    const ref = intent?.id ?? null;
    if (!qrPayload || !ref) throw new Error('stripe ตอบกลับมาโดยไม่มีข้อมูล QR');

    return { ref, qrPayload };
  },

  async getStatus(ref: string): Promise<StatusResult> {
    // expand ไปถึง balance_transaction ในคราวเดียว จะได้รู้ค่าธรรมเนียมจริงที่ Stripe หักจากเรา
    const result = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(ref)}`, {
      expand: ['latest_charge.balance_transaction'],
    });
    if (!result.ok) throw new Error(`stripe ถามสถานะไม่สำเร็จ: ${result.error}`);

    const intent: any = result.data;
    const raw = intent?.status;
    const feeSubunits = intent?.latest_charge?.balance_transaction?.fee ?? null;

    return {
      status: (KNOWN as string[]).includes(raw) ? (raw as NormalizedStatus) : 'unknown',
      providerFeeBaht: feeSubunits === null ? null : Math.round(feeSubunits) / 100,
      raw: intent,
    };
  },
};

/**
 * แปลง PaymentIntent ที่ได้มาจากทางอื่น (webhook หรืองานตามเก็บ) ให้เป็นรูปแบบกลาง
 * เพื่อให้ทุกทางเขียนสถานะผ่าน applyProviderStatus ตัวเดียวกัน ไม่แยกตรรกะออกไปคำนวณเอง
 */
export function stripeIntentToStatus(intent: any): StatusResult {
  const raw = intent?.status;
  const feeSubunits = intent?.latest_charge?.balance_transaction?.fee ?? null;
  return {
    status: (KNOWN as string[]).includes(raw) ? (raw as NormalizedStatus) : 'unknown',
    providerFeeBaht: feeSubunits === null ? null : Math.round(feeSubunits) / 100,
    raw: intent,
  };
}
