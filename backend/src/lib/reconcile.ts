// ตามเก็บรายการที่ค้างสถานะไม่จบ
//
// รายการจะค้างเมื่อบอร์ดเลิกถามก่อนที่ผู้ให้บริการจะสรุปผล (เครื่องดับ เน็ตหลุด ลูกค้าเดินหนี
// หรือ QR หมดอายุที่ฝั่งบอร์ดแต่ยังจ่ายได้จริง) ตอนเจอครั้งแรกมีค้างอยู่ 29 จาก 39 รายการ
//
// ทำงานกับผู้ให้บริการทุกเจ้าผ่าน provider.getStatus() — ไม่ผูกกับ Stripe อีกต่อไป
// Ksher จำเป็นต้องมีตัวนี้มากกว่า Stripe ด้วยซ้ำ เพราะยังไม่มี webhook คอยบอกว่าเงินเข้าแล้ว
// ทางเดียวที่จะรู้คือถามเอง
//
// สำคัญ: งานนี้ "ถามผู้ให้บริการ" เสมอ ไม่ได้เดาว่าเก่าแล้วต้องหมดอายุ — เพราะบางรายการอาจจ่าย
// สำเร็จจริงหลังบอร์ดเลิกถาม การไปปิดเป็นหมดอายุทื่อๆ จะกลืนเงินของร้านค้าหายไปเงียบๆ
import { pool } from '../db';
import { applyProviderStatus, TERMINAL_STATUSES } from './transactionSync';
import { getProvider } from './providers';

/** รอสักพักก่อนค่อยตาม ไม่ไปแย่งกับบอร์ดที่กำลังถาม check_status อยู่ */
const MIN_AGE_MINUTES = 10;
/** จำกัดจำนวนต่อรอบ กันยิงผู้ให้บริการรัวเกินไป */
const BATCH_SIZE = 50;
/** เลิกตามรายการที่เก่ากว่านี้ — รายการที่ค้างมาเป็นสัปดาห์ไม่มีทางเปลี่ยนสถานะแล้ว */
const MAX_AGE_DAYS = 7;
/**
 * QR ที่ไม่มีใครจ่ายจะค้างอยู่สถานะเดิมถาวร — ฝั่ง Stripe ตกกลับมาเป็น requires_payment_method
 * ส่วน Ksher ค้างอยู่ที่ NOTPAY ซึ่งแปลงมาเป็น requires_action
 *
 * ถ้าไม่กันไว้ รายการที่ถูกทิ้งจะถูกถามซ้ำทุกรอบตลอดไป — ตอนเปิดใช้งานครั้งแรกมีอยู่ 26 รายการ
 * คิดเป็นการยิงเปล่าๆ ราว 2,500 ครั้งต่อวัน
 *
 * QR ตั้งให้หมดอายุใน 15 นาที การรอถึง 24 ชั่วโมงจึงเผื่อไว้มากเกินพอแล้ว
 */
const ABANDONED_AFTER_HOURS = 24;
const ABANDONED_STATUSES = ['requires_payment_method', 'requires_action'];

export interface ReconcileResult {
  checked: number;
  updated: number;
  /** รายการที่กลายเป็นสำเร็จ = เงินที่ระบบเคยไม่รู้ว่าได้รับ ต้องรายงานให้เห็นชัด */
  recovered: { id: number; provider: string; payment_intent_id: string; amount: number; device_id: number }[];
  errors: number;
}

export async function reconcileStaleTransactions(limit = BATCH_SIZE): Promise<ReconcileResult> {
  const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
  const abandonedPlaceholders = ABANDONED_STATUSES.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, device_id, provider, payment_intent_id, status, amount, settlement_id
     FROM transactions
     WHERE status NOT IN (${placeholders})
       AND created_at < NOW() - INTERVAL ? MINUTE
       AND created_at > NOW() - INTERVAL ? DAY
       AND NOT (status IN (${abandonedPlaceholders}) AND created_at < NOW() - INTERVAL ? HOUR)
     ORDER BY created_at ASC
     LIMIT ?`,
    [...TERMINAL_STATUSES, MIN_AGE_MINUTES, MAX_AGE_DAYS, ...ABANDONED_STATUSES, ABANDONED_AFTER_HOURS, limit]
  );

  const result: ReconcileResult = { checked: 0, updated: 0, recovered: [], errors: 0 };

  for (const txn of rows as any[]) {
    result.checked++;

    const provider = getProvider(txn.provider);

    // ผู้ให้บริการที่ยังตั้งค่าไม่ครบ ถามไปก็ล้มเหลวทุกครั้ง ข้ามเงียบๆ ดีกว่าทำให้ log เต็มไปด้วย error
    if (!provider.isConfigured()) {
      continue;
    }

    // ข้ามรหัสอ้างอิงที่ไม่ใช่รูปแบบของเจ้านั้น (เช่นข้อมูลทดสอบเก่า) — ยิงไปก็เปล่าประโยชน์
    if (!provider.isValidRef(txn.payment_intent_id || '')) {
      continue;
    }

    let statusResult;
    try {
      statusResult = await provider.getStatus(txn.payment_intent_id);
    } catch (err: any) {
      result.errors++;
      console.error(`[reconcile] ถาม ${provider.name} ไม่สำเร็จ ${txn.payment_intent_id}: ${err?.message}`);
      continue;
    }

    const wasSucceeded = txn.status === 'succeeded';
    const changed = await applyProviderStatus(txn, statusResult);

    if (changed) {
      result.updated++;
      if (statusResult.status === 'succeeded' && !wasSucceeded) {
        result.recovered.push({
          id: txn.id,
          provider: provider.name,
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
