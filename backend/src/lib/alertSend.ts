// ส่งข้อความทดสอบจากหน้าเว็บ
//
// ตั้งใจให้ซ้ำกับ ops/notify.sh: ตัวนั้นเป็นของ cron บน host ที่ต้องทำงานได้แม้ backend ล่มทั้งตัว
// จึงพึ่ง backend ไม่ได้ ส่วนตัวนี้อยู่ในคอนเทนเนอร์ซึ่งเรียกสคริปต์บน host ไม่ได้ — ความซ้ำนี้คือ
// ราคาที่จ่ายเพื่อให้การแจ้งเตือนไม่ผูกกับสิ่งที่มันเฝ้าอยู่ ถ้าแก้ปลายทางหรือรูปแบบข้อความ
// ต้องแก้ทั้งสองที่
import { ChannelKey } from './alertConfig';

export interface SendResult {
  ok: boolean;
  /** ข้อความอธิบายที่ปลอดภัยพอจะแสดงให้แอดมินเห็น — ต้องไม่มี token ปนอยู่ */
  message: string;
}

const TIMEOUT_MS = 15_000;

async function post(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: (await res.text()).slice(0, 400) };
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<SendResult> {
  // ไม่ตั้ง parse_mode เพราะชื่อร้านที่ลูกค้าตั้งเองอาจมี _ * [ ] ปนอยู่ ซึ่งจะทำให้ Markdown พัง
  // แล้ว Telegram จะปฏิเสธทั้งข้อความ
  const { status, body } = await post(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ chat_id: chatId, text }).toString(),
  });

  if (status === 200) return { ok: true, message: 'ส่งสำเร็จ' };

  let detail = '';
  try {
    detail = String(JSON.parse(body)?.description || '');
  } catch {
    detail = '';
  }
  if (status === 401) return { ok: false, message: 'Telegram ปฏิเสธ token นี้ — ตรวจว่าคัดลอกมาครบไหม' };
  if (status === 400 && /chat not found/i.test(detail)) {
    return { ok: false, message: 'ไม่พบห้องแชตนี้ — ต้องทักบอทอย่างน้อยหนึ่งข้อความก่อน บอทถึงจะส่งกลับได้' };
  }
  return { ok: false, message: `Telegram ตอบ ${status}${detail ? `: ${detail}` : ''}` };
}

async function sendLine(token: string, to: string, text: string): Promise<SendResult> {
  const { status, body } = await post('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });

  if (status === 200) return { ok: true, message: 'ส่งสำเร็จ' };

  let detail = '';
  try {
    detail = String(JSON.parse(body)?.message || '');
  } catch {
    detail = '';
  }
  if (status === 401) return { ok: false, message: 'LINE ปฏิเสธ token นี้ — ตรวจว่าเป็น channel access token แบบ long-lived ไหม' };
  if (status === 403) {
    return { ok: false, message: 'LINE ไม่อนุญาตให้ส่ง — ตรวจว่าเปิดใช้ Messaging API ของ channel นี้แล้ว' };
  }
  if (status === 400) {
    return { ok: false, message: `ปลายทางไม่ถูกต้อง${detail ? `: ${detail}` : ''} — user id ขึ้นต้นด้วย U และ group id ขึ้นต้นด้วย C` };
  }
  return { ok: false, message: `LINE ตอบ ${status}${detail ? `: ${detail}` : ''}` };
}

export async function sendTest(ch: ChannelKey, token: string, target: string, text: string): Promise<SendResult> {
  try {
    return ch === 'telegram' ? await sendTelegram(token, target, text) : await sendLine(token, target, text);
  } catch (err: any) {
    // timeout หรือ DNS พัง — บอกให้ชัดว่าเป็นปัญหาเครือข่าย ไม่ใช่ค่าที่กรอกผิด
    const reason = err?.name === 'TimeoutError' ? 'หมดเวลารอ 15 วินาที' : 'ต่อออกอินเทอร์เน็ตไม่ได้';
    return { ok: false, message: `ส่งไม่สำเร็จ: ${reason}` };
  }
}

export interface TelegramChat {
  id: string;
  name: string;
}

/**
 * อ่านห้องแชตที่เคยทักบอทมา เพื่อให้แอดมินเลือก chat id จากหน้าเว็บได้เลย
 *
 * มีอยู่เพราะ chat id ของ Telegram ไม่มีที่ไหนแสดงให้ดู วิธีเดียวคือเรียก getUpdates แล้วอ่านเอง
 * ถ้าไม่ทำให้ แอดมินต้อง ssh เข้าเครื่องไปรันสคริปต์ ซึ่งขัดกับเจตนาที่ให้ตั้งค่าจบในหน้าเว็บ
 */
export async function discoverTelegramChats(
  token: string
): Promise<{ ok: boolean; message: string; chats: TelegramChat[] }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => null);

    if (!data?.ok) {
      const why = res.status === 401 ? 'token ไม่ถูกต้อง' : String(data?.description || `HTTP ${res.status}`);
      return { ok: false, message: `Telegram ปฏิเสธ: ${why}`, chats: [] };
    }

    const seen = new Map<string, string>();
    for (const u of data.result || []) {
      const chat = (u.message || u.channel_post || {}).chat;
      if (!chat) continue;
      const name =
        chat.title ||
        [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
        chat.username ||
        chat.type ||
        'ไม่ทราบชื่อ';
      seen.set(String(chat.id), String(name));
    }

    if (seen.size === 0) {
      return {
        ok: false,
        // getUpdates เห็นเฉพาะข้อความใหม่ที่ยังไม่ถูกดึงไป และเก็บไว้ราว 24 ชั่วโมงเท่านั้น
        message: 'ยังไม่มีข้อความเข้ามา — ทักบอทสักหนึ่งข้อความแล้วลองใหม่ (ถ้าจะใช้กลุ่ม ให้พิมพ์ในกลุ่ม)',
        chats: [],
      };
    }

    return { ok: true, message: `พบ ${seen.size} ห้อง`, chats: [...seen].map(([id, name]) => ({ id, name })) };
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? 'หมดเวลารอ' : 'ต่อออกอินเทอร์เน็ตไม่ได้';
    return { ok: false, message: `ค้นหาไม่สำเร็จ: ${reason}`, chats: [] };
  }
}
