// ตามเก็บเฉพาะรายการของ Stripe เท่านั้น
//
// Stripe ต้องมีตัวตามเพราะ QR ของ PromptPay ยังจ่ายได้หลังบอร์ดเลิกถามแล้ว และ webhook อาจหาย
// ส่วน Ksher ให้เครื่องถาม check_status เอาเอง ซึ่งเพียงพอสำหรับตอนนี้ ถ้าจะเพิ่มการตามเก็บ
// ให้ Ksher ด้วย ต้องเรียกผ่าน provider.getStatus แทน stripeRequest ที่ใช้อยู่ในไฟล์นี้
// ตามเก็บรายการที่ค้างสถานะไม่จบ
//
// รายการจะค้างเมื่อบอร์ดเลิกถามก่อนที่ Stripe จะสรุปผล (เครื่องดับ เน็ตหลุด ลูกค้าเดินหนี
// หรือ QR หมดอายุที่ฝั่งบอร์ดแต่ยังจ่ายได้จริง) ตอนเจอครั้งแรกมีค้างอยู่ 29 จาก 39 รายการ
//
// สำคัญ: งานนี้ "ถาม Stripe" เสมอ ไม่ได้เดาว่าเก่าแล้วต้องหมดอายุ — เพราะบางรายการอาจจ่ายสำเร็จ
// จริงหลังบอร์ดเลิกถาม การไปปิดเป็น expired ทื่อๆ จะกลืนเงินของร้านค้าหายไปเงียบๆ
import { pool } from '../db';
import { stripeRequest } from '../stripe';
import { applyProviderStatus, TERMINAL_STATUSES } from './transactionSync';
import { stripeIntentToStatus } from './providers/stripe';

/** รอสักพักก่อนค่อยตาม ไม่ไปแย่งกับบอร์ดที่กำลังถาม check_status อยู่ */
const MIN_AGE_MINUTES = 10;
/** จำกัดจำนวนต่อรอบ กันยิง Stripe รัวเกินไป */
const BATCH_SIZE = 50;
/** เลิกตามรายการที่เก่ากว่านี้ — PaymentIntent ที่ค้างมาเป็นสัปดาห์ไม่มีทางเปลี่ยนสถานะแล้ว */
const MAX_AGE_DAYS = 7;
/**
 * PromptPay: พอ QR หมดอายุ intent จะตกกลับมาเป็น requires_payment_method แล้วอยู่อย่างนั้นถาวร
 * ถ้าไม่กันไว้ รายการที่ถูกทิ้งจะถูกถาม Stripe ซ้ำทุกรอบตลอดไป — ตอนเปิดใช้งานครั้งแรกมีอยู่ 26
 * รายการ คิดเป็นการยิง Stripe เปล่าๆ ราว 2,500 ครั้งต่อวัน
 */
const ABANDONED_AFTER_HOURS = 24;

export interface ReconcileResult {
  checked: number;
  updated: number;
  /** รายการที่กลายเป็นสำเร็จ = เงินที่ระบบเคยไม่รู้ว่าได้รับ ต้องรายงานให้เห็นชัด */
  recovered: { id: number; payment_intent_id: string; amount: number; device_id: number }[];
  errors: number;
}

export async function reconcileStaleTransactions(limit = BATCH_SIZE): Promise<ReconcileResult> {
  const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, device_id, provider, payment_intent_id, status, amount, settlement_id
     FROM transactions
     WHERE provider = 'stripe'
       AND status NOT IN (${placeholders})
       AND created_at < NOW() - INTERVAL ? MINUTE
       AND created_at > NOW() - INTERVAL ? DAY
       AND NOT (status = 'requires_payment_method' AND created_at < NOW() - INTERVAL ? HOUR)
     ORDER BY created_at ASC
     LIMIT ?`,
    [...TERMINAL_STATUSES, MIN_AGE_MINUTES, MAX_AGE_DAYS, ABANDONED_AFTER_HOURS, limit]
  );

  const result: ReconcileResult = { checked: 0, updated: 0, recovered: [], errors: 0 };

  for (const txn of rows as any[]) {
    result.checked++;

    // ข้ามรายการที่ไม่ใช่ payment intent จริง (เช่นข้อมูลทดสอบเก่า) — ยิงไปก็ 404 เปล่าๆ
    if (!/^pi_[a-zA-Z0-9]+$/.test(txn.payment_intent_id || '')) {
      continue;
    }

    const res = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(txn.payment_intent_id)}`, {
      expand: ['latest_charge.balance_transaction'],
    });

    if (!res.ok) {
      result.errors++;
      console.error(`[reconcile] ถาม Stripe ไม่สำเร็จ ${txn.payment_intent_id}: ${res.error}`);
      continue;
    }

    const status = String(res.data?.status || '');
    const wasSucceeded = txn.status === 'succeeded';
    const changed = await applyProviderStatus(txn, stripeIntentToStatus(res.data));

    if (changed) {
      result.updated++;
      if (status === 'succeeded' && !wasSucceeded) {
        result.recovered.push({
          id: txn.id,
          payment_intent_id: txn.payment_intent_id,
          amount: Number(txn.amount),
          device_id: txn.device_id,
        });
      }
    }
  }

  if (result.recovered.length > 0) {
    // ขึ้น log ให้เด่น — นี่คือเงินที่ระบบเพิ่งรู้ว่าได้รับ และจะเข้ารอบโอนให้ร้านค้าในรอบถัดไป
    console.log(
      `[reconcile] พบรายการที่จ่ายสำเร็จแต่ระบบไม่เคยรู้ ${result.recovered.length} รายการ ` +
        `รวม ฿${result.recovered.reduce((s, r) => s + r.amount, 0).toFixed(2)}`
    );
  }

  return result;
}

/** รอบอัตโนมัติ — เว้นระยะให้ห่างพอที่จะไม่กวน Stripe และไม่ชนกับ check_status ของบอร์ด */
export function startReconcileLoop(intervalMinutes = 15): void {
  const run = async () => {
    try {
      const r = await reconcileStaleTransactions();
      if (r.checked > 0) {
        console.log(`[reconcile] ตรวจ ${r.checked} รายการ · อัปเดต ${r.updated} · ผิดพลาด ${r.errors}`);
      }
    } catch (err) {
      console.error('[reconcile] รอบตรวจล้มเหลว:', err);
    }
  };
  // เว้นช่วงบูตก่อน ให้ระบบตั้งตัวเสร็จ
  setTimeout(run, 60_000);
  setInterval(run, intervalMinutes * 60_000);
}
