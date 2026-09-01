// หน้า "ตั้งค่า" ของฝั่งผู้ดูแลระบบ — โครงเดียวกับฝั่งลูกค้า (เมนูซ้าย เนื้อหาขวา) แต่เพิ่มสอง
// หัวข้อที่มีเฉพาะฝั่งนี้: จัดการบัญชีผู้ดูแลระบบคนอื่น และบันทึกการใช้งาน
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  adminAccountApi,
  AUDIT_ACTION_LABELS,
  AUDIT_SENSITIVE,
  type AdminAccountData,
  type AdminSession,
  type AdminRow,
  type AuditEntry,
} from '../../api/adminAccountApi';
import { formatDateTime, relativeTime } from '../../lib/format';
import { AlertsSection } from './AlertsSection';
import {
  ShieldCheck,
  Check,
  AlertTriangle,
  User,
  KeyRound,
  MonitorSmartphone,
  Users,
  ScrollText,
  Bell,
  Power,
  Copy,
} from 'lucide-react';

type Notice = { ok: boolean; text: string } | null;
type PaneKey = 'profile' | 'password' | '2fa' | 'sessions' | 'admins' | 'audit' | 'alerts';

const PANES: { key: PaneKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'profile', label: 'ข้อมูลผู้ใช้งาน', icon: User },
  { key: 'password', label: 'รหัสผ่าน', icon: KeyRound },
  { key: '2fa', label: 'ยืนยันตัวตนสองชั้น', icon: ShieldCheck },
  { key: 'sessions', label: 'อุปกรณ์ที่ใช้งาน', icon: MonitorSmartphone },
  { key: 'admins', label: 'ผู้ดูแลระบบ', icon: Users },
  { key: 'audit', label: 'บันทึกการใช้งาน', icon: ScrollText },
  { key: 'alerts', label: 'การแจ้งเตือน', icon: Bell },
];

