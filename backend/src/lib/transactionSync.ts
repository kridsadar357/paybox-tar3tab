// อัปเดตสถานะรายการชำระเงินจากข้อมูลของ Stripe
//
// ตรรกะนี้เคยอยู่ใน check_status อย่างเดียว ตอนนี้มีสามทางที่ต้องใช้: บอร์ดถาม (check_status),
// Stripe ยิงมาบอก (webhook) และงานตามเก็บรายการค้าง (reconcile) — ถ้าปล่อยให้แต่ละทางคำนวณ
// ค่าธรรมเนียมเองจะเพี้ยนจากกันเมื่อไหร่ก็ได้ จึงรวมไว้ที่เดียว
import { pool } from '../db';
import { feeFor, subunitsToBaht, settle } from './money';

export interface TxnRow {
  id: number;
  device_id: number;
  status: string;
  amount: number | string;
  settlement_id?: number | null;
}

/**
 * เขียนสถานะใหม่ลงรายการ พร้อมคิดค่าธรรมเนียมถ้าเพิ่งเปลี่ยนเป็นสำเร็จ
 *
 * ออกแบบให้เรียกซ้ำได้ปลอดภัย (idempotent) — webhook ส่งซ้ำได้เป็นปกติ และงานตามเก็บก็วนซ้ำ
 * รายการเดิม ถ้าสถานะไม่เปลี่ยนก็ไม่แตะฐานข้อมูลเลย
 *
 * คืนค่า true เมื่อมีการเปลี่ยนแปลงจริง
 */
export async function applyStripeStatus(txn: TxnRow, stripeStatus: string, stripeIntent?: any): Promise<boolean> {
  if (!stripeStatus || stripeStatus === txn.status) {
    return false;
  }

  // รายการที่ปิดรอบโอนไปแล้วห้ามคิดค่าธรรมเนียมใหม่ — ยอดถูกใช้สรุปยอดโอนไปแล้ว
  // การแก้ย้อนหลังจะทำให้ยอดที่โอนไปกับยอดในระบบไม่ตรงกัน
  const alreadySettled = txn.settlement_id != null;

  if (stripeStatus === 'succeeded' && txn.status !== 'succeeded' && !alreadySettled) {
    const amount = Number(txn.amount);
    let feeAmount = 0;
    let feeTierSnapshot: string | null = null;

    const [custRows] = await pool.query(
      `SELECT c.fee_tier, c.fee_percent FROM devices d
       JOIN customers c ON c.id = d.customer_id
       WHERE d.id = ? LIMIT 1`,
      [txn.device_id]
    );
    const cust = (custRows as any[])[0];
    if (cust) {
      feeTierSnapshot = cust.fee_tier;
      feeAmount = feeFor(amount, cust.fee_tier, Number(cust.fee_percent));
    }

    const stripeFeeAmount = subunitsToBaht(stripeIntent?.latest_charge?.balance_transaction?.fee);
    const { net, profit: profitAmount } = settle(amount, feeAmount, stripeFeeAmount);

    await pool.query(
      `UPDATE transactions SET status = ?, fee_amount = ?, fee_tier_snapshot = ?, net_amount = ?,
              stripe_fee_amount = ?, profit_amount = ? WHERE id = ?`,
      [stripeStatus, feeAmount, feeTierSnapshot, net, stripeFeeAmount, profitAmount, txn.id]
    );
    return true;
  }

  await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [stripeStatus, txn.id]);
  return true;
}

/** สถานะที่ถือว่ารายการจบแล้ว ไม่ต้องตามต่อ */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled', 'cancelled', 'refunded'];
