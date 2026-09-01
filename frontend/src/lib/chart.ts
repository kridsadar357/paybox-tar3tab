import { useState, useEffect } from 'react';

/* ---------------------------------------------------------------------------
   จานสีของกราฟ — ผ่านการตรวจด้วย validator แล้วทั้งสองโหมด (ไม่ได้เลือกด้วยสายตา)
   light  #0D9488 / #C2410C : CVD ΔE 13.7 · normal 27.1 · contrast ผ่าน
   dark   #0FA89B / #D2691E : CVD ΔE 14.6 · normal 25.0 · contrast ผ่าน
   แถบ lightness ของสองโหมดต่างกัน (light 0.43–0.77, dark 0.48–0.67) จึงใช้ชุดเดียวกันไม่ได้

   ย้ายมาไว้ตรงกลางเพื่อไม่ให้ค่าที่ผ่านการตรวจแล้วถูกคัดลอกไปหลายที่แล้วค่อยๆ เพี้ยนจากกัน
   --------------------------------------------------------------------------- */
export const DUO = {
  a: { light: '#0D9488', dark: '#0FA89B' },
  b: { light: '#C2410C', dark: '#D2691E' },
} as const;

export const pick = (slot: { light: string; dark: string }, dark: boolean) => (dark ? slot.dark : slot.light);

/** ธีมมี 3 สถานะ: เลือกไว้ชัดเจน (data-theme) หรือปล่อยตามระบบ — ต้องอ่านทั้งสองทาง */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };
    setDark(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(read());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}
