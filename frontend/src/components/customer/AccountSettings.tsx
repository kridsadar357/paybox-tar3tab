import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { accountApi, THAI_BANKS, type AccountData, type AccountSession } from '../../api/accountApi';
import {
  ShieldCheck,
  ShieldOff,
  Check,
  LogOut,
  AlertTriangle,
  User,
  KeyRound,
  Landmark,
  MonitorSmartphone,
} from 'lucide-react';

type Notice = { ok: boolean; text: string } | null;

type PaneKey = 'profile' | 'password' | '2fa' | 'payout' | 'sessions';

const PANES: { key: PaneKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'profile', label: 'ข้อมูลผู้ใช้งาน', icon: User },
  { key: 'password', label: 'รหัสผ่าน', icon: KeyRound },
  { key: '2fa', label: 'ยืนยันตัวตนสองชั้น', icon: ShieldCheck },
  { key: 'payout', label: 'บัญชีรับเงิน', icon: Landmark },
  { key: 'sessions', label: 'อุปกรณ์ที่ใช้งาน', icon: MonitorSmartphone },
];

export const AccountSettings: React.FC = () => {
  const { customerToken, logout } = useAuth();
  const [data, setData] = useState<AccountData | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [pane, setPane] = useState<PaneKey>('profile');

  const reload = useCallback(async () => {
    const [acct, sess] = await Promise.all([
      accountApi.get(customerToken),
      accountApi.sessions(customerToken),
    ]);
    if (acct.success) setData(acct);
    if (sess.success) setSessions(sess.sessions || []);
  }, [customerToken]);

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
    // เมนูซ้าย + เนื้อหาขวา — โชว์ทีละหัวข้อ ไม่ต้องเลื่อนยาวผ่านทุกส่วนอีกต่อไป
    // จอแคบ: เมนูกลายเป็นแถวเลื่อนแนวนอนด้านบนแทน (กริดพับเป็นคอลัมน์เดียว)
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

      <div className="min-w-0 max-w-[44rem]">
        {pane === 'profile' && <ProfileSection data={data} token={customerToken} onSaved={reload} />}
        {pane === 'password' && <PasswordSection token={customerToken} onSaved={reload} />}
        {pane === '2fa' && <TwoFactorSection data={data} token={customerToken} onChanged={reload} />}
        {pane === 'payout' && <PayoutSection data={data} token={customerToken} onSaved={reload} />}
        {pane === 'sessions' && (
          <SessionsSection sessions={sessions} token={customerToken} onChanged={reload} onLogout={logout} />
        )}
      </div>
    </div>
  );
};

/* ---------------- ส่วนย่อยที่ใช้ร่วมกัน ---------------- */

