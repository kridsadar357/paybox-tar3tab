// หัวข้อ "การแจ้งเตือน" ในหน้าตั้งค่าของแอดมิน
//
// แยกไฟล์จาก AdminSettings.tsx เพราะที่นั่นยาว 800 กว่าบรรทัดอยู่แล้ว และหัวข้อนี้ไม่ได้ใช้ state
// ร่วมกับหัวข้ออื่นเลย
//
// token ที่บันทึกแล้วจะไม่ถูกส่งกลับมาให้หน้าเว็บอีก เห็นได้แค่สี่ตัวท้ายพอยืนยันว่าใส่ตัวไหนไว้
// ช่องกรอก token จึงว่างเสมอ และ "ว่าง" แปลว่าใช้ของเดิม ไม่ใช่ลบทิ้ง
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { alertsApi, type AlertsConfig, type ChannelKey } from '../../api/alertsApi';
import { Bell, MessageCircle, Send, BookOpen, Search, Trash2, CheckCircle2, Copy, Check } from 'lucide-react';
import { Modal, Notice, type NoticeState } from './ui';

type Guide = ChannelKey | null;

const WATCHED: [string, string][] = [
  ['เว็บสาธารณะ', 'orca-paybox.com ไม่ตอบภายใน 15 วินาที'],
  ['ฐานข้อมูล', 'paybox-mysql ไม่ตอบ ping'],
  ['เครื่องรับเงิน', 'เปิดสวิตช์ไว้ แต่ไม่มีสัญญาณเกิน 10 นาที'],
];

const STATE_LABELS: Record<string, string> = {
  backend: 'เว็บ',
  mysql: 'ฐานข้อมูล',
};

const stateLabel = (key: string) =>
  STATE_LABELS[key] || (key.startsWith('device_') ? `เครื่อง #${key.slice(7)}` : key);

