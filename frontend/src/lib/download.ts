/**
 * ดาวน์โหลดไฟล์จาก endpoint ที่ต้องยืนยันตัวตน
 *
 * ใช้ fetch + blob แทนการชี้ <a href> ตรงๆ เพราะแบบหลังต้องแนบ token ไปใน URL ซึ่งจะไปโผล่ใน
 * access log ของ reverse proxy และ history ของเบราว์เซอร์ — ปัญหาเดียวกับที่เคยย้าย admin_password
 * ออกจาก query string มาแล้ว
 */
export async function downloadWithAuth(url: string, token: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`ดาวน์โหลดไม่สำเร็จ (${res.status})`);
  }

  // ใช้ชื่อไฟล์ที่เซิร์ฟเวอร์กำหนดมาถ้ามี
  const disp = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const name = match ? match[1] : fallbackName;

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ปล่อย object URL คืน ไม่งั้น blob ค้างใน memory จนกว่าจะปิดแท็บ
  URL.revokeObjectURL(href);
}
