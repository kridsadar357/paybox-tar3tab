// ไฟล์ CSV ที่ export ออกไปมีเลขบัญชีธนาคารและยอดเงินของลูกค้า การ escape ผิดทำให้คอลัมน์
// เลื่อน แล้วตัวเลขของคนหนึ่งจะไปโผล่ในแถวของอีกคน
import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/lib/csv';

describe('toCsv', () => {
  it('ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยออก', () => {
    expect(toCsv(['ชื่อ'], [['ร้านทดสอบ']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('ครอบด้วยอัญประกาศเมื่อมีจุลภาคอยู่ในข้อมูล', () => {
    const csv = toCsv(['a', 'b'], [['ก, ข', 'ค']]);
    expect(csv).toContain('"ก, ข"');
  });

  it('escape อัญประกาศด้วยการซ้ำสองตัวตามสเปก', () => {
    expect(toCsv(['a'], [['เขาบอกว่า "ได้"']])).toContain('"เขาบอกว่า ""ได้"""');
  });

  it('ขึ้นบรรทัดใหม่ในข้อมูลต้องไม่ทำให้กลายเป็นแถวใหม่', () => {
    const csv = toCsv(['a', 'b'], [['บรรทัดหนึ่ง\nบรรทัดสอง', 'x']]);
    const dataRows = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(dataRows).toHaveLength(2); // หัวตาราง + ข้อมูลหนึ่งแถว
  });

  it('null กับ undefined กลายเป็นช่องว่าง ไม่ใช่คำว่า null', () => {
    const csv = toCsv(['a', 'b', 'c'], [[null, undefined, 0]]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    expect(csv.trim().endsWith('0')).toBe(true);
  });
});
