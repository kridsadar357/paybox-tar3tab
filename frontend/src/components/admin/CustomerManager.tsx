import React, { useState, useEffect, useMemo } from 'react';
import { adminApi } from '../../api/adminApi';
import { useAuth } from '../../context/AuthContext';
import type { Customer } from '../../types';
import { Modal, Notice, type NoticeState } from './ui';
import { UserPlus, Search, ShieldCheck, LifeBuoy, Copy, Check, Power, Pencil, Landmark } from 'lucide-react';

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** สุ่มรหัสผ่านชั่วคราวให้แอดมินส่งต่อให้ลูกค้า — ตัดอักขระที่อ่านสับสน (0/O, 1/l/I) ออก
 *  เพราะรหัสนี้ถูกอ่านผ่านโทรศัพท์หรือจดใส่กระดาษบ่อยกว่าถูกคัดลอก */
function generatePassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const CustomerManager: React.FC = () => {
  const { adminToken } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [query, setQuery] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [feeCust, setFeeCust] = useState<Customer | null>(null);
  // ค่าเริ่มต้นเป็นอัตราที่วัดได้จริง ใช้ไปก่อนจนกว่า backend จะตอบกลับมา
  const [providerFee, setProviderFee] = useState(1.77);
  const [recoverCust, setRecoverCust] = useState<Customer | null>(null);

  const fetchCustomers = async () => {
    try {
      const res = await adminApi.getCustomers(adminToken);
      if (res.success) {
        setCustomers(res.customers || []);
        // อัตราที่ผู้ให้บริการรับชำระเงินเก็บ ใช้คำนวณกำไรสุทธิให้เห็นตอนตั้งค่าธรรมเนียม
        if (typeof res.provider_fee_percent === 'number') setProviderFee(res.provider_fee_percent);
      }
      else setNotice({ ok: false, text: 'โหลดข้อมูลลูกค้าไม่สำเร็จ' });
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    }
  };

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (c: Customer) => {
    try {
      const res = await adminApi.toggleCustomer(adminToken, c.id);
      if (!res.success) setNotice({ ok: false, text: 'เปลี่ยนสถานะบัญชีไม่สำเร็จ' });
      fetchCustomers();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || String(c.id) === q
    );
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold tracking-[-.01em]">ลูกค้า</h2>
          <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            บัญชีร้านค้า อัตราค่าธรรมเนียม บัญชีรับเงิน และการกู้คืนการเข้าถึง
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-faint)' }}
            />
            <input
              className="field"
              style={{ paddingLeft: '2.2rem', width: '15rem' }}
              placeholder="ค้นหาชื่อ / อีเมล / รหัส"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary shrink-0">
            <UserPlus className="w-4 h-4" />
            เพิ่มลูกค้า
          </button>
        </div>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="sheet overflow-hidden">
        {filtered.map((c, i) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="min-w-0 flex-1" style={{ minWidth: '13rem' }}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-semibold text-[15px] truncate">{c.name}</span>
                {c.is_active !== 1 && <span className="chip chip-down">ระงับอยู่</span>}
                {c.totp_enabled === 1 && (
                  <span className="chip chip-mute">
                    <ShieldCheck className="w-3 h-3" />
                    2FA
                  </span>
                )}
              </div>
              <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--ink-faint)' }}>
                {c.email} · {c.device_count} เครื่อง
              </p>
            </div>

            <div className="flex flex-col gap-0.5" style={{ minWidth: '8rem' }}>
              <span className="label" style={{ fontSize: '10px' }}>
                ค่าธรรมเนียม
              </span>
              <span className="text-[13.5px]">
                {c.fee_tier === 'flat' ? `เหมาจ่าย ฿${c.flat_fee_amount}` : `${c.fee_percent}%`}
              </span>
            </div>

            <div className="flex flex-col gap-0.5" style={{ minWidth: '9rem' }}>
              <span className="label" style={{ fontSize: '10px' }}>
                บัญชีรับเงิน
              </span>
              {c.payout_account_no ? (
                <span className="text-[13px] truncate" title={`${c.payout_bank} · ${c.payout_account_name}`}>
                  <span className="figure">{c.payout_account_no}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[13px]" style={{ color: 'var(--wait)' }}>
                  <Landmark className="w-3.5 h-3.5" />
                  ยังไม่ตั้ง
                </span>
              )}
            </div>

            <div className="flex flex-col gap-0.5" style={{ minWidth: '7rem' }}>
              <span className="label" style={{ fontSize: '10px' }}>
                ค่าธรรมเนียมสะสม
              </span>
              <span className="figure text-[13.5px] font-semibold" style={{ color: 'var(--jade)' }}>
                ฿{baht(c.fee_collected || 0)}
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0 ml-auto text-[13px] font-medium">
              <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1" style={{ color: 'var(--ink-soft)' }}>
                <Pencil className="w-3.5 h-3.5" />
                แก้ไข
              </button>
              <button onClick={() => setFeeCust(c)} style={{ color: 'var(--jade)' }}>
                ค่าธรรมเนียม
              </button>
              <button onClick={() => setRecoverCust(c)} className="inline-flex items-center gap-1" style={{ color: 'var(--ink-soft)' }}>
                <LifeBuoy className="w-3.5 h-3.5" />
                กู้บัญชี
              </button>
              <button
                onClick={() => handleToggle(c)}
                className="inline-flex items-center gap-1"
                style={{ color: c.is_active === 1 ? 'var(--down)' : 'var(--up)' }}
              >
                <Power className="w-3.5 h-3.5" />
                {c.is_active === 1 ? 'ระงับ' : 'เปิดใช้'}
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="px-5 py-14 text-center text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            {query ? 'ไม่พบลูกค้าที่ตรงกับคำค้น' : 'ยังไม่มีบัญชีลูกค้าในระบบ'}
          </div>
        )}
      </div>

      {showAdd && (
        <AddCustomerModal
          token={adminToken}
          onClose={() => setShowAdd(false)}
          onDone={(text) => {
            setShowAdd(false);
            setNotice({ ok: true, text });
            fetchCustomers();
          }}
        />
      )}

      {editing && (
        <EditCustomerModal
          token={adminToken}
          customer={editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setNotice({ ok: true, text });
            fetchCustomers();
          }}
        />
      )}

      {feeCust && (
        <FeeModal
          token={adminToken}
          customer={feeCust}
          providerFee={providerFee}
          onClose={() => setFeeCust(null)}
          onDone={(text) => {
            setFeeCust(null);
            setNotice({ ok: true, text });
            fetchCustomers();
          }}
        />
      )}

      {recoverCust && (
        <RecoveryModal
          token={adminToken}
          customer={recoverCust}
          onClose={() => setRecoverCust(null)}
          onChanged={fetchCustomers}
        />
      )}
    </div>
  );
};

