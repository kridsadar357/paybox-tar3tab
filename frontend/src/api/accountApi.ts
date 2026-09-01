import { CUSTOMER_API_BASE } from './client';

const BASE = `${CUSTOMER_API_BASE}/account`;

export interface AccountProfile {
  name: string;
  email: string;
  phone: string | null;
  created_at: string;
  is_active: number;
  device_count: number;
}

export interface AccountData {
  success: boolean;
  profile: AccountProfile;
  billing: { fee_tier: 'percentage' | 'flat'; fee_percent: number; flat_fee_amount: number };
  security: { totp_enabled: boolean; password_changed_at: string | null };
  payout: { bank: string | null; account_no: string | null; account_name: string | null };
}

export interface AccountSession {
  id: number;
  created_at: string;
  expires_at: string;
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

export const accountApi = {
  async get(token: string): Promise<AccountData> {
    const res = await fetch(`${BASE}/profile`, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
  },

  updateProfile: (token: string, name: string, phone: string) => post(token, '/profile', { name, phone }),

  changePassword: (token: string, current_password: string, new_password: string) =>
    post(token, '/password', { current_password, new_password }),

  start2fa: (token: string) =>
    post<{ success: boolean; secret?: string; otpauth?: string; qr?: string; message?: string }>(token, '/2fa/setup'),

  enable2fa: (token: string, code: string) => post(token, '/2fa/enable', { code }),

  disable2fa: (token: string, password: string, code: string) => post(token, '/2fa/disable', { password, code }),

  updatePayout: (token: string, bank: string, account_no: string, account_name: string) =>
    post(token, '/payout', { bank, account_no, account_name }),

  async sessions(token: string): Promise<{ success: boolean; sessions: AccountSession[] }> {
    const res = await fetch(`${BASE}/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
  },

  revokeOtherSessions: (token: string) => post<Ok & { revoked?: number }>(token, '/sessions/revoke_others'),
};

export const THAI_BANKS = [
  'กสิกรไทย (KBank)',
  'ไทยพาณิชย์ (SCB)',
  'กรุงเทพ (BBL)',
  'กรุงไทย (KTB)',
  'กรุงศรีอยุธยา (BAY)',
  'ทหารไทยธนชาต (ttb)',
  'ออมสิน (GSB)',
  'ธ.ก.ส. (BAAC)',
  'ซีไอเอ็มบี ไทย (CIMBT)',
  'ยูโอบี (UOB)',
  'แลนด์ แอนด์ เฮ้าส์ (LH Bank)',
  'เกียรตินาคินภัทร (KKP)',
];
