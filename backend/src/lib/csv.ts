// สร้างและส่งไฟล์ CSV
//
// ข้อควรระวังที่เจอบ่อยกับข้อมูลภาษาไทย: Excel บน Windows ไม่เดาว่าไฟล์เป็น UTF-8 ถ้าไม่มี BOM
// นำหน้า ตัวอักษรไทยจะกลายเป็นขยะทั้งไฟล์ — จึงต้องใส่ U+FEFF เสมอ และใช้ CRLF ตามที่ Excel คาดหวัง
import { Response } from 'express';

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    // ครอบด้วยเครื่องหมายคำพูดเมื่อมีอักขระที่ทำให้คอลัมน์เพี้ยน และ escape " ด้วยการซ้ำตัวเอง
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** ชื่อไฟล์ต้องเป็น ASCII เท่านั้น — ชื่อไทยใน Content-Disposition ทำให้บาง browser ตั้งชื่อเพี้ยน */
export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(csv);
}

/** วันที่-เวลาแบบอ่านง่ายตามเวลาไทย สำหรับใส่ในไฟล์ที่คนเอาไปเปิดดู */
export function thaiDateTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  const t = new Date(d.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(
    t.getUTCMinutes()
  )}:${p(t.getUTCSeconds())}`;
}
