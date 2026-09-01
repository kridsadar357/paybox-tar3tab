/**
 * ตัวช่วยกลางสำหรับแปลงค่าที่มาจาก API ให้เป็นข้อความที่คนอ่านรู้เรื่อง
 * ใช้ร่วมกันทั้ง portal ฝั่งแอดมินและฝั่งลูกค้า เพื่อไม่ให้สองฝั่งตีความข้อมูลชุดเดียวกันไม่ตรงกัน
 */

/**
 * แปลงค่าเวลาจาก API เป็น Date
 *
 * mysql2 คืน DATETIME มาเป็น Date object แล้ว JSON.stringify แปลงต่อเป็น ISO ลงท้าย Z (UTC)
 * แต่รองรับรูปแบบ 'YYYY-MM-DD HH:mm:ss' ไว้ด้วย เผื่อวันหลังเปลี่ยนไปเปิด dateStrings ใน pool
 * ซึ่งกรณีนั้นก็ยังเป็น UTC เหมือนเดิมเพราะ container ทั้งหมดรันบน UTC (ไม่ได้ตั้ง TZ)
 * ถ้าไม่เติม Z ให้ เบราว์เซอร์จะตีความสตริงเปล่าเป็นเวลาท้องถิ่น ทำให้เพี้ยนไป 7 ชั่วโมง
 */
