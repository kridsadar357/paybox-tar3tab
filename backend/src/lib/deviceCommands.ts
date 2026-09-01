// คิวคำสั่งถึงอุปกรณ์ + กติกาว่าเมื่อไหร่ถึงปล่อยคำสั่งได้
//
// โจทย์: การสั่งอัปเดตเฟิร์มแวร์จบด้วยการรีบูต ถ้าไปตัดตอนลูกค้ากำลังจ่ายเงิน รายการนั้นค้าง
// กลางทาง — เงินอาจถูกตัดไปแล้วแต่เครื่องรีสตาร์ตก่อนจะยืนยันกับ backend ทัน
//
// วิธีแก้: ไม่ปล่อยคำสั่งจนกว่าเครื่องจะ "นิ่ง" คือไม่มีความเคลื่อนไหวของรายการใดๆ ติดต่อกัน 5 นาที
// ถ้ามีรายการใหม่แทรกเข้ามาระหว่างรอ เวลานับใหม่เองโดยอัตโนมัติ เพราะเราวัดจาก "เวลาล่าสุดที่มี
// ความเคลื่อนไหว" ไม่ได้เก็บตัวนับถอยหลังไว้ที่ไหน — ไม่มีสถานะที่ค้างผิดได้
import { pool } from '../db';
import { compareVersions } from './version';

/** ต้องเงียบติดต่อกันเท่านี้ก่อนถึงจะปล่อยคำสั่งอัปเดต */
export const QUIET_PERIOD_MINUTES = 5;

/** คำสั่งที่ค้างนานเกินนี้ถือว่าเลิกรอ (เครื่องอาจถูกถอดออกไปแล้ว) */
const COMMAND_EXPIRY_HOURS = 48;

export interface DeviceActivity {
  lastActivity: Date | null;
  /** วินาทีที่ผ่านไปตั้งแต่ความเคลื่อนไหวล่าสุด — null ถ้าไม่เคยมีรายการเลย */
  idleSeconds: number | null;
  /** มีรายการที่ยังไม่จบ (ลูกค้าน่าจะยืนอยู่หน้าเครื่อง) หรือไม่ */
  hasOpenSession: boolean;
}

/**
 * ดูว่าเครื่องกำลังมีลูกค้าใช้งานอยู่หรือไม่
 *
 * วัดจากทั้ง created_at และ updated_at เพราะรายการหนึ่งถูกแตะสองจังหวะ: ตอนสร้าง QR และตอน
 * ยืนยันผลจาก Stripe — ถ้าดูแค่ created_at จะพลาดรายการที่สร้างไว้ 6 นาทีแล้วเพิ่งจ่ายสำเร็จ
 */
export async function getDeviceActivity(deviceId: number): Promise<DeviceActivity> {
  const [rows] = await pool.query(
    `SELECT MAX(GREATEST(created_at, updated_at)) AS last_activity,
            SUM(status NOT IN ('succeeded','failed','canceled','cancelled','refunded')
                AND created_at > NOW() - INTERVAL ? MINUTE) AS open_sessions
     FROM transactions WHERE device_id = ?`,
    [QUIET_PERIOD_MINUTES, deviceId]
  );
  const r = (rows as any[])[0];
  const lastActivity: Date | null = r?.last_activity ? new Date(r.last_activity) : null;
  return {
    lastActivity,
    idleSeconds: lastActivity ? Math.floor((Date.now() - lastActivity.getTime()) / 1000) : null,
    hasOpenSession: Number(r?.open_sessions || 0) > 0,
  };
}

export interface QuietCheck {
  quiet: boolean;
  reason: string;
  /** วินาทีที่ยังต้องรอ (ประมาณ) — ใช้บอกแอดมินว่าอีกนานแค่ไหน */
  waitSeconds: number;
}

export function evaluateQuiet(activity: DeviceActivity): QuietCheck {
  const quietSec = QUIET_PERIOD_MINUTES * 60;

  if (activity.hasOpenSession) {
    return { quiet: false, reason: 'มีรายการที่ยังไม่จบ กำลังรอลูกค้า', waitSeconds: quietSec };
  }
  if (activity.idleSeconds === null) {
    return { quiet: true, reason: 'ไม่เคยมีรายการ พร้อมอัปเดต', waitSeconds: 0 };
  }
  if (activity.idleSeconds >= quietSec) {
    return { quiet: true, reason: 'ไม่มีความเคลื่อนไหวเกิน 5 นาที พร้อมอัปเดต', waitSeconds: 0 };
  }
  const remain = quietSec - activity.idleSeconds;
  return {
    quiet: false,
    reason: `เพิ่งมีรายการเมื่อ ${Math.floor(activity.idleSeconds / 60)} นาทีที่แล้ว`,
    waitSeconds: remain,
  };
}