/* ---------------- เพิ่มลูกค้า ---------------- */

function AddCustomerModal({
  token,
  onClose,
  onDone,
}: {
  token: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.addCustomer(token, name, email, pass);
      if (res.success) onDone(`สร้างบัญชี "${name}" แล้ว`);
      else setErr(res.error === 'email_taken' ? 'อีเมลนี้ถูกใช้งานไปแล้ว' : 'เพิ่มลูกค้าไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="เพิ่มบัญชีลูกค้า" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="ชื่อลูกค้า / ร้านค้า">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="อีเมลสำหรับเข้าใช้งาน">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="รหัสผ่านเริ่มต้น" hint="อย่างน้อย 8 ตัวอักษร">
          <div className="flex gap-2">
            <input className="field figure" value={pass} onChange={(e) => setPass(e.target.value)} required />
            <button type="button" onClick={() => setPass(generatePassword())} className="btn btn-ghost shrink-0">
              สุ่มให้
            </button>
          </div>
        </Field>

        {err && <ErrLine>{err}</ErrLine>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- แก้ไขข้อมูลลูกค้า ---------------- */

function EditCustomerModal({
  token,
  customer,
  onClose,
  onDone,
}: {
  token: string;
  customer: Customer;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(customer.name);
  const [email, setEmail] = useState(customer.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.updateCustomer(token, customer.id, name, email);
      if (res.success) onDone(`บันทึกข้อมูล "${name}" แล้ว`);
      else
        setErr(
          res.error === 'email_taken'
            ? 'อีเมลนี้ถูกใช้โดยบัญชีอื่นแล้ว'
            : res.error === 'invalid_email'
              ? 'รูปแบบอีเมลไม่ถูกต้อง'
              : 'บันทึกไม่สำเร็จ'
        );
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="แก้ไขข้อมูลลูกค้า" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="ชื่อลูกค้า / ร้านค้า">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="อีเมล" hint="เปลี่ยนแล้วลูกค้าต้องใช้อีเมลใหม่ในการเข้าสู่ระบบ">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>

        <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="label" style={{ fontSize: '10px' }}>
            บัญชีรับเงินที่ลูกค้าตั้งไว้
          </span>
          {customer.payout_account_no ? (
            <span className="text-[13.5px]">
              {customer.payout_bank} · <span className="figure">{customer.payout_account_no}</span> ·{' '}
              {customer.payout_account_name}
            </span>
          ) : (
            <span className="text-[13.5px]" style={{ color: 'var(--wait)' }}>
              ลูกค้ายังไม่ได้ตั้งบัญชีรับเงิน — โอนเงินให้ไม่ได้จนกว่าจะตั้ง (ลูกค้าตั้งเองในหน้าตั้งค่า)
            </span>
          )}
        </div>

        {err && <ErrLine>{err}</ErrLine>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- ค่าธรรมเนียม ---------------- */

function FeeModal({
  token,
  customer,
  providerFee,
  onClose,
  onDone,
}: {
  token: string;
  customer: Customer;
  providerFee: number;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [tier, setTier] = useState<'percentage' | 'flat'>(customer.fee_tier || 'percentage');
  const [percent, setPercent] = useState<number>(customer.fee_percent ?? 1);
  const [flat, setFlat] = useState<number>(customer.flat_fee_amount ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ตัวเลขที่กรอกคือที่เก็บจากร้านค้า ไม่ใช่ที่เราได้ — ส่วนที่เหลือจริงคือตัวเลขนี้ลบต้นทุนของผู้ให้บริการ
  const netMargin = Math.round((percent - providerFee) * 100) / 100;
  const suggested = Math.round((providerFee + 1) * 100) / 100;
  const losing = tier === 'percentage' && netMargin <= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.updateFee(token, customer.id, tier, percent, flat);
      if (res.success) onDone(`อัปเดตค่าธรรมเนียมของ "${customer.name}" แล้ว`);
      else setErr('อัปเดตค่าธรรมเนียมไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`ค่าธรรมเนียม · ${customer.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="รูปแบบ">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['percentage', 'ตาม % รายรายการ'],
                ['flat', 'เหมาจ่ายรายงวด'],
              ] as const
            ).map(([key, label]) => {
              const on = tier === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTier(key)}
                  className="px-3 py-2.5 rounded text-[13.5px] transition-colors"
                  style={{
                    background: on ? 'var(--jade-wash)' : 'transparent',
                    color: on ? 'var(--jade)' : 'var(--ink-soft)',
                    border: '1px solid ' + (on ? 'transparent' : 'var(--line)'),
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        {tier === 'percentage' ? (
          <Field label="อัตราค่าธรรมเนียม (%)">
            <input
              className="field figure"
              type="number"
              step="0.01"
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
            <div
              className="flex flex-col gap-1 mt-2 px-3.5 py-2.5 rounded text-[12.5px] leading-relaxed"
              style={{
                background: losing ? 'var(--down-wash)' : 'var(--sunk)',
                color: losing ? 'var(--down)' : 'var(--ink-soft)',
              }}
            >
              <span>
                ผู้ให้บริการรับชำระเงินเก็บ <span className="figure">{providerFee.toFixed(2)}%</span> ของทุกรายการ
              </span>
              <span style={{ fontWeight: 600 }}>
                กำไรสุทธิที่เหลือ <span className="figure">{netMargin.toFixed(2)}%</span>
                {losing && ' — อัตรานี้ขาดทุน บันทึกไม่ได้'}
              </span>
              <span style={{ color: 'var(--ink-faint)' }}>
                อยากได้กำไรสุทธิ 1.00% ให้ตั้งที่{' '}
                <button
                  type="button"
                  onClick={() => setPercent(suggested)}
                  className="figure"
                  style={{ color: 'var(--jade)', fontWeight: 600 }}
                >
                  {suggested.toFixed(2)}%
                </button>
              </span>
            </div>
          </Field>
        ) : (
          <Field label="ค่าธรรมเนียมเหมาจ่ายต่องวด (บาท)">
            <input
              className="field figure"
              type="number"
              step="0.01"
              value={flat}
              onChange={(e) => setFlat(Number(e.target.value))}
            />
          </Field>
        )}

        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          มีผลกับรายการที่เกิดหลังจากนี้เท่านั้น รายการเดิมใช้อัตราที่บันทึกไว้ ณ ตอนนั้น
        </p>

        {err && <ErrLine>{err}</ErrLine>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy || losing} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- กู้บัญชี ---------------- */

function RecoveryModal({
  token,
  customer,
  onClose,
  onChanged,
}: {
  token: string;
  customer: Customer;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [cust, setCust] = useState(customer);
  const [newPass, setNewPass] = useState('');
  const [issued, setIssued] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 8) {
      setErr('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.resetCustomerPassword(token, cust.id, newPass);
      if (res.success) {
        setIssued(newPass);
        setNewPass('');
        onChanged();
      } else setErr(res.error === 'password_too_short' ? 'รหัสผ่านสั้นเกินไป' : 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.disableCustomer2fa(token, cust.id);
      if (res.success) {
        setCust({ ...cust, totp_enabled: 0 });
        onChanged();
      } else setErr(res.error === 'not_enabled' ? 'บัญชีนี้ไม่ได้เปิด 2FA อยู่' : 'ปลด 2FA ไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="กู้บัญชีลูกค้า" subtitle={`${cust.name} · ${cust.email}`} onClose={onClose}>
      <div className="flex flex-col gap-6">
        {err && <ErrLine>{err}</ErrLine>}

        <section className="flex flex-col gap-3 pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--jade)' }} />
            ยืนยันตัวตนสองชั้น
          </div>
          {cust.totp_enabled === 1 ? (
            <>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                ลูกค้าเปิด 2FA อยู่ หากทำโทรศัพท์หายจะเข้าระบบไม่ได้เลย การปลดจะลบรหัสลับทิ้งและตัดเซสชันทั้งหมด
                ลูกค้าต้องตั้ง 2FA ใหม่เองในหน้าตั้งค่า
              </p>
              <button onClick={disable2fa} disabled={busy} className="btn btn-danger self-start">
                ปลด 2FA ให้ลูกค้ารายนี้
              </button>
            </>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              บัญชีนี้ยังไม่ได้เปิด 2FA — ไม่ต้องดำเนินการ
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <LifeBuoy className="w-4 h-4" style={{ color: 'var(--jade)' }} />
            ตั้งรหัสผ่านใหม่
          </div>

          {issued ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px]" style={{ color: 'var(--up)' }}>
                รีเซ็ตสำเร็จ · เซสชันเดิมถูกตัดทั้งหมดแล้ว
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="figure text-[14px] px-3 py-2.5 rounded flex-1 break-all"
                  style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
                >
                  {issued}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(issued);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="btn btn-ghost shrink-0"
                  style={{ padding: '9px 11px' }}
                  title="คัดลอก"
                >
                  {copied ? <Check className="w-4 h-4" style={{ color: 'var(--up)' }} /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--wait)' }}>
                รหัสนี้แสดงครั้งเดียว ปิดหน้าต่างแล้วดูซ้ำไม่ได้ — ส่งให้ลูกค้าผ่านช่องทางที่ปลอดภัย
                และแจ้งให้เปลี่ยนเองทันทีที่เข้าระบบได้
              </p>
            </div>
          ) : (
            <form onSubmit={reset} className="flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  className="field figure"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                />
                <button type="button" onClick={() => setNewPass(generatePassword())} className="btn btn-ghost shrink-0">
                  สุ่มให้
                </button>
              </div>
              <button type="submit" disabled={busy} className="btn btn-primary self-start">
                {busy ? 'กำลังดำเนินการ…' : 'รีเซ็ตรหัสผ่านและตัดเซสชันทั้งหมด'}
              </button>
            </form>
          )}
        </section>
      </div>
    </Modal>
  );
}

/* ---------------- ชิ้นส่วนย่อย ---------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

function ErrLine({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[13.5px] px-3.5 py-2.5 rounded"
      style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
      role="alert"
    >
      {children}
    </p>
  );
}