export function parseServerTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const hasZone = /[Tt].*([Zz]|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasZone ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

/** 12 ส.ค. 2569 13:44 — สำหรับตาราง */
export function formatDateTime(v: string | null | undefined): string {
  const d = parseServerTime(v);
  if (!d) return '—';
  return d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 ชั่วโมงที่แล้ว" — สำหรับบอกความสดของข้อมูล */
export function relativeTime(v: string | null | undefined): string {
  const d = parseServerTime(v);
  if (!d) return 'ยังไม่เคยติดต่อ';

  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 0) return 'เมื่อสักครู่';
  if (sec < 60) return 'เมื่อสักครู่';
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} วันที่แล้ว`;
  return formatDateTime(v);
}

/* ---------------------------------------------------------------------------
 * สถานะการติดต่อของเครื่อง
 *
 * สำคัญ: `is_active` ในตาราง devices คือสวิตช์เปิด/ปิดที่แอดมินกดเอง ไม่ใช่การเชื่อมต่อ
 * (ถูกเขียนที่เดียวคือ action 'toggle' ใน routes/admin.ts)
 *
 * `last_seen_at` ถูกอัปเดตใน middleware requireDevice ทุกครั้งที่เครื่องยิง API
 *
 * ตั้งแต่ firmware 1.3.0 บอร์ดเรียก /heartbeat ทุก 5 นาที ค่านี้จึงบอก "ออนไลน์อยู่จริง" ได้
 * แต่เครื่องที่ยังใช้เฟิร์มแวร์เก่ากว่านั้นเรียก backend เฉพาะตอนบูตกับตอนมีคนจ่ายเงิน — เรา
 * ไม่มีทางรู้ว่ามันออนไลน์อยู่หรือไม่ จึงต้องแยกกรณีนี้ออกมาต่างหาก ไม่ใช่เหมารวมว่าออฟไลน์
 * (การบอกว่าเครื่องที่ทำงานปกติเป็นออฟไลน์ ก็ผิดพอๆ กับการบอกว่าเครื่องที่ดับอยู่เป็นออนไลน์)
 * ------------------------------------------------------------------------- */

/** เวอร์ชันแรกที่ส่ง heartbeat — ต่ำกว่านี้บอกสถานะออนไลน์ไม่ได้ */
export const HEARTBEAT_MIN_VERSION = '1.3.0';

/** บอร์ดเต้นทุก 5 นาที เผื่อพลาดได้ 2 ครั้งก่อนจะถือว่าหลุด */
const ONLINE_WINDOW_SEC = 12 * 60;
const CONTACT_TODAY_SEC = 24 * 3600;

export type ContactLevel = 'online' | 'offline' | 'unreported' | 'never';

export interface DeviceContact {
  level: ContactLevel;
  /** ข้อความสั้นสำหรับป้ายสถานะ เช่น "ออนไลน์" */
  label: string;
  /** ข้อความเต็มพร้อมเวลา เช่น "ออนไลน์ · ติดต่อล่าสุด 2 นาทีที่แล้ว" */
  text: string;
  /** สีที่ควรใช้ (CSS custom property) */
  color: string;
}

/** คืนค่า > 0 ถ้า a ใหม่กว่า b */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export function supportsHeartbeat(firmwareVersion: string | null | undefined): boolean {
  if (!firmwareVersion || !/^\d+\.\d+\.\d+$/.test(firmwareVersion)) return false;
  return compareVersions(firmwareVersion, HEARTBEAT_MIN_VERSION) >= 0;
}

export function deviceContact(
  lastSeenAt: string | null | undefined,
  firmwareVersion?: string | null
): DeviceContact {
  const d = parseServerTime(lastSeenAt);
  if (!d) {
    return { level: 'never', label: 'ยังไม่เคยติดต่อ', text: 'ยังไม่เคยติดต่อ', color: 'var(--ink-faint)' };
  }

  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  const seen = `ติดต่อล่าสุด ${relativeTime(lastSeenAt)}`;

  // เฟิร์มแวร์เก่า: รายงานสถานะไม่ได้ บอกได้แค่ว่าคุยกันครั้งสุดท้ายเมื่อไหร่
  if (!supportsHeartbeat(firmwareVersion)) {
    return {
      level: 'unreported',
      label: 'ไม่รายงานสถานะ',
      text: `${seen} · เฟิร์มแวร์เก่า ไม่รายงานสถานะ`,
      color: sec < CONTACT_TODAY_SEC ? 'var(--ink-soft)' : 'var(--wait)',
    };
  }

  if (sec < ONLINE_WINDOW_SEC) {
    return { level: 'online', label: 'ออนไลน์', text: `ออนไลน์ · ${seen}`, color: 'var(--up)' };
  }
  return { level: 'offline', label: 'ออฟไลน์', text: `ออฟไลน์ · ${seen}`, color: 'var(--down)' };
}

/* ---------------------------------------------------------------------------
 * สถานะรายการชำระเงิน
 *
 * คอลัมน์ transactions.status เป็น varchar(30) เก็บสถานะจาก Stripe ตรงๆ
 * ค่าที่มีจริงในระบบตอนนี้: pending, requires_action, succeeded
 * ------------------------------------------------------------------------- */

export interface StatusChip {
  label: string;
  /** class ของ chip ที่นิยามไว้ใน index.css */
  chip: string;
}

export function txStatusChip(status: string | null | undefined): StatusChip {
  switch ((status || '').toLowerCase()) {
    case 'succeeded':
      return { label: 'สำเร็จ', chip: 'chip chip-up' };
    case 'pending':
    case 'processing':
      return { label: 'รอดำเนินการ', chip: 'chip chip-wait' };
    case 'requires_action':
    case 'requires_payment_method':
    case 'requires_confirmation':
      return { label: 'ยังไม่ได้ชำระ', chip: 'chip chip-wait' };
    case 'canceled':
    case 'cancelled':
      return { label: 'ยกเลิก', chip: 'chip chip-mute' };
    case 'failed':
      return { label: 'ไม่สำเร็จ', chip: 'chip chip-down' };
    case 'refunded':
      return { label: 'คืนเงินแล้ว', chip: 'chip chip-mute' };
    default:
      // ไม่เดาว่าสำเร็จ — สถานะที่ไม่รู้จักต้องแสดงเป็นกลางและคงข้อความดิบไว้ให้ตรวจสอบได้
      return { label: status || 'ไม่ทราบสถานะ', chip: 'chip chip-mute' };
  }
}

/** สถานะรอบโอนเงิน — ต้องรู้จัก 'problem' ให้ครบทั้งฝั่งแอดมินและฝั่งลูกค้า */
export function settlementStatusChip(status: string | null | undefined): StatusChip {
  switch ((status || '').toLowerCase()) {
    case 'settled':
      return { label: 'โอนแล้ว', chip: 'chip chip-up' };
    case 'problem':
      return { label: 'พบปัญหา', chip: 'chip chip-down' };
    case 'pending':
      return { label: 'รอโอน', chip: 'chip chip-wait' };
    default:
      return { label: status || 'ไม่ทราบสถานะ', chip: 'chip chip-mute' };
  }
}