export const AdminSettings: React.FC = () => {
  const { adminToken, logout } = useAuth();
  const [data, setData] = useState<AdminAccountData | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [pane, setPane] = useState<PaneKey>('profile');

  const reload = useCallback(async () => {
    const [acct, sess] = await Promise.all([adminAccountApi.get(adminToken), adminAccountApi.sessions(adminToken)]);
    if (acct.success) setData(acct);
    if (sess.success) setSessions(sess.sessions || []);
  }, [adminToken]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!data) {
    return (
      <p className="text-[14px] pt-2" style={{ color: 'var(--ink-soft)' }}>
        กำลังโหลด…
      </p>
    );
  }

  return (
    <div className="grid gap-8 pt-2 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-10">
      <nav
        className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:sticky md:top-[112px] md:self-start"
        style={{ scrollbarWidth: 'none' }}
        aria-label="หมวดการตั้งค่า"
      >
        {PANES.map(({ key, label, icon: Icon }) => {
          const on = pane === key;
          return (
            <button
              key={key}
              onClick={() => setPane(key)}
              aria-current={on ? 'page' : undefined}
              className="flex items-center gap-2.5 shrink-0 rounded px-3 py-2.5 text-[14px] text-left transition-colors"
              style={{
                background: on ? 'var(--jade-wash)' : 'transparent',
                color: on ? 'var(--jade)' : 'var(--ink-soft)',
                fontWeight: on ? 600 : 500,
              }}
            >
              <Icon className="w-[16px] h-[16px] shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 max-w-[46rem]">
        {pane === 'profile' && <ProfileSection data={data} token={adminToken} onSaved={reload} />}
        {pane === 'password' && <PasswordSection token={adminToken} onSaved={reload} />}
        {pane === '2fa' && <TwoFactorSection data={data} token={adminToken} onChanged={reload} />}
        {pane === 'sessions' && (
          <SessionsSection sessions={sessions} token={adminToken} onChanged={reload} onLogout={logout} />
        )}
        {pane === 'admins' && <AdminsSection token={adminToken} me={data} />}
        {pane === 'audit' && <AuditSection token={adminToken} />}
        {pane === 'alerts' && <AlertsSection />}
      </div>
    </div>
  );
};

/* ---------------- ชิ้นส่วนที่ใช้ร่วมกัน ---------------- */

function Block({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">{title}</h2>
        {desc && (
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            {desc}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      className="text-[13.5px] px-3.5 py-2.5 rounded"
      style={{
        color: notice.ok ? 'var(--up)' : 'var(--down)',
        background: notice.ok ? 'var(--up-wash)' : 'var(--down-wash)',
      }}
      role="status"
    >
      {notice.text}
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
      {hint && (
        <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

/* ---------------- โปรไฟล์ ---------------- */

function ProfileSection({ data, token, onSaved }: { data: AdminAccountData; token: string; onSaved: () => void }) {
  const [name, setName] = useState(data.profile.name);
  const [email, setEmail] = useState(data.profile.email || '');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await adminAccountApi.updateProfile(token, name, email);
    setNotice(res.success ? { ok: true, text: 'บันทึกแล้ว' } : { ok: false, text: res.message || 'บันทึกไม่สำเร็จ' });
    setBusy(false);
    if (res.success) onSaved();
  };

  return (
    <Block title="ข้อมูลผู้ใช้งาน" desc="ชื่อที่แสดงในบันทึกการใช้งาน และอีเมลสำหรับติดต่อ">
      <form onSubmit={save} className="flex flex-col gap-5">
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="ชื่อผู้ใช้ (เปลี่ยนไม่ได้)">
            <input className="field figure" value={data.profile.username} disabled />
          </Field>
          <Field label="สิทธิ์">
            <div className="flex items-center h-[42px]">
              <span className={data.profile.is_owner === 1 ? 'chip chip-up' : 'chip chip-mute'}>
                {data.profile.is_owner === 1 ? 'เจ้าของระบบ' : 'ผู้ดูแลระบบ'}
              </span>
            </div>
          </Field>
        </div>

        <Field label="ชื่อที่แสดง">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="อีเมล">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-5 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
          <Field label="เข้าสู่ระบบล่าสุด">
            <span className="text-[14px]">{data.profile.last_login_at ? relativeTime(data.profile.last_login_at) : '—'}</span>
          </Field>
          <Field label="สร้างบัญชีเมื่อ">
            <span className="text-[14px]">{formatDateTime(data.profile.created_at)}</span>
          </Field>
        </div>

        <NoticeLine notice={notice} />

        <button type="submit" disabled={busy} className="btn btn-primary self-start">
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </Block>
  );
}

/* ---------------- รหัสผ่าน ---------------- */

function PasswordSection({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setNotice({ ok: false, text: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' });
      return;
    }
    setBusy(true);
    const res: any = await adminAccountApi.changePassword(token, current, next);
    if (res.success) {
      setNotice({ ok: true, text: 'เปลี่ยนรหัสผ่านแล้ว · อุปกรณ์อื่นถูกออกจากระบบทั้งหมด' });
      setCurrent('');
      setNext('');
      setConfirm('');
      onSaved();
    } else {
      setNotice({ ok: false, text: res.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
    }
    setBusy(false);
  };

  return (
    <Block
      title="รหัสผ่าน"
      desc="บัญชีนี้เห็นและแก้ไขข้อมูลของลูกค้าทุกราย รหัสผ่านจึงต้องยาวอย่างน้อย 10 ตัวอักษร เมื่อเปลี่ยนแล้วอุปกรณ์อื่นที่ค้างอยู่จะถูกออกจากระบบทั้งหมด"
    >
      <form onSubmit={save} className="flex flex-col gap-5">
        <Field label="รหัสผ่านปัจจุบัน">
          <input
            className="field"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัวอักษร">
          <input
            className="field"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่">
          <input
            className="field"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <NoticeLine notice={notice} />

        <button type="submit" disabled={busy} className="btn btn-primary self-start">
          {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
        </button>
      </form>
    </Block>
  );
}

/* ---------------- 2FA ---------------- */

function TwoFactorSection({
  data,
  token,
  onChanged,
}: {
  data: AdminAccountData;
  token: string;
  onChanged: () => void;
}) {
  const enabled = data.security.totp_enabled;
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    const res = await adminAccountApi.start2fa(token);
    if (res.success && res.secret && res.qr) {
      setSetup({ secret: res.secret, qr: res.qr });
      setNotice(null);
    } else {
      setNotice({ ok: false, text: res.message || 'เริ่มตั้งค่าไม่สำเร็จ' });
    }
    setBusy(false);
  };

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await adminAccountApi.enable2fa(token, code);
    if (res.success) {
      setSetup(null);
      setCode('');
      setNotice({ ok: true, text: 'เปิดใช้งาน 2FA แล้ว' });
      onChanged();
    } else {
      setNotice({ ok: false, text: res.message || 'รหัสไม่ถูกต้อง' });
    }
    setBusy(false);
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await adminAccountApi.disable2fa(token, password, code);
    if (res.success) {
      setPassword('');
      setCode('');
      setNotice({ ok: true, text: 'ปิด 2FA แล้ว' });
      onChanged();
    } else {
      setNotice({ ok: false, text: res.message || 'ปิดไม่สำเร็จ' });
    }
    setBusy(false);
  };

  return (
    <Block
      title="ยืนยันตัวตนสองชั้น (2FA)"
      desc="เพิ่มรหัส 6 หลักจากแอป Authenticator ตอนเข้าสู่ระบบ ทำให้รหัสผ่านที่หลุดออกไปอย่างเดียวยังใช้เข้าระบบไม่ได้"
    >
      <div className="flex items-center gap-3">
        <span className={enabled ? 'chip chip-up' : 'chip chip-wait'}>{enabled ? 'เปิดใช้งานอยู่' : 'ยังไม่ได้เปิด'}</span>
      </div>

      {!enabled && !setup && (
        <>
          <div
            className="flex items-start gap-2.5 px-3.5 py-3 rounded"
            style={{ background: 'var(--wait-wash)', color: 'var(--wait)' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span className="text-[13px] leading-relaxed">
              บัญชีผู้ดูแลระบบเข้าถึงข้อมูลการเงินของลูกค้าทุกราย แนะนำอย่างยิ่งให้เปิดใช้งาน
            </span>
          </div>
          <button onClick={start} disabled={busy} className="btn btn-primary self-start">
            เริ่มตั้งค่า 2FA
          </button>
        </>
      )}

      {setup && (
        <form onSubmit={enable} className="flex flex-col gap-4">
          <div className="sheet p-5 flex flex-col sm:flex-row gap-5 items-start">
            <img src={setup.qr} alt="QR สำหรับตั้งค่า 2FA" width={168} height={168} style={{ borderRadius: 4 }} />
            <div className="flex flex-col gap-2.5 min-w-0">
              <span className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                สแกน QR ด้วยแอป Authenticator หรือกรอกรหัสลับนี้ด้วยตัวเอง
              </span>
              <div className="flex items-center gap-2">
                <code
                  className="figure text-[13px] px-3 py-2 rounded break-all"
                  style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
                >
                  {setup.secret}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(setup.secret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="btn btn-ghost shrink-0"
                  style={{ padding: '8px 10px' }}
                  title="คัดลอก"
                >
                  {copied ? <Check className="w-4 h-4" style={{ color: 'var(--up)' }} /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <Field label="รหัส 6 หลักจากแอป">
            <input
              className="field figure"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              style={{ letterSpacing: '.28em', maxWidth: '12rem' }}
            />
          </Field>

          <NoticeLine notice={notice} />

          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              ยืนยันและเปิดใช้งาน
            </button>
            <button type="button" onClick={() => setSetup(null)} className="btn btn-ghost">
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {enabled && (
        <form onSubmit={disable} className="flex flex-col gap-5">
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            การปิดต้องยืนยันทั้งรหัสผ่านและรหัส 6 หลัก กันคนที่ยืมเครื่องที่ล็อกอินค้างไว้ปิดเอง
          </p>
          <Field label="รหัสผ่าน">
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="รหัส 6 หลัก">
            <input
              className="field figure"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              style={{ letterSpacing: '.28em', maxWidth: '12rem' }}
            />
          </Field>

          <NoticeLine notice={notice} />

          <button type="submit" disabled={busy} className="btn btn-danger self-start">
            ปิด 2FA
          </button>
        </form>
      )}

      {!setup && !enabled && <NoticeLine notice={notice} />}
    </Block>
  );
}

/* ---------------- เซสชัน ---------------- */

function SessionsSection({
  sessions,
  token,
  onChanged,
  onLogout,
}: {
  sessions: AdminSession[];
  token: string;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    const res: any = await adminAccountApi.revokeOtherSessions(token);
    setNotice(
      res.success
        ? { ok: true, text: `ออกจากระบบแล้ว ${res.revoked ?? 0} เครื่อง` }
        : { ok: false, text: 'ทำรายการไม่สำเร็จ' }
    );
    setBusy(false);
    onChanged();
  };

  return (
    <Block title="อุปกรณ์ที่ใช้งาน" desc="เซสชันที่ยังเข้าสู่ระบบค้างอยู่ของบัญชีนี้ (เก็บ 20 รายการล่าสุด)">
      <div className="sheet overflow-hidden">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[14px] font-medium">{formatDateTime(s.created_at)}</span>
                {Number(s.is_current) === 1 && <span className="chip chip-up">เครื่องนี้</span>}
              </div>
              <span className="text-[12.5px] truncate" style={{ color: 'var(--ink-faint)' }}>
                {s.ip || 'ไม่ทราบ IP'}
                {s.user_agent ? ` · ${s.user_agent.slice(0, 70)}` : ''}
              </span>
            </div>
            <span className="figure text-[12.5px] shrink-0" style={{ color: 'var(--ink-faint)' }}>
              หมดอายุ {formatDateTime(s.expires_at)}
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="px-5 py-12 text-center text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            ไม่มีเซสชัน
          </div>
        )}
      </div>

      <NoticeLine notice={notice} />

      <div className="flex flex-wrap gap-3">
        <button onClick={revoke} disabled={busy} className="btn btn-ghost">
          ออกจากระบบทุกอุปกรณ์อื่น
        </button>
        <button onClick={onLogout} className="btn btn-ghost">
          ออกจากระบบเครื่องนี้
        </button>
      </div>
    </Block>
  );
}

/* ---------------- จัดการผู้ดูแลระบบ ---------------- */

function AdminsSection({ token, me }: { token: string; me: AdminAccountData }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    const res = await adminAccountApi.admins(token);
    if (res.success) setAdmins(res.admins || []);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await adminAccountApi.createAdmin(token, username, name, email, password);
    if (res.success) {
      setNotice({ ok: true, text: `สร้างบัญชี "${username}" แล้ว` });
      setUsername('');
      setName('');
      setEmail('');
      setPassword('');
      setShowAdd(false);
      load();
    } else {
      setNotice({ ok: false, text: res.message || 'สร้างบัญชีไม่สำเร็จ' });
    }
    setBusy(false);
  };

  const toggle = async (row: AdminRow) => {
    const res: any = await adminAccountApi.toggleAdmin(token, row.id);
    setNotice(res.success ? null : { ok: false, text: res.message || 'ทำรายการไม่สำเร็จ' });
    load();
  };

  const resetPassword = async (row: AdminRow) => {
    const pw = window.prompt(`ตั้งรหัสผ่านใหม่ให้ "${row.username}" (อย่างน้อย 10 ตัวอักษร)`);
    if (!pw) return;
    const res: any = await adminAccountApi.resetAdminPassword(token, row.id, pw);
    setNotice(
      res.success
        ? { ok: true, text: `ตั้งรหัสผ่านใหม่ให้ "${row.username}" แล้ว · เซสชันเดิมถูกตัดทั้งหมด` }
        : { ok: false, text: res.message || 'ทำรายการไม่สำเร็จ' }
    );
    load();
  };

  const disable2fa = async (row: AdminRow) => {
    const res: any = await adminAccountApi.disableAdmin2fa(token, row.id);
    setNotice(
      res.success
        ? { ok: true, text: `ปลด 2FA ของ "${row.username}" แล้ว` }
        : { ok: false, text: res.message || 'ทำรายการไม่สำเร็จ' }
    );
    load();
  };

  return (
    <Block
      title="ผู้ดูแลระบบ"
      desc="แต่ละคนควรมีบัญชีของตัวเอง บันทึกการใช้งานจะได้ระบุตัวคนทำได้จริง — บัญชีเจ้าของระบบระงับไม่ได้เพื่อกันเหตุการณ์ล็อกทุกคนออกจากระบบ"
    >
      <div className="sheet overflow-hidden">
        {admins.map((a, i) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="figure text-[14px] font-semibold">{a.username}</span>
                {a.is_owner === 1 && <span className="chip chip-up">เจ้าของระบบ</span>}
                {a.id === me.profile.id && <span className="chip chip-mute">คุณ</span>}
                {a.is_active !== 1 && <span className="chip chip-down">ระงับอยู่</span>}
                {a.totp_enabled === 1 && (
                  <span className="chip chip-mute">
                    <ShieldCheck className="w-3 h-3" /> 2FA
                  </span>
                )}
              </div>
              <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                {a.name}
                {a.email ? ` · ${a.email}` : ''} · เข้าล่าสุด{' '}
                {a.last_login_at ? relativeTime(a.last_login_at) : 'ยังไม่เคย'}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => resetPassword(a)} className="text-[13px] font-medium" style={{ color: 'var(--jade)' }}>
                ตั้งรหัสผ่าน
              </button>
              {a.totp_enabled === 1 && (
                <button onClick={() => disable2fa(a)} className="text-[13px] font-medium" style={{ color: 'var(--wait)' }}>
                  ปลด 2FA
                </button>
              )}
              {a.is_owner !== 1 && a.id !== me.profile.id && (
                <button
                  onClick={() => toggle(a)}
                  className="inline-flex items-center gap-1 text-[13px] font-medium"
                  style={{ color: a.is_active === 1 ? 'var(--down)' : 'var(--up)' }}
                >
                  <Power className="w-3.5 h-3.5" />
                  {a.is_active === 1 ? 'ระงับ' : 'เปิดใช้'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <NoticeLine notice={notice} />

      {showAdd ? (
        <form onSubmit={create} className="sheet p-5 flex flex-col gap-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="ชื่อผู้ใช้" hint="a-z 0-9 . _ - ยาว 3–64 ตัว">
              <input
                className="field figure"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label="ชื่อที่แสดง">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="อีเมล (ไม่บังคับ)">
              <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="รหัสผ่าน" hint="อย่างน้อย 10 ตัวอักษร">
              <input
                className="field"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              สร้างบัญชี
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="btn btn-ghost">
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="btn btn-ghost self-start">
          เพิ่มบัญชีผู้ดูแลระบบ
        </button>
      )}
    </Block>
  );
}

/* ---------------- บันทึกการใช้งาน ---------------- */

function AuditSection({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (action: string) => {
      setLoading(true);
      const res = await adminAccountApi.audit(token, { action: action || undefined });
      if (res.success) {
        setEntries(res.entries || []);
        setActions(res.actions || []);
        setHasMore(res.has_more);
      }
      setLoading(false);
    },
    [token]
  );

  useEffect(() => {
    load(filter);
  }, [load, filter]);

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const res = await adminAccountApi.audit(token, { beforeId: last.id, action: filter || undefined });
    if (res.success) {
      setEntries((prev) => [...prev, ...(res.entries || [])]);
      setHasMore(res.has_more);
    }
  };

  return (
    <Block
      title="บันทึกการใช้งาน"
      desc="ทุกการกระทำที่แตะเงินหรือสิทธิ์การเข้าถึงถูกบันทึกไว้พร้อมคนทำ เวลา และ IP — เริ่มเก็บตั้งแต่รอบอัปเดตนี้เป็นต้นไป"
    >
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('')}
          className="chip"
          style={{
            background: filter === '' ? 'var(--jade-wash)' : 'var(--sunk)',
            color: filter === '' ? 'var(--jade)' : 'var(--ink-faint)',
            borderColor: 'var(--line)',
          }}
        >
          ทั้งหมด
        </button>
        {actions.map((a) => (
          <button
            key={a}
            onClick={() => setFilter(a)}
            className="chip"
            style={{
              background: filter === a ? 'var(--jade-wash)' : 'var(--sunk)',
              color: filter === a ? 'var(--jade)' : 'var(--ink-faint)',
              borderColor: 'var(--line)',
            }}
          >
            {AUDIT_ACTION_LABELS[a] || a}
          </button>
        ))}
      </div>

      <div className="sheet overflow-hidden">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="flex flex-col gap-1.5 px-5 py-4"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-[14px] leading-snug">{e.summary || AUDIT_ACTION_LABELS[e.action] || e.action}</span>
              <span className="figure text-[12.5px] shrink-0" style={{ color: 'var(--ink-faint)' }}>
                {formatDateTime(e.created_at)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
              <span
                className="chip"
                style={{
                  background: AUDIT_SENSITIVE.has(e.action) ? 'var(--wait-wash)' : 'var(--sunk)',
                  color: AUDIT_SENSITIVE.has(e.action) ? 'var(--wait)' : 'var(--ink-faint)',
                  borderColor: 'var(--line)',
                }}
              >
                {AUDIT_ACTION_LABELS[e.action] || e.action}
              </span>
              <span className="figure">{e.admin_username || 'ไม่ทราบผู้ใช้'}</span>
              {e.ip && <span className="figure">· {e.ip}</span>}
            </div>
          </div>
        ))}

        {entries.length === 0 && !loading && (
          <div className="px-5 py-12 text-center text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            ยังไม่มีบันทึก
          </div>
        )}
        {loading && (
          <div className="px-5 py-12 text-center text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            กำลังโหลด…
          </div>
        )}
      </div>

      {hasMore && (
        <button onClick={loadMore} className="btn btn-ghost self-center">
          โหลดเพิ่ม
        </button>
      )}
    </Block>
  );
}
