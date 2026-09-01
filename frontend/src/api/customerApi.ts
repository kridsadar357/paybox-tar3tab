import { fetchJson, CUSTOMER_API_BASE } from './client';
import { downloadWithAuth } from '../lib/download';
import type {
  CustomerDevice,
  CustomerTransaction,
  CustomerSettlement,
  CustomerFeeInfo,
  CustomerSummary,
} from '../types';

/** ตัวกรองรายการชำระเงิน — backend รองรับมาตลอด แต่เดิมหน้าเว็บไม่เคยส่งมาให้ */
export interface TransactionFilters {
  status?: string;
  /** YYYY-MM-DD ตามเวลาไทย */
  from?: string;
  to?: string;
}

export const customerApi = {
  // otp ส่งเฉพาะรอบที่สอง (หลัง backend ตอบ otp_required) — บัญชีที่ไม่ได้เปิด 2FA ไม่ต้องส่งเลย
  async login(
    email: string,
    pass: string,
    otp?: string
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    // ต้องส่งเป็น JSON/urlencoded เท่านั้น — backend ไม่ได้ผูก multer ไว้กับ route นี้ (ไม่มีไฟล์ให้อัปโหลด)
    // ส่งเป็น multipart/form-data แล้ว req.body จะเป็น undefined ฝั่ง Express ทำให้ 500 ทันที
    const res = await fetch(`${CUSTOMER_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otp ? { email, password: pass, otp } : { email, password: pass }),
    });
    return res.json();
  },

  async getDevices(token: string): Promise<{
    success: boolean;
    fee_info?: CustomerFeeInfo;
    devices?: CustomerDevice[];
    error?: string;
  }> {
    return fetchJson(`${CUSTOMER_API_BASE}/devices?token=${encodeURIComponent(token)}`);
  },

  async getTransactions(
    token: string,
    deviceId?: number,
    limit: number = 50,
    beforeId?: number,
    filters?: TransactionFilters
  ): Promise<{
    success: boolean;
    transactions?: CustomerTransaction[];
    has_more?: boolean;
    error?: string;
  }> {
    const params = new URLSearchParams({
      token,
      limit: limit.toString(),
    });
    if (deviceId && deviceId > 0) params.append('device_id', deviceId.toString());
    if (filters?.status) params.append('status', filters.status);
    if (filters?.from) params.append('from', filters.from);
    if (filters?.to) params.append('to', filters.to);
    if (beforeId && beforeId > 0) params.append('before_id', beforeId.toString());

    return fetchJson(`${CUSTOMER_API_BASE}/transactions?${params.toString()}`);
  },

  // สรุปยอดพร้อมมิติเวลา + ยอดรอรับโอน — ช่วง from/to เป็นวันที่ตามเวลาไทย
  async getSummary(token: string, from?: string, to?: string): Promise<CustomerSummary> {
    const params = new URLSearchParams({ token });
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    return fetchJson(`${CUSTOMER_API_BASE}/summary?${params.toString()}`);
  },

  // ---- ดาวน์โหลด CSV (ใช้ตัวกรองชุดเดียวกับหน้าเว็บ แต่ไม่จำกัดหน้า) ----
  exportTransactions(token: string, deviceId?: number, filters?: TransactionFilters) {
    const params = new URLSearchParams();
    if (deviceId && deviceId > 0) params.append('device_id', deviceId.toString());
    if (filters?.status) params.append('status', filters.status);
    if (filters?.from) params.append('from', filters.from);
    if (filters?.to) params.append('to', filters.to);
    const qs = params.toString();
    return downloadWithAuth(
      `${CUSTOMER_API_BASE}/transactions.csv${qs ? `?${qs}` : ''}`,
      token,
      'paybox-transactions.csv'
    );
  },

  exportSettlements(token: string) {
    return downloadWithAuth(`${CUSTOMER_API_BASE}/settlements.csv`, token, 'paybox-settlements.csv');
  },

  async getSettlements(token: string): Promise<{
    success: boolean;
    settlements?: CustomerSettlement[];
    error?: string;
  }> {
    return fetchJson(`${CUSTOMER_API_BASE}/settlements?token=${encodeURIComponent(token)}`);
  },

  // สั่งรีสตาร์ตเครื่องของตัวเอง — ใช้เมื่อจอค้างหรือเครื่องไม่ตอบสนอง
  async restartDevice(token: string, deviceId: number): Promise<{ success: boolean; already_queued?: boolean }> {
    const res = await fetch(`${CUSTOMER_API_BASE}/devices/${deviceId}/restart?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
    return res.json();
  },

  // Banner (สไลด์ตอน idle) — จัดการแยกรายเครื่อง
  async getBanner(
    token: string,
    deviceId: number
  ): Promise<{
    success: boolean;
    banner_idle_sec?: number;
    slots?: { slot: number; url: string | null; type: string; fps: number; version: number }[];
    error?: string;
  }> {
    return fetchJson(`${CUSTOMER_API_BASE}/devices/${deviceId}/banner?token=${encodeURIComponent(token)}`);
  },

  async setBannerIdle(token: string, deviceId: number, idleSec: number): Promise<{ success: boolean }> {
    const res = await fetch(`${CUSTOMER_API_BASE}/devices/${deviceId}/banner/idle?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ banner_idle_sec: idleSec.toString() }).toString(),
    });
    return res.json();
  },

  async uploadBannerImage(
    token: string,
    deviceId: number,
    slot: number,
    file: File
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(
      `${CUSTOMER_API_BASE}/devices/${deviceId}/banner/${slot}/image?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: formData }
    );
    return res.json();
  },

  // อัปโหลดวิดีโอฟอร์แมตทั่วไป (mp4/mov/webm ฯลฯ) ตรงๆ — เซิร์ฟเวอร์แปลงเป็น .mjpeg ที่บอร์ดเล่นได้
  // เองทั้งหมดผ่าน ffmpeg ไม่ต้องแปลงไฟล์เองจากข้างนอก
  async uploadBannerVideo(
    token: string,
    deviceId: number,
    slot: number,
    file: File,
    fps: number
  ): Promise<{ success: boolean; error?: string; message?: string; frame_count?: number }> {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('fps', fps.toString());
    const res = await fetch(
      `${CUSTOMER_API_BASE}/devices/${deviceId}/banner/${slot}/video?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: formData }
    );
    return res.json();
  },

  async clearBannerSlot(token: string, deviceId: number, slot: number): Promise<{ success: boolean }> {
    const res = await fetch(
      `${CUSTOMER_API_BASE}/devices/${deviceId}/banner/${slot}/clear?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    return res.json();
  },
};
