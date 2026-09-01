// ที่อยู่ของ API ที่หน้าเว็บเรียกใช้
//
// ค่าเริ่มต้นเป็นสตริงว่าง = ใช้ origin เดียวกับหน้าเว็บ ซึ่งถูกต้องอยู่แล้วเพราะ backend เป็นคนเสิร์ฟ
// ไฟล์หน้าเว็บเอง ทั้ง /api/* และหน้าเว็บจึงอยู่โดเมนเดียวกันเสมอ
//
// เดิมค่าเริ่มต้นเป็นโดเมน production ของผู้พัฒนา ผลคือใครก็ตามที่ build โดยไม่ตั้ง VITE_API_ROOT
// จะได้หน้าล็อกอินที่ส่งรหัสผ่านไปยังเซิร์ฟเวอร์ของคนอื่นโดยไม่รู้ตัว
//
// ตั้ง VITE_API_ROOT ตอน build เมื่อหน้าเว็บกับ API อยู่คนละที่ เช่น dev server ชี้ไป localhost:3001
export const API_ROOT = (import.meta.env.VITE_API_ROOT as string) || '';

export const ADMIN_API_BASE = `${API_ROOT}/api/admin`;
export const DEVICE_SETTINGS_API_BASE = `${API_ROOT}/api/admin/device_settings`;
export const CUSTOMER_API_BASE = `${API_ROOT}/api/customer`;
export const FILES_BASE = `${API_ROOT}/files`;
export const FIRMWARE_BASE = `${API_ROOT}/devices/firmware`;

// เก็บไว้เผื่อโค้ดเก่าอ้างถึง (device_settings.php ลิงก์ลิงก์ตรงไปหน้า PHP เดิม — ตอนนี้ backend
// ให้ /api/admin/device_settings/:id แทน ไม่มีหน้า HTML แยกอีกต่อไป ต้องต่อ UI ใน React ถ้าต้องใช้)
export const getApiBaseUrl = (): string => `${API_ROOT}/`;

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : url;

  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}`;
    try {
      const errData = await response.json();
      if (errData.error) errorMsg = errData.error;
    } catch {
      // Ignore JSON parse error on non-OK response
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