export const AlertsSection: React.FC = () => {
  const { adminToken } = useAuth();
  const [cfg, setCfg] = useState<AlertsConfig | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [guide, setGuide] = useState<Guide>(null);

  const reload = useCallback(async () => {
    const res = await alertsApi.get(adminToken);
    if (res.success) setCfg(res);
  }, [adminToken]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!cfg) {
    return (
      <p className="text-[14px] pt-2" style={{ color: 'var(--ink-soft)' }}>
        กำลังโหลด…
      </p>
    );
  }

  const anyConfigured = cfg.channels.telegram.configured || cfg.channels.line.configured;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">การแจ้งเตือน</h2>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          ระบบตรวจตัวเองทุก 5 นาที แล้วส่งข้อความออกเมื่อมีอะไรผิดปกติ
          เครื่องรับเงินไม่ควรเงียบหายโดยไม่มีใครรู้จนกว่าจะมีลูกค้ายืนงงอยู่หน้าเครื่อง
        </p>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {!anyConfigured && (
        <p
          className="text-[13px] leading-relaxed px-3.5 py-2.5 rounded"
          style={{ color: 'var(--wait)', background: 'var(--wait-wash)' }}
        >
          ยังไม่ได้ตั้งค่าช่องทางใดเลย ตอนนี้ระบบตรวจอยู่แต่ไม่มีที่ให้ส่งเสียงออก
        </p>
      )}

      <WatcherStrip watcher={cfg.watcher} />

      <div className="sheet overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>ตรวจอะไร</th>
              <th>ถือว่าเสียเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {WATCHED.map(([what, when]) => (
              <tr key={what}>
                <td style={{ fontWeight: 500 }}>{what}</td>
                <td style={{ color: 'var(--ink-soft)' }}>{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p
        className="text-[13px] leading-relaxed px-3.5 py-2.5 rounded"
        style={{ color: 'var(--ink-soft)', background: 'var(--sunk)' }}
      >
        <Bell className="w-[13px] h-[13px] inline-block mr-1.5 -mt-px" style={{ color: 'var(--jade)' }} />
        แจ้งเฉพาะตอนสถานะเปลี่ยน ไม่ใช่ทุกรอบที่ยังเจอปัญหา ถ้ายังเสียอยู่จะย้ำอีกครั้งทุก 12 ชั่วโมง
        — การเตือนที่ดังทุก 5 นาทีจะถูกปิดเสียงภายในวันเดียว แล้วหลังจากนั้นก็ไม่เหลือการเตือนอีกเลย
      </p>

      <ChannelCard
        channel="line"
        icon={MessageCircle}
        name="LINE"
        detail="Messaging API — LINE Notify ปิดบริการไปแล้ว"
        targetLabel="ปลายทาง (user id หรือ group id)"
        targetPlaceholder="กด ดูปลายทางที่ทักบอทมา แล้วเลือก"
        cfg={cfg}
        onDone={reload}
        onNotice={setNotice}
        onGuide={() => setGuide('line')}
      />

      <ChannelCard
        channel="telegram"
        icon={Send}
        name="Telegram"
        detail="Bot API — ใช้กับกลุ่มได้ง่ายกว่า LINE"
        targetLabel="chat id"
        targetPlaceholder="123456789 หรือ -1001234567890"
        cfg={cfg}
        onDone={reload}
        onNotice={setNotice}
        onGuide={() => setGuide('telegram')}
      />

      {guide === 'line' && <LineGuide onClose={() => setGuide(null)} />}
      {guide === 'telegram' && <TelegramGuide onClose={() => setGuide(null)} />}
    </section>
  );
};

/** ตอบคำถามแรกที่คนจะถามกับระบบเฝ้าระวัง: มันยังทำงานอยู่จริงไหม */
function WatcherStrip({ watcher }: { watcher: AlertsConfig['watcher'] }) {
  const lastRun = watcher.last_run;
  // cron รันทุก 5 นาที ถ้าเกิน 15 แปลว่าตัวเฝ้าระวังเองมีปัญหา ซึ่งไม่มีใครแจ้งให้เพราะมันคือคนแจ้ง
  const stale = (() => {
    if (!lastRun) return true;
    const t = Date.parse(lastRun.replace(' ', 'T') + 'Z');
    return Number.isNaN(t) ? false : Date.now() - t > 15 * 60_000;
  })();

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 rounded"
      style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="label">ตรวจล่าสุด</span>
        <span className="figure text-[13px]" style={{ color: stale ? 'var(--down)' : 'var(--ink)' }}>
          {lastRun ? `${lastRun} UTC` : 'ยังไม่เคยรัน'}
        </span>
      </div>

      {watcher.states.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {watcher.states.map((s) => (
            <span key={s.key} className={`chip ${s.status === 'up' ? 'chip-up' : 'chip-down'}`}>
              {stateLabel(s.key)}
            </span>
          ))}
        </div>
      )}

      {stale && (
        <span className="text-[12.5px]" style={{ color: 'var(--down)' }}>
          ตัวเฝ้าระวังไม่ได้รันตามกำหนด — ตรวจ cron บนเซิร์ฟเวอร์
        </span>
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  icon: Icon,
  name,
  detail,
  targetLabel,
  targetPlaceholder,
  cfg,
  onDone,
  onNotice,
  onGuide,
}: {
  channel: ChannelKey;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  name: string;
  detail: string;
  targetLabel: string;
  targetPlaceholder: string;
  cfg: AlertsConfig;
  onDone: () => void;
  onNotice: (n: NoticeState) => void;
  onGuide: () => void;
}) {
  const { adminToken } = useAuth();
  const status = cfg.channels[channel];
  const isLine = channel === 'line';

  const [tokenValue, setTokenValue] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [target, setTarget] = useState(status.target || '');
  const [busy, setBusy] = useState('');
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [copied, setCopied] = useState(false);

  // ถ้าคนอื่นแก้ค่าแล้วหน้านี้โหลดใหม่ ให้ช่องปลายทางตามค่าที่บันทึกจริง แต่ไม่แตะสิ่งที่กำลังพิมพ์ค้างอยู่
  useEffect(() => {
    setTarget((cur) => (cur === '' ? status.target || '' : cur));
  }, [status.target]);

  const run = async (label: string, fn: () => Promise<{ success: boolean; message?: string }>, okText: string) => {
    setBusy(label);
    onNotice(null);
    try {
      const res = await fn();
      onNotice({ ok: res.success, text: res.success ? res.message || okText : res.message || 'ทำรายการไม่สำเร็จ' });
      if (res.success) {
        setTokenValue('');
        setSecretValue('');
        onDone();
      }
    } catch {
      onNotice({ ok: false, text: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy('');
    }
  };

  // Telegram ถามย้อนหลังได้จาก getUpdates ส่วน LINE ต้องรอ webhook จดไว้ให้ก่อน จึงมีที่มาต่างกัน
  // แต่ผลลัพธ์ที่แอดมินเห็นเหมือนกันคือรายการให้กดเลือก
  const discover = async () => {
    setBusy('find');
    onNotice(null);
    try {
      if (isLine) {
        const res = await alertsApi.lineSources(adminToken);
        setOptions(res.sources.map((s) => ({ id: s.id, name: `${s.name} · ${s.type}` })));
        if (!res.secret_configured) {
          onNotice({ ok: false, text: 'ยังไม่ได้ใส่ channel secret — webhook จะปฏิเสธทุกคำขอจนกว่าจะใส่' });
        } else if (res.sources.length === 0) {
          onNotice({
            ok: false,
            text: 'ยังไม่มีใครทักบอทเข้ามา — ผูก Webhook URL ใน LINE console แล้วชวนบอทเข้ากลุ่มและพิมพ์สักข้อความก่อน',
          });
        }
      } else {
        const res = await alertsApi.discoverChats(adminToken, tokenValue);
        setOptions((res.chats || []).map((c) => ({ id: c.id, name: c.name })));
        if (!res.success) onNotice({ ok: false, text: res.message || 'ค้นหาไม่สำเร็จ' });
      }
    } catch {
      onNotice({ ok: false, text: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="sheet flex flex-col gap-4 px-5 py-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="w-[18px] h-[18px] shrink-0" style={{ color: 'var(--jade)' }} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14.5px] font-semibold">{name}</span>
              <span className={`chip ${status.configured ? 'chip-up' : 'chip-mute'}`}>
                {status.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}
              </span>
              {isLine && status.secret_configured === false && (
                <span className="chip chip-wait">ยังไม่มี channel secret</span>
              )}
            </div>
            <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
              {detail}
            </span>
          </div>
        </div>

        <button onClick={onGuide} className="btn btn-ghost shrink-0">
          <BookOpen className="w-4 h-4" />
          อ่านวิธีตั้งค่า
        </button>
      </div>

      {/* LINE ไม่บอก groupId ที่ไหนเลย ทางเดียวคือให้มันยิง webhook มาแล้วเราจดไว้ */}
      {isLine && (
        <div className="flex flex-col gap-1.5">
          <span className="label">Webhook URL — วางในแท็บ Messaging API ของ channel</span>
          <div className="flex items-center gap-2">
            <code
              className="figure text-[12.5px] px-3 py-2 rounded flex-1 min-w-0 overflow-x-auto whitespace-nowrap"
              style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
            >
              {cfg.line_webhook_url}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(cfg.line_webhook_url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="btn btn-ghost shrink-0"
              aria-label="คัดลอก Webhook URL"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">
            {isLine ? 'Channel access token' : 'Bot token'}
            {status.token_hint && <span style={{ color: 'var(--ink-faint)' }}> · เก็บไว้แล้ว {status.token_hint}</span>}
          </span>
          <input
            type="password"
            className="field"
            autoComplete="off"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder={status.token_hint ? 'เว้นว่างไว้ = ใช้ตัวเดิม' : 'วาง token ที่คัดลอกมา'}
          />
        </label>

        {isLine && (
          <label className="flex flex-col gap-1.5">
            <span className="label">
              Channel secret
              {status.secret_configured && <span style={{ color: 'var(--ink-faint)' }}> · เก็บไว้แล้ว</span>}
            </span>
            <input
              type="password"
              className="field"
              autoComplete="off"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={status.secret_configured ? 'เว้นว่างไว้ = ใช้ตัวเดิม' : 'เลขฐานสิบหก 32 ตัว'}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="label">{targetLabel}</span>
          <input
            type="text"
            className="field"
            autoComplete="off"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={targetPlaceholder}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={discover}
          disabled={busy !== '' || (!isLine && !tokenValue && !status.token_hint)}
          className="btn btn-ghost self-start"
        >
          <Search className="w-4 h-4" />
          {busy === 'find' ? 'กำลังค้นหา…' : isLine ? 'ดูปลายทางที่ทักบอทมา' : 'ค้นหา chat id ให้'}
        </button>

        {options && options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => setTarget(o.id)}
                className="chip chip-mute"
                style={{ cursor: 'pointer' }}
                title={`ใช้ ${o.id}`}
              >
                {o.name} · {o.id.length > 12 ? `${o.id.slice(0, 10)}…` : o.id}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() =>
            run(
              'save',
              () =>
                alertsApi.save(adminToken, channel, {
                  token: tokenValue,
                  secret: secretValue,
                  target: target.trim(),
                }),
              'บันทึกแล้ว'
            )
          }
          disabled={busy !== '' || (!tokenValue && !secretValue && !target.trim())}
          className="btn btn-primary"
        >
          {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>

        <button
          onClick={() => run('test', () => alertsApi.test(adminToken, channel), 'ส่งแล้ว')}
          disabled={busy !== '' || !status.configured}
          className="btn btn-ghost"
          title={status.configured ? undefined : 'ต้องบันทึก token และปลายทางก่อนถึงจะทดสอบได้'}
        >
          <CheckCircle2 className="w-4 h-4" />
          {busy === 'test' ? 'กำลังส่ง…' : 'ทดสอบส่ง'}
        </button>

        {(status.configured || status.secret_configured) && (
          <button
            onClick={() => {
              setTarget('');
              setOptions(null);
              run('clear', () => alertsApi.clear(adminToken, channel), 'ลบแล้ว');
            }}
            disabled={busy !== ''}
            className="btn btn-danger ml-auto"
          >
            <Trash2 className="w-4 h-4" />
            ลบการตั้งค่า
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- ชิ้นส่วนของกล่องวิธีตั้งค่า ---------------- */

// ใส่เลขให้อัตโนมัติจากลำดับจริง เพราะเนื้อหาในกล่องอ้างถึง "ข้อ 3" "ข้อ 4" ตรงๆ
// ถ้าปล่อยให้พิมพ์เลขเองแล้ววันหลังมีคนแทรกขั้นตอน เลขที่อ้างจะเพี้ยนโดยไม่มีอะไรเตือน
function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="flex flex-col gap-4 list-none m-0 p-0">
      {React.Children.toArray(children).map((child, i) =>
        React.isValidElement<{ n?: number }>(child) ? React.cloneElement(child, { n: i + 1 }) : child
      )}
    </ol>
  );
}

function Step({ n, title, children }: { n?: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="figure shrink-0 flex items-center justify-center w-[22px] h-[22px] rounded-full text-[12px] mt-px"
        style={{ background: 'var(--jade-wash)', color: 'var(--jade)', fontWeight: 600 }}
      >
        {n}
      </span>
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <span className="text-[13.5px] leading-relaxed">{title}</span>
        {children}
      </div>
    </li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
      {children}
    </p>
  );
}

function Finish({ what }: { what: string }) {
  return (
    <p
      className="text-[13px] leading-relaxed px-3.5 py-2.5 rounded"
      style={{ color: 'var(--jade)', background: 'var(--jade-wash)' }}
    >
      ปิดกล่องนี้แล้วเอา {what} มากรอกในช่องด้านล่าง กด <b>บันทึก</b> แล้วกด <b>ทดสอบส่ง</b>
      เพื่อพิสูจน์ว่าข้อความถึงจริง ค่าที่บันทึกมีผลทันทีในรอบตรวจถัดไป ไม่ต้องรีสตาร์ตอะไร
    </p>
  );
}

function LineGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="ตั้งค่าแจ้งเตือนผ่าน LINE" subtitle="LINE Messaging API" onClose={onClose} width="34rem">
      <div className="flex flex-col gap-5">
        <p
          className="text-[13px] leading-relaxed px-3.5 py-2.5 rounded"
          style={{ color: 'var(--wait)', background: 'var(--wait-wash)' }}
        >
          LINE Notify ปิดบริการไปแล้วเมื่อ 31 มีนาคม 2568 ระบบนี้จึงใช้ Messaging API ซึ่งเป็นตัวที่ LINE
          ยังรองรับอยู่ ถ้าเจอบทความเก่าที่บอกให้ไปขอ token จากหน้า notify-bot.line.me ให้ข้ามไป
          หน้านั้นใช้ไม่ได้แล้ว
        </p>

        <Steps>
          <Step title="เข้า developers.line.biz ล็อกอินด้วยบัญชี LINE ปกติ แล้วสร้าง Provider ขึ้นมาหนึ่งอัน (ชื่ออะไรก็ได้ เช่น PayBox)" />
          <Step title="ในโปรไวเดอร์นั้น สร้าง Channel ใหม่ เลือกชนิด Messaging API" />
          <Step title="แท็บ Messaging API เลื่อนลงล่างสุด กดออก Channel access token (long-lived) แล้วเอามาวางในช่อง Channel access token ด้านล่าง">
            <Note>token ที่ได้จะยาวประมาณ 170 ตัวอักษร ลงท้ายด้วย = ถ้าเผลอทำหลุดให้กด Reissue ตัวเก่าจะใช้ไม่ได้ทันที</Note>
          </Step>
          <Step title="แท็บ Basic settings หา Channel secret (เลขฐานสิบหก 32 ตัว) เอามาวางในช่อง Channel secret ด้านล่าง แล้วกดบันทึก">
            <Note>
              คนละตัวกับ access token — ตัวนี้ใช้ตรวจว่าคำขอที่วิ่งเข้า Webhook มาจาก LINE จริง
              ถ้าไม่ใส่ ระบบจะปฏิเสธทุกคำขอที่เข้ามาเพราะพิสูจน์ต้นทางไม่ได้
            </Note>
          </Step>
          <Step title="คัดลอก Webhook URL ที่แสดงอยู่ด้านล่าง เอาไปวางในช่อง Webhook URL ของแท็บ Messaging API แล้วเปิดสวิตช์ Use webhook">
            <Note>
              กดปุ่ม Verify ข้างช่องนั้นได้เลย ถ้าขึ้น Success แปลว่า LINE คุยกับระบบเราได้แล้ว
              (ต้องบันทึก Channel secret ในข้อ 4 ก่อน ไม่งั้น Verify จะไม่ผ่าน)
            </Note>
          </Step>
          <Step title="ปิด Auto-reply messages และ Greeting messages ในแท็บเดียวกัน">
            <Note>ไม่ปิดแล้วบอทจะตอบข้อความอัตโนมัติกลับมาทุกครั้ง ทำให้ห้องที่ตั้งใจใช้รับการเตือนรกจนอ่านไม่ทัน</Note>
          </Step>
          <Step title="ชวนบอทเข้ากลุ่มที่จะรับการเตือน (หรือสแกน QR แอดเป็นเพื่อนถ้าจะส่งหาตัวเอง) แล้วพิมพ์อะไรสักอย่างหนึ่งข้อความ">
            <Note>
              ข้อความนั้นทำให้ LINE ยิง webhook มาบอกเราว่าห้องนี้คือห้องไหน — ต่างจาก Telegram ตรงที่
              LINE ถามย้อนหลังไม่ได้ ถ้าไม่ได้ผูก webhook ไว้ก่อน ข้อความที่พิมพ์ไปจะไม่มีใครจดไว้เลย
            </Note>
          </Step>
          <Step title="กลับมากดปุ่ม ดูปลายทางที่ทักบอทมา ด้านล่าง แล้วเลือกห้องที่ต้องการ ระบบจะเติม id ให้เอง" />
        </Steps>

        <Finish what="ค่าที่ได้จากแต่ละข้อ" />
      </div>
    </Modal>
  );
}

function TelegramGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="ตั้งค่าแจ้งเตือนผ่าน Telegram" subtitle="Bot API" onClose={onClose} width="34rem">
      <div className="flex flex-col gap-5">
        <Steps>
          <Step title="เปิด Telegram ทักหา @BotFather พิมพ์ /newbot แล้วตอบชื่อบอทกับ username ตามที่มันถาม">
            <Note>username ต้องลงท้ายด้วย bot และห้ามซ้ำกับใคร เช่น orca_paybox_alert_bot</Note>
          </Step>
          <Step title="BotFather จะตอบ token กลับมา หน้าตาแบบ 123456789:AAE… คัดลอกมาวางในช่อง Bot token ด้านล่าง" />
          <Step title="ทักบอทตัวที่เพิ่งสร้างสักหนึ่งข้อความ">
            <Note>
              ข้อนี้ข้ามไม่ได้ — Telegram ไม่ยอมให้บอทเริ่มทักคนที่ไม่เคยทักมันมาก่อน ถ้าจะใช้กลุ่ม ให้เชิญบอท
              เข้ากลุ่มแล้วพิมพ์อะไรสักอย่างในกลุ่มแทน
            </Note>
          </Step>
          <Step title="กดปุ่ม ค้นหา chat id ให้ ด้านล่าง แล้วเลือกห้องที่ต้องการ ระบบจะเติมเลขให้เอง">
            <Note>
              ของกลุ่มตัวเลขจะติดลบและยาวกว่า เช่น -1001234567890 ซึ่งถูกต้องแล้ว
              ถ้าค้นแล้วไม่เจอ แปลว่าข้อความยังไม่ถึงบอท ให้ทักใหม่แล้วลองอีกครั้ง
            </Note>
          </Step>
        </Steps>

        <Finish what="token จากข้อ 2 กับ chat id จากข้อ 4" />
      </div>
    </Modal>
  );
}
