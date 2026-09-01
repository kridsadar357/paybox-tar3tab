// compareVersions เคยพลาดมาแล้ว: โค้ดเดิมใช้ !== แทนการเทียบว่าใหม่กว่า ทำให้ระบบปิดคำสั่ง
// อัปเดตว่าสำเร็จทั้งที่เครื่องยังรัน firmware ตัวเก่าอยู่
import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/lib/version';

describe('compareVersions', () => {
  it('เทียบทีละส่วนแบบตัวเลข ไม่ใช่เทียบสตริง', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
  });

  it('เท่ากันคืนศูนย์', () => {
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0);
  });

  it('ใหม่กว่าเป็นบวก เก่ากว่าเป็นลบ', () => {
    expect(compareVersions('1.6.0', '1.5.1')).toBeGreaterThan(0);
    expect(compareVersions('1.5.1', '1.6.0')).toBeLessThan(0);
  });

  it('จำนวนส่วนไม่เท่ากันก็เทียบได้', () => {
    expect(compareVersions('1.6', '1.6.0')).toBe(0);
    expect(compareVersions('1.6.1', '1.6')).toBeGreaterThan(0);
  });
});
