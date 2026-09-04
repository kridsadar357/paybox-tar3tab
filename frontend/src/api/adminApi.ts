import { fetchJson, ADMIN_API_BASE } from './client';
import { downloadWithAuth } from '../lib/download';
import type {
  AdminSummaryResponse,
  DevicesResponse,
  Customer,
  PendingSettlement,
  PendingDeviceRow,
  HistoryDeviceRow,
  SettlementHistory,
  FirmwareRelease,
  TopologyDevice,
} from '../types';

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export const adminApi = {
  // เช็ค admin_password ครั้งเดียว ได้ session token กลับมาใช้แทนในทุก request ถัดไป — ไม่ส่ง
  // admin_password ปนไปกับ query string ของ request อื่นๆ อีกต่อไป (หลุดไปอยู่ใน access log ของ
  // reverse proxy / browser history ได้)
  // แต่ละคนมีบัญชีของตัวเองแล้ว (ตาราง admins) — บันทึกการใช้งานจึงระบุตัวคนทำได้จริง
  // ถ้าบัญชีเปิด 2FA ไว้ รอบแรก backend ตอบ otp_required กลับมาให้หน้าเว็บขึ้นช่องกรอกรหัส 6 หลัก
  async login(
    username: string,
    password: string,
    otp?: string
  ): Promise<{ success: boolean; token?: string; username?: string; error?: string }> {
    const body = new URLSearchParams({ username, password });
    if (otp) body.set('otp', otp);
    const res = await fetch(`${ADMIN_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return res.json();
  },

  // GET Resources
  async getSummary(token: string, from?: string, to?: string): Promise<AdminSummaryResponse> {
    const params = new URLSearchParams({ resource: 'summary' });
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    return fetchJson<AdminSummaryResponse>(`${ADMIN_API_BASE}?${params.toString()}`, {
      headers: authHeaders(token),
    });
  },

  // เปลี่ยนผู้ให้บริการของเครื่อง มีผลกับรายการใหม่เท่านั้น รายการเก่ายังผูกกับเจ้าเดิมของมัน
  async setDeviceProvider(token: string, deviceId: number, paymentProvider: string) {
    return this.postAction(token, 'set_provider', {
      device_id: deviceId,
      payment_provider: paymentProvider,
    });
  },

  async getDevices(token: string): Promise<DevicesResponse> {
    return fetchJson<DevicesResponse>(`${ADMIN_API_BASE}?resource=devices`, {
      headers: authHeaders(token),
    });
  },

  // สั่งอัปเดตเฟิร์มแวร์ — เข้าคิว ไม่ได้ยิงถึงเครื่องทันที เพราะบอร์ดอยู่หลัง NAT
  // และคำสั่งจะยังไม่ถูกปล่อยจนกว่าเครื่องจะไม่มีรายการเคลื่อนไหวครบ 5 นาที
  async queueForceUpdate(token: string, deviceIds: number[]) {
    return this.postAction(token, 'queue_force_update', { device_ids: deviceIds.join(',') });
  },

  // รีสตาร์ตไม่เข้าคิวรอเครื่องนิ่งเหมือนอัปเดต — เหตุผลหลักที่สั่งคือเครื่องค้าง
  // ซึ่งเป็นตอนที่ตัวนับ "นิ่ง 5 นาที" อาจไม่มีวันครบ
  async restartDevices(token: string, deviceIds: number[]) {
    return this.postAction(token, 'restart_device', { device_ids: deviceIds.join(',') });
  },

  async cancelForceUpdate(token: string, deviceIds: number[]) {
    return this.postAction(token, 'cancel_force_update', { device_ids: deviceIds.join(',') });
  },

  async getCustomers(token: string): Promise<{ success: boolean; customers: Customer[]; provider_fee_percent?: number }> {
    return fetchJson<{ success: boolean; customers: Customer[]; provider_fee_percent?: number }>(`${ADMIN_API_BASE}?resource=customers`, {
      headers: authHeaders(token),
    });
  },

  async getSettlements(token: string): Promise<{
    success: boolean;
    pending: PendingSettlement[];
    pending_devices: PendingDeviceRow[];
    history: SettlementHistory[];
    history_devices: HistoryDeviceRow[];
  }> {
    return fetchJson(`${ADMIN_API_BASE}?resource=settlements`, { headers: authHeaders(token) });
  },

  async getTopology(token: string): Promise<{ success: boolean; devices: TopologyDevice[]; server_time: string }> {
    return fetchJson(`${ADMIN_API_BASE}?resource=topology`, { headers: authHeaders(token) });
  },

  markProblem: function (token: string, settlementId: number, note: string) {
    return this.postAction(token, 'mark_problem', { settlement_id: settlementId, note });
  },

  clearProblem: function (token: string, settlementId: number) {
    return this.postAction(token, 'clear_problem', { settlement_id: settlementId });
  },

  async getReleases(token: string): Promise<{ success: boolean; releases: FirmwareRelease[] }> {
    return fetchJson(`${ADMIN_API_BASE}?resource=releases`, { headers: authHeaders(token) });
  },

  // POST Actions
  async postAction(token: string, action: string, data: Record<string, any> = {}): Promise<any> {
    const formData = new FormData();
    formData.append('action', action);

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value.toString());
      }
    });

    const res = await fetch(ADMIN_API_BASE, {
      method: 'POST',
      headers: authHeaders(token),
      body: formData,
    });
    return res.json();
  },

  async addDevice(token: string, deviceName: string, paymentProvider?: string) {
    return this.postAction(token, 'add_device', {
      device_name: deviceName,
      payment_provider: paymentProvider,
    });
  },

  async toggleDevice(token: string, deviceId: number) {
    return this.postAction(token, 'toggle', { device_id: deviceId });
  },

  async assignDevice(token: string, deviceId: number, customerId: number) {
    return this.postAction(token, 'assign_device', { device_id: deviceId, customer_id: customerId });
  },

  // ---- ดาวน์โหลด CSV ----
  exportSettlements(token: string) {
    return downloadWithAuth(`${ADMIN_API_BASE}/export/settlements.csv`, token, 'paybox-settlements-all.csv');
  },

  exportReport(token: string, kind: 'daily' | 'devices', from: string, to: string) {
    const qs = new URLSearchParams({ kind, from, to }).toString();
    return downloadWithAuth(`${ADMIN_API_BASE}/reports/export.csv?${qs}`, token, `paybox-report-${kind}.csv`);
  },

  async updateCustomer(token: string, customerId: number, name: string, email: string) {
    return this.postAction(token, 'update_customer', {
      customer_id: customerId,
      customer_name: name,
      customer_email: email,
    });
  },

  async addCustomer(token: string, name: string, email: string, pass: string) {
    return this.postAction(token, 'add_customer', {
      customer_name: name,
      customer_email: email,
      customer_password: pass,
    });
  },

  async toggleCustomer(token: string, customerId: number) {
    return this.postAction(token, 'toggle_customer', { customer_id: customerId });
  },

  // กู้คืนการเข้าถึงบัญชีลูกค้า — ทั้งสองแอ็กชันตัด session เดิมทิ้งทั้งหมดที่ฝั่ง backend
  async resetCustomerPassword(token: string, customerId: number, newPassword: string) {
    return this.postAction(token, 'reset_customer_password', {
      customer_id: customerId,
      new_password: newPassword,
    });
  },

  async disableCustomer2fa(token: string, customerId: number) {
    return this.postAction(token, 'disable_customer_2fa', { customer_id: customerId });
  },

  async updateFee(
    token: string,
    customerId: number,
    feeTier: 'percentage' | 'flat',
    feePercent: number,
    flatFeeAmount: number
  ) {
    return this.postAction(token, 'update_fee', {
      customer_id: customerId,
      fee_tier: feeTier,
      fee_percent: feePercent,
      flat_fee_amount: flatFeeAmount,
    });
  },

  async createSettlement(token: string, customerId: number) {
    return this.postAction(token, 'create_settlement', { customer_id: customerId });
  },

  async markSettled(token: string, settlementId: number, proofReference?: string, proofFile?: File) {
    const formData = new FormData();
    formData.append('action', 'mark_settled');
    formData.append('settlement_id', settlementId.toString());
    if (proofReference) formData.append('proof_reference', proofReference);
    if (proofFile) formData.append('proof_file', proofFile);

    const res = await fetch(ADMIN_API_BASE, {
      method: 'POST',
      headers: authHeaders(token),
      body: formData,
    });
    return res.json();
  },
};
