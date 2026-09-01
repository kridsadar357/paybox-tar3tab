// อ่าน/เขียน credential ของช่องทางแจ้งเตือน
//
// เก็บเป็นไฟล์บนดิสก์ที่ bind-mount ร่วมกับ host ไม่ใช่ในฐานข้อมูล เพราะตัวเฝ้าระวังคือ cron ที่รัน
// บน host และหน้าที่หนึ่งของมันคือแจ้งว่า "ต่อฐานข้อมูลไม่ได้" — ถ้าเอา credential ไปไว้ในฐานข้อมูล
// พอฐานข้อมูลล่มมันจะอ่านค่าไม่ได้แล้วเงียบสนิทพอดีกับตอนที่ต้องส่งเสียงที่สุด
//
// backend เขียนไฟล์ / cron อ่านไฟล์ ต่างฝ่ายต่างไม่ต้องรู้จักกัน และถ้า backend ล่มทั้งตัว
// การแจ้งเตือนก็ยังทำงานด้วยค่าที่เขียนไว้ล่าสุด
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export type ChannelKey = 'telegram' | 'line';

/** LINE ต้องใช้ channel secret เพิ่มอีกตัวสำหรับตรวจลายเซ็น webhook — ส่งข้อความอย่างเดียวไม่ต้องใช้ */
const KEYS = {
  telegram: { token: 'TELEGRAM_BOT_TOKEN', target: 'TELEGRAM_CHAT_ID' },
  line: { token: 'LINE_CHANNEL_ACCESS_TOKEN', target: 'LINE_TO', secret: 'LINE_CHANNEL_SECRET' },
} as const;

const FILE = () => path.join(config.alertsDir, 'env.alerts');

function readRaw(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(FILE(), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return out;
  } catch {
    // ยังไม่เคยตั้งค่า — ถือว่าว่าง ไม่ใช่ความผิดพลาด
    return {};
  }
}

function writeRaw(values: Record<string, string>): void {
  fs.mkdirSync(config.alertsDir, { recursive: true, mode: 0o700 });

  const body =
    '# Credential ของช่องทางแจ้งเตือน PayBox\n' +
    '#\n' +
    '# ไฟล์นี้ถูกเขียนโดยหน้า "ตั้งค่า > การแจ้งเตือน" ของแอดมิน แก้ด้วยมือได้แต่จะถูกทับเมื่อมี\n' +
    '# การบันทึกจากหน้าเว็บครั้งถัดไป — คอมเมนต์ที่เพิ่มเองจะหายไปด้วย\n' +
    '#\n' +
    '# LINE ใช้ Messaging API (LINE Notify ปิดบริการไปแล้วเมื่อ 31 มี.ค. 2568)\n' +
    `# แก้ไขล่าสุด ${new Date().toISOString()}\n\n` +
    Object.entries(values)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n';

  // เขียนไฟล์ชั่วคราวในโฟลเดอร์เดียวกันแล้ว rename ทับ — rename บนไฟล์ระบบเดียวกันเป็น atomic
  // ถ้าเขียนทับตรงๆ แล้วโปรเซสตายกลางคัน cron อาจไปอ่านไฟล์ที่มีแค่ครึ่งเดียวพอดี
  const tmp = path.join(config.alertsDir, `.env.alerts.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  fs.chmodSync(FILE(), 0o600);
}

/** โชว์แค่หางของ token พอให้คนยืนยันได้ว่าใส่ตัวไหนไว้ โดยไม่ให้ค่าที่เอาไปใช้ต่อได้หลุดออกจากเซิร์ฟเวอร์ */
function hint(token: string): string | null {
  if (!token) return null;
  return token.length <= 6 ? '••••' : `••••${token.slice(-4)}`;
}

export interface ChannelStatus {
  configured: boolean;
  target: string | null;
  token_hint: string | null;
  /** เฉพาะ LINE — บอกว่าใส่ channel secret ไว้แล้วหรือยัง ถ้ายัง webhook จะรับของไม่ได้ */
  secret_configured?: boolean;
}

export function readStatus(): Record<ChannelKey, ChannelStatus> {
  const raw = readRaw();
  const out = {} as Record<ChannelKey, ChannelStatus>;
  for (const ch of ['telegram', 'line'] as ChannelKey[]) {
    const k = KEYS[ch];
    const token = raw[k.token] || '';
    const target = raw[k.target] || '';
    out[ch] = { configured: Boolean(token && target), target: target || null, token_hint: hint(token) };
    if (ch === 'line') out[ch].secret_configured = Boolean(raw[KEYS.line.secret]);
  }
  return out;
}

/** คืนค่าจริงสำหรับใช้ส่งข้อความหรือตรวจลายเซ็นเท่านั้น — ห้ามส่งออกไปทาง response เด็ดขาด */
export function readSecrets(ch: ChannelKey): { token: string; target: string; secret: string } {
  const raw = readRaw();
  return {
    token: raw[KEYS[ch].token] || '',
    target: raw[KEYS[ch].target] || '',
    secret: ch === 'line' ? raw[KEYS.line.secret] || '' : '',
  };
}

export interface ChannelPatch {
  token?: string;
  target?: string;
  secret?: string;
}

/**
 * เขียนเฉพาะช่องที่ส่งมา ช่องที่ไม่ส่ง (หรือส่งว่าง) จะคงของเดิมไว้
 *
 * ต้องเป็นการแก้ทีละส่วนแบบนี้เพราะลำดับการตั้งค่า LINE คือ ใส่ token กับ secret ก่อน →
 * เอา webhook ไปผูกใน console → ชวนบอทเข้ากลุ่ม → ค่อยได้ groupId มาใส่ทีหลัง
 * ถ้าบังคับให้ครบทุกช่องพร้อมกัน จะบันทึกอะไรไม่ได้เลยจนกว่าจะจบทุกขั้นตอน
 */
export function saveChannel(ch: ChannelKey, patch: ChannelPatch): void {
  const raw = readRaw();
  const k = KEYS[ch];
  if (patch.token) raw[k.token] = patch.token;
  if (patch.target) raw[k.target] = patch.target;
  if (patch.secret && ch === 'line') raw[KEYS.line.secret] = patch.secret;
  writeRaw(raw);
}

export function clearChannel(ch: ChannelKey): void {
  const raw = readRaw();
  delete raw[KEYS[ch].token];
  delete raw[KEYS[ch].target];
  if (ch === 'line') delete raw[KEYS.line.secret];
  writeRaw(raw);
}
