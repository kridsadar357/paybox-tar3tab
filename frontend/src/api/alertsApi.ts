// ตั้งค่าช่องทางแจ้งเตือน
//
// backend ไม่เคยส่ง token กลับมาให้เลย มีแค่ token_hint (สี่ตัวท้าย) ไว้ยืนยันว่าใส่ตัวไหนไว้
// หน้าเว็บจึงเติมค่าเดิมกลับเข้าช่องกรอกไม่ได้ และไม่ควรพยายามทำด้วย
import { ADMIN_API_BASE } from './client';

const BASE = `${ADMIN_API_BASE}/alerts`;

export type ChannelKey = 'telegram' | 'line';

export interface ChannelStatus {
  configured: boolean;
  target: string | null;
  token_hint: string | null;
  /** เฉพาะ LINE — ถ้ายังไม่ใส่ channel secret จะตรวจลายเซ็น webhook ไม่ได้ */
  secret_configured?: boolean;
}

export interface WatcherStatus {
  last_run: string | null;
  states: { key: string; status: string }[];
}

export interface AlertsConfig {
  success: boolean;
  channels: Record<ChannelKey, ChannelStatus>;
  watcher: WatcherStatus;
  line_webhook_url: string;
}

export interface TelegramChat {
  id: string;
  name: string;
}

export interface LineSource {
  id: string;
  type: string;
  name: string;
  at: string;
}

export interface AlertsResult {
  success: boolean;
  message?: string;
  error?: string;
  channels?: Record<ChannelKey, ChannelStatus>;
}

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function send<T>(token: string, path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export interface SavePatch {
  token?: string;
  secret?: string;
  target?: string;
}

export const alertsApi = {
  get: async (token: string): Promise<AlertsConfig> => {
    const res = await fetch(`${BASE}/config`, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
  },

  // ส่งเฉพาะช่องที่ผู้ใช้กรอกใหม่ ช่องว่างแปลว่า "ใช้ของเดิม" ไม่ใช่ "ลบ"
  save: (token: string, channel: ChannelKey, patch: SavePatch): Promise<AlertsResult> =>
    send(token, '/config', 'POST', {
      channel,
      token: patch.token || undefined,
      secret: patch.secret || undefined,
      target: patch.target || undefined,
    }),

  clear: (token: string, channel: ChannelKey): Promise<AlertsResult> =>
    send(token, `/config/${channel}`, 'DELETE'),

  test: (token: string, channel: ChannelKey): Promise<AlertsResult> =>
    send(token, '/test', 'POST', { channel }),

  discoverChats: (token: string, tokenValue: string): Promise<AlertsResult & { chats?: TelegramChat[] }> =>
    send(token, '/telegram/chats', 'POST', { token: tokenValue || undefined }),

  lineSources: async (
    token: string
  ): Promise<{ success: boolean; sources: LineSource[]; secret_configured: boolean; webhook_url: string }> => {
    const res = await fetch(`${BASE}/line/sources`, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
  },
};
