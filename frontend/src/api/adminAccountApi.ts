import { ADMIN_API_BASE } from './client';

const BASE = `${ADMIN_API_BASE}/account`;

export interface AdminProfile {
  id: number;
  username: string;
  name: string;
  email: string | null;
  is_owner: number;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminAccountData {
  success: boolean;
  profile: AdminProfile;
  security: { totp_enabled: boolean; password_changed_at: string | null };
}

export interface AdminSession {
  id: number;
  created_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: number;
}

export interface AdminRow {
  id: number;
  username: string;
  name: string;
  email: string | null;
  is_owner: number;
  is_active: number;
  totp_enabled: number;
  last_login_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  admin_id: number | null;
  admin_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

type Ok = { success: boolean; error?: string; message?: string };

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function post<T = Ok>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: auth(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

export const adminAccountApi = {
  get: (token: string) => get<AdminAccountData>(token, '/profile'),

  updateProfile: (token: string, name: string, email: string) => post(token, '/profile', { name, email }),

  changePassword: (token: string, current_password: string, new_password: string) =>
    post(token, '/password', { current_password, new_password }),

  start2fa: (token: string) =>
    post<{ success: boolean; secret?: string; otpauth?: string; qr?: string; message?: string }>(token, '/2fa/setup'),

  enable2fa: (token: string, code: string) => post(token, '/2fa/enable', { code }),

  disable2fa: (token: string, password: string, code: string) => post(token, '/2fa/disable', { password, code }),

  sessions: (token: string) => get<{ success: boolean; sessions: AdminSession[] }>(token, '/sessions'),

  revokeOtherSessions: (token: string) => post<Ok & { revoked?: number }>(token, '/sessions/revoke_others'),

  // จัดการบัญชีผู้ดูแลระบบคนอื่น
  admins: (token: string) => get<{ success: boolean; admins: AdminRow[] }>(token, '/admins'),

  createAdmin: (token: string, username: string, name: string, email: string, password: string) =>
    post(token, '/admins', { username, name, email, password }),

  toggleAdmin: (token: string, admin_id: number) => post(token, '/admins/toggle', { admin_id }),

  resetAdminPassword: (token: string, admin_id: number, new_password: string) =>
    post(token, '/admins/reset_password', { admin_id, new_password }),

  disableAdmin2fa: (token: string, admin_id: number) => post(token, '/admins/disable_2fa', { admin_id }),

  // บันทึกการใช้งาน
  audit: (token: string, opts: { beforeId?: number; action?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.beforeId) p.set('before_id', String(opts.beforeId));
    if (opts.action) p.set('action', opts.action);
    const qs = p.toString();
    return get<{ success: boolean; entries: AuditEntry[]; has_more: boolean; actions: string[] }>(
      token,
      `/audit${qs ? `?${qs}` : ''}`
    );
  },
};

/** คำอธิบายภาษาไทยของ action แต่ละชนิด ใช้ทำตัวกรองและป้ายในหน้าบันทึกการใช้งาน */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  add_device: 'เพิ่มอุปกรณ์',
  toggle_device: 'เปิด/ปิดอุปกรณ์',
  assign_device: 'ย้ายเจ้าของอุปกรณ์',
  add_customer: 'สร้างบัญชีลูกค้า',
  toggle_customer: 'เปิด/ระงับบัญชีลูกค้า',
  update_fee: 'แก้ค่าธรรมเนียม',
  create_settlement: 'เปิดรอบโอนเงิน',
  mark_settled: 'ปิดรอบโอนเงิน',
  mark_problem: 'แจ้งรอบมีปัญหา',
  clear_problem: 'ยกเลิกสถานะมีปัญหา',
  reset_customer_password: 'รีเซ็ตรหัสผ่านลูกค้า',
  disable_customer_2fa: 'ปลด 2FA ลูกค้า',
  admin_create: 'สร้างบัญชีผู้ดูแล',
  admin_toggle: 'เปิด/ระงับบัญชีผู้ดูแล',
  admin_reset_password: 'รีเซ็ตรหัสผ่านผู้ดูแล',
  admin_change_password: 'เปลี่ยนรหัสผ่านตัวเอง',
  admin_enable_2fa: 'เปิด 2FA',
  admin_disable_2fa: 'ปิด 2FA',
  admin_disable_2fa_other: 'ปลด 2FA ผู้ดูแลคนอื่น',
  admin_revoke_sessions: 'ออกจากระบบอุปกรณ์อื่น',
  alerts_config_update: 'ตั้งค่าช่องทางแจ้งเตือน',
  alerts_test: 'ทดสอบส่งแจ้งเตือน',
};

/** แอ็กชันที่แตะเงินหรือสิทธิ์โดยตรง — เน้นสีในรายการเพื่อให้กวาดตาเจอง่าย */
export const AUDIT_SENSITIVE = new Set([
  'mark_settled',
  'update_fee',
  'reset_customer_password',
  'disable_customer_2fa',
  'admin_create',
  'admin_toggle',
  'admin_reset_password',
  'admin_disable_2fa_other',
]);