export interface ClaimedCommands {
  /** บอร์ดควรไปเช็คอัปเดตเฟิร์มแวร์ทันที */
  checkUpdate: boolean;
  /** บอร์ดควรรีสตาร์ต */
  restart: boolean;
}

/**
 * เรียกจาก /heartbeat — ตัดสินว่าจะปล่อยคำสั่งไหนให้บอร์ดในรอบนี้
 *
 * restart กับ force_update ใช้กติกาต่างกันโดยตั้งใจ:
 *   force_update ต้องรอเครื่องนิ่ง เพราะจบด้วยการดาวน์โหลด+แฟลช+รีบูต ใช้เวลานานและถอยกลับไม่ได้
 *   restart ปล่อยทันที เพราะเหตุผลหลักที่ต้องสั่งรีสตาร์ตคือ "เครื่องค้าง" — ซึ่งเป็นสถานการณ์ที่
 *   รายการค้างอยู่และตัวนับ "นิ่ง 5 นาที" อาจไม่มีวันครบ การบังคับให้รอจึงทำให้ปุ่มนี้ไร้ประโยชน์
 *   ในกรณีที่จำเป็นที่สุด (ตัวบอร์ดเองยังมีตัวกันซ้อนอีกชั้น ดูใน main.cpp)
 */
export async function claimPendingCommands(deviceId: number, currentVersion: string): Promise<ClaimedCommands> {
  const result: ClaimedCommands = { checkUpdate: false, restart: false };

  // ---- restart: ปล่อยทันทีไม่ต้องรอ ----
  const [rsRows] = await pool.query(
    `SELECT id FROM device_commands
     WHERE device_id = ? AND command = 'restart' AND status = 'pending'
     ORDER BY id ASC LIMIT 1`,
    [deviceId]
  );
  const restartCmd = (rsRows as any[])[0];
  if (restartCmd) {
    await pool.query(
      "UPDATE device_commands SET status = 'dispatched', dispatched_at = NOW(), hold_reason = NULL WHERE id = ?",
      [restartCmd.id]
    );
    result.restart = true;
  }

  // คำสั่ง restart ที่ส่งไปแล้วถือว่าจบเมื่อบอร์ดกลับมาทักใหม่หลังบูต — heartbeat รอบถัดไปคือหลักฐาน
  await pool.query(
    `UPDATE device_commands SET status = 'done', completed_at = NOW()
     WHERE device_id = ? AND command = 'restart' AND status = 'dispatched'
       AND dispatched_at < NOW() - INTERVAL 1 MINUTE`,
    [deviceId]
  );

  result.checkUpdate = await claimUpdateCommand(deviceId, currentVersion);
  return result;
}

async function claimUpdateCommand(deviceId: number, currentVersion: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT id, from_version FROM device_commands
     WHERE device_id = ? AND command = 'force_update' AND status IN ('pending','dispatched')
     ORDER BY id ASC LIMIT 1`,
    [deviceId]
  );
  const cmd = (rows as any[])[0];
  if (!cmd) return false;

  // ปิดคำสั่งเมื่อบอร์ดรายงานเวอร์ชันที่ "ใหม่กว่า" ตอนสั่งเท่านั้น
  // ห้ามใช้ !== เด็ดขาด — ค่าที่ต่างกันไม่ได้แปลว่าใหม่กว่า ถ้าค่าที่เก็บไว้ตอนสั่งบังเอิญเพี้ยน
  // คำสั่งจะถูกปิดทิ้งทั้งที่ยังไม่ได้อัปเดตจริง (เจอกับตัวเองตอนทดสอบรอบแรก)
  if (currentVersion && cmd.from_version && compareVersions(currentVersion, cmd.from_version) > 0) {
    await pool.query("UPDATE device_commands SET status = 'done', completed_at = NOW() WHERE id = ?", [cmd.id]);
    return false;
  }

  // เลิกรอถ้าค้างนานเกินไป
  await pool.query(
    `UPDATE device_commands SET status = 'expired', hold_reason = 'ค้างเกิน ${COMMAND_EXPIRY_HOURS} ชั่วโมง'
     WHERE id = ? AND created_at < NOW() - INTERVAL ${COMMAND_EXPIRY_HOURS} HOUR`,
    [cmd.id]
  );

  const activity = await getDeviceActivity(deviceId);
  const check = evaluateQuiet(activity);

  if (!check.quiet) {
    await pool.query("UPDATE device_commands SET status = 'pending', hold_reason = ? WHERE id = ?", [
      check.reason,
      cmd.id,
    ]);
    return false;
  }

  await pool.query(
    "UPDATE device_commands SET status = 'dispatched', dispatched_at = NOW(), hold_reason = NULL WHERE id = ?",
    [cmd.id]
  );
  return true;
}
