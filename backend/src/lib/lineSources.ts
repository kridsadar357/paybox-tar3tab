// จำปลายทางของ LINE ที่เคยทักบอทเข้ามา เพื่อให้แอดมินเลือกจากหน้าเว็บได้
//
// มีอยู่เพราะ LINE ไม่แสดง groupId ที่ไหนในหน้า console เลย ทางเดียวที่จะรู้คือรับ webhook แล้วอ่าน
// จาก event ที่ส่งมา — ต่างจาก Telegram ที่ถาม getUpdates ย้อนหลังได้ ของ LINE ถ้าไม่ดักไว้ตอนนั้น
// ก็ไม่มีทางรู้ย้อนหลัง จึงต้องเก็บลงไฟล์ทันทีที่ event เข้ามา
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface LineSource {
  id: string;
  type: string;
  name: string;
  at: string;
}

/** เก็บพอให้เลือกได้ ไม่ใช่เก็บเป็นประวัติ — ถ้าไม่จำกัดไว้ ไฟล์จะโตตามทุกข้อความที่มีคนทักบอท */
const MAX = 20;

const FILE = () => path.join(config.alertsDir, 'line-sources.json');

export function readSources(): LineSource[] {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return Array.isArray(data) ? data.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** ตัวใหม่ไปอยู่บนสุดเสมอ และ id เดิมถูกแทนที่ ไม่ใช่เพิ่มซ้ำ */
export function rememberSource(entry: Omit<LineSource, 'at'>): void {
  try {
    const list = readSources().filter((s) => s.id !== entry.id);
    list.unshift({ ...entry, at: new Date().toISOString() });

    fs.mkdirSync(config.alertsDir, { recursive: true, mode: 0o700 });
    const tmp = path.join(config.alertsDir, `.line-sources.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(list.slice(0, MAX), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE());
  } catch (err) {
    // เขียนไม่ได้ไม่ควรทำให้ webhook ตอบ error กลับไปหา LINE — LINE จะรีทรายและปิด endpoint ถ้าพลาดบ่อย
    // eslint-disable-next-line no-console
    console.error('[line] จำปลายทางไม่สำเร็จ:', err);
  }
}