function Block({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
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
      <label className="label">{label}</label>
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

function ProfileSection({ data, token, onSaved }: { data: AccountData; token: string; onSaved: () => void }) {
  const [name, setName] = useState(data.profile.name);
  const [phone, setPhone] = useState(data.profile.phone || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await accountApi.updateProfile(token, name, phone);
    setNotice({ ok: !!res.success, text: res.success ? 'บันทึกข้อมูลแล้ว' : res.message || 'บันทึกไม่สำเร็จ' });
    setBusy(false);
    if (res.success) onSaved();
  };

  const fee =
    data.billing.fee_tier === 'flat'
      ? `เหมาจ่าย ฿${data.billing.flat_fee_amount} ต่องวด`
      : `${data.billing.fee_percent}% ต่อธุรกรรม`;

  return (
    <Block title="ข้อมูลผู้ใช้งาน" desc="ชื่อและเบอร์ติดต่อที่ใช้สำหรับการติดต่อกลับและออกเอกสาร">
      <form onSubmit={submit} className="sheet p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="ชื่อผู้ใช้งาน / ร้านค้า">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label="เบอร์โทรติดต่อ">
            <input
              className="field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08x-xxx-xxxx"
              inputMode="tel"
            />
          </Field>
        </div>

        {/* ข้อมูลที่แก้เองไม่ได้ — แสดงให้เห็นแต่ไม่ให้แก้ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
          <ReadOnly label="อีเมล" value={data.profile.email} wide />
          <ReadOnly label="อุปกรณ์" value={`${data.profile.device_count} เครื่อง`} />
          <ReadOnly label="ค่าธรรมเนียม" value={fee} />
        </div>

        <NoticeLine notice={notice} />

        <div className="rule pt-5 flex justify-end">
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}
          </button>
        </div>
      </form>
    </Block>
  );
}

function ReadOnly({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1 px-4 py-3 ${wide ? 'col-span-2' : ''}`}
      style={{ background: 'var(--surface)' }}
    >
      <span className="label" style={{ fontSize: '10px' }}>
        {label}
      </span>
      <span className="text-[13.5px] truncate" style={{ color: 'var(--ink-soft)' }} title={value}>
        {value}
      </span>
    </div>
  );
}

/* ---------------- เปลี่ยนรหัสผ่าน ---------------- */

function PasswordSection({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setNotice({ ok: false, text: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await accountApi.changePassword(token, cur, next);
    if (res.success) {
      setCur('');
      setNext('');
      setConfirm('');
      setNotice({ ok: true, text: 'เปลี่ยนรหัสผ่านแล้ว — อุปกรณ์อื่นที่ค้างไว้ถูกออกจากระบบทั้งหมด' });
      onSaved();
    } else {
      setNotice({ ok: false, text: res.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
    }
    setBusy(false);
  };

  return (
    <Block title="เปลี่ยนรหัสผ่าน" desc="เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นที่ล็อกอินค้างไว้จะถูกออกจากระบบทันที">
      <form onSubmit={submit} className="sheet p-6 flex flex-col gap-6">
        <Field label="รหัสผ่านปัจจุบัน">
          <input
            type="password"
            className="field"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            autoComplete="current-password"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร">
            <input
              type="password"
              className="field"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่">
            <input
              type="password"
              className="field"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <NoticeLine notice={notice} />

        <div className="rule pt-5 flex justify-end">
          <button type="submit" disabled={busy || !cur || !next} className="btn btn-primary">
            {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </div>
      </form>
    </Block>
  );
}

/* ---------------- 2FA ---------------- */

function TwoFactorSection({ data, token, onChanged }: { data: AccountData; token: string; onChanged: () => void }) {
  const on = data.security.totp_enabled;
  const [stage, setStage] = useState<'idle' | 'setup' | 'off'>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    const res = await accountApi.start2fa(token);
    if (res.success && res.qr) {
      setQr(res.qr);
      setSecret(res.secret || '');
      setStage('setup');
    } else {
      setNotice({ ok: false, text: res.message || 'เริ่มตั้งค่าไม่สำเร็จ' });
    }
    setBusy(false);
  };

  const confirmOn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await accountApi.enable2fa(token, code);
    if (res.success) {
      setStage('idle');
      setCode('');
      setNotice({ ok: true, text: 'เปิดใช้งานยืนยันตัวตนสองชั้นแล้ว' });
      onChanged();
    } else {
      setNotice({ ok: false, text: res.message || 'รหัสไม่ถูกต้อง' });
    }
    setBusy(false);
  };

  const confirmOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await accountApi.disable2fa(token, pw, code);
    if (res.success) {
      setStage('idle');
      setCode('');
      setPw('');
      setNotice({ ok: true, text: 'ปิดการยืนยันตัวตนสองชั้นแล้ว' });
      onChanged();
    } else {
      setNotice({ ok: false, text: res.message || 'ยืนยันไม่สำเร็จ' });
    }
    setBusy(false);
  };

  return (
    <Block
      title="ยืนยันตัวตนสองชั้น (2FA)"
      desc="เพิ่มรหัส 6 หลักจากแอป Authenticator ตอนเข้าสู่ระบบ ป้องกันบัญชีแม้รหัสผ่านหลุด"
    >
      <div className="sheet p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {on ? (
              <ShieldCheck className="w-5 h-5" style={{ color: 'var(--up)' }} />
            ) : (
              <ShieldOff className="w-5 h-5" style={{ color: 'var(--ink-faint)' }} />
            )}
            <div className="flex flex-col">
              <span className="text-[14.5px] font-medium">{on ? 'เปิดใช้งานอยู่' : 'ยังไม่ได้เปิดใช้งาน'}</span>
              <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                {on ? 'ต้องใส่รหัส 6 หลักทุกครั้งที่เข้าสู่ระบบ' : 'บัญชีป้องกันด้วยรหัสผ่านอย่างเดียว'}
              </span>
            </div>
          </div>

          {stage === 'idle' &&
            (on ? (
              <button onClick={() => setStage('off')} className="btn btn-ghost">
                ปิดใช้งาน
              </button>
            ) : (
              <button onClick={start} disabled={busy} className="btn btn-primary">
                {busy ? 'กำลังเตรียม…' : 'เปิดใช้งาน'}
              </button>
            ))}
        </div>

        {/* ขั้นตอนผูกแอป */}
        {stage === 'setup' && (
          <form onSubmit={confirmOn} className="rule pt-6 flex flex-col gap-5">
            <ol className="flex flex-col gap-2 text-[13.5px]" style={{ color: 'var(--ink-soft)' }}>
              <li>1. เปิดแอป Google Authenticator, Microsoft Authenticator หรือแอปที่รองรับ TOTP</li>
              <li>2. สแกน QR ด้านล่าง หรือใส่รหัสลับด้วยตนเอง</li>
              <li>3. กรอกรหัส 6 หลักที่แอปแสดงเพื่อยืนยัน</li>
            </ol>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
              {qr && (
                <img
                  src={qr}
                  alt="QR สำหรับผูกแอป Authenticator"
                  className="rounded shrink-0"
                  style={{ width: 168, height: 168, border: '1px solid var(--line)', background: '#fff', padding: 6 }}
                />
              )}
              <div className="flex flex-col gap-4 flex-1 min-w-0">
                <Field label="รหัสลับ (ใส่เองกรณีสแกนไม่ได้)">
                  <code
                    className="figure text-[13px] px-3 py-2.5 rounded block break-all"
                    style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
                  >
                    {secret}
                  </code>
                </Field>
                <Field label="รหัส 6 หลักจากแอป">
                  <input
                    className="field figure"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    placeholder="000000"
                    style={{ letterSpacing: '.2em' }}
                  />
                </Field>
              </div>
            </div>

            <NoticeLine notice={notice} />

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setStage('idle');
                  setNotice(null);
                }}
                className="btn btn-ghost"
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={busy || code.length !== 6} className="btn btn-primary">
                <Check className="w-4 h-4" />
                {busy ? 'กำลังยืนยัน…' : 'ยืนยันและเปิดใช้งาน'}
              </button>
            </div>
          </form>
        )}

        {/* ขั้นตอนปิด */}
        {stage === 'off' && (
          <form onSubmit={confirmOff} className="rule pt-6 flex flex-col gap-5">
            <div
              className="flex gap-3 px-4 py-3 rounded text-[13.5px]"
              style={{ background: 'var(--wait-wash)', color: 'var(--wait)' }}
            >
              <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-px" />
              <span>การปิด 2FA จะทำให้บัญชีเหลือการป้องกันด้วยรหัสผ่านอย่างเดียว</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="รหัสผ่านบัญชี">
                <input type="password" className="field" value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
              <Field label="รหัส 6 หลักจากแอป">
                <input
                  className="field figure"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="000000"
                  style={{ letterSpacing: '.2em' }}
                />
              </Field>
            </div>

            <NoticeLine notice={notice} />

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setStage('idle');
                  setNotice(null);
                }}
                className="btn btn-ghost"
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={busy || !pw || code.length !== 6} className="btn btn-primary">
                {busy ? 'กำลังปิด…' : 'ยืนยันปิดใช้งาน'}
              </button>
            </div>
          </form>
        )}

        {stage === 'idle' && <NoticeLine notice={notice} />}
      </div>
    </Block>
  );
}

/* ---------------- บัญชีรับเงิน ---------------- */

function PayoutSection({ data, token, onSaved }: { data: AccountData; token: string; onSaved: () => void }) {
  const [bank, setBank] = useState(data.payout.bank || '');
  const [no, setNo] = useState(data.payout.account_no || '');
  const [accName, setAccName] = useState(data.payout.account_name || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await accountApi.updatePayout(token, bank, no, accName);
    setNotice({ ok: !!res.success, text: res.success ? 'บันทึกบัญชีรับเงินแล้ว' : res.message || 'บันทึกไม่สำเร็จ' });
    setBusy(false);
    if (res.success) onSaved();
  };

  return (
    <Block
      title="บัญชีรับเงิน"
      desc="บัญชีที่ใช้รับยอดสุทธิในแต่ละรอบเคลียร์บิล ตรวจสอบให้ถูกต้องก่อนถึงรอบโอน"
    >
      <form onSubmit={submit} className="sheet p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="ธนาคาร">
            <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">— เลือกธนาคาร —</option>
              {THAI_BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เลขที่บัญชี" hint="ตัวเลข 8–20 หลัก ไม่ต้องใส่ขีด">
            <input
              className="field figure"
              value={no}
              onChange={(e) => setNo(e.target.value.replace(/[^\d]/g, '').slice(0, 20))}
              inputMode="numeric"
              placeholder="1234567890"
            />
          </Field>
        </div>

        <Field label="ชื่อบัญชี" hint="ต้องตรงกับชื่อในสมุดบัญชี">
          <input className="field" value={accName} onChange={(e) => setAccName(e.target.value)} maxLength={120} />
        </Field>

        <NoticeLine notice={notice} />

        <div className="rule pt-5 flex justify-end">
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึกบัญชี'}
          </button>
        </div>
      </form>
    </Block>
  );
}

/* ---------------- อุปกรณ์ที่ล็อกอินอยู่ ---------------- */

function SessionsSection({
  sessions,
  token,
  onChanged,
  onLogout,
}: {
  sessions: AccountSession[];
  token: string;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const revoke = async () => {
    setBusy(true);
    const res = await accountApi.revokeOtherSessions(token);
    setNotice({
      ok: !!res.success,
      text: res.success ? `ออกจากระบบอุปกรณ์อื่นแล้ว ${res.revoked ?? 0} เครื่อง` : 'ทำรายการไม่สำเร็จ',
    });
    setBusy(false);
    onChanged();
  };

  return (
    <Block title="อุปกรณ์ที่เข้าสู่ระบบอยู่" desc="หากพบอุปกรณ์ที่ไม่รู้จัก ให้ออกจากระบบทั้งหมดแล้วเปลี่ยนรหัสผ่านทันที">
      <div className="sheet overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl" style={{ minWidth: '28rem' }}>
            <thead>
              <tr>
                <th>เข้าสู่ระบบเมื่อ</th>
                <th>หมดอายุ</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="figure text-[13px]">{s.created_at}</td>
                  <td className="figure text-[13px]" style={{ color: 'var(--ink-soft)' }}>
                    {s.expires_at}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center py-10" style={{ color: 'var(--ink-faint)' }}>
                    ไม่มีข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderTop: '1px solid var(--line)' }}>
          <NoticeLine notice={notice} />
          <div className="flex gap-3 ml-auto">
            <button onClick={revoke} disabled={busy} className="btn btn-ghost">
              ออกจากระบบอุปกรณ์อื่น
            </button>
            <button onClick={onLogout} className="btn btn-ghost">
              <LogOut className="w-4 h-4" />
              ออกจากระบบเครื่องนี้
            </button>
          </div>
        </div>
      </div>
    </Block>
  );
};
