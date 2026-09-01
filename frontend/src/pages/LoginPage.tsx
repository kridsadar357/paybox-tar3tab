import React, { useState } from 'react';
import { useAuth, getRouteRole } from '../context/AuthContext';
import { customerApi } from '../api/customerApi';
import { adminApi } from '../api/adminApi';
import { ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginAdmin, loginCustomer } = useAuth();
  // /portal/administrator กับ /customer ล็อกฟอร์มตาม route จริงเลย ไม่ให้สลับ tab ได้ — กันคนเข้าหน้า
  // customer แล้วยังเห็น/ลองฟอร์ม admin ได้ (เคยเป็น tab switcher เดียวใช้ร่วมกันทั้งสอง path)
  // เหลือ tab switcher ไว้เฉพาะตอน dev (root path ที่ไม่ใช่ /customer หรือ /portal/administrator)
  const routeRole = getRouteRole();
  const [tab, setTab] = useState<'admin' | 'customer'>(routeRole === 'customer' ? 'customer' : 'admin');
  const showTabs = routeRole === 'any';

  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminNeedOtp, setAdminNeedOtp] = useState(false);
  const [adminOtp, setAdminOtp] = useState('');

  const [custEmail, setCustEmail] = useState('');
  const [custPass, setCustPass] = useState('');
  const [custError, setCustError] = useState('');
  const [loading, setLoading] = useState(false);
  // บัญชีที่เปิด 2FA: รอบแรก backend ตอบ otp_required แล้วค่อยโชว์ช่องกรอกรหัส 6 หลัก
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp] = useState('');

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');
    if (!adminUser.trim() || !adminPass.trim()) {
      setAdminError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }
    if (adminNeedOtp && adminOtp.length !== 6) {
      setAdminError('กรุณากรอกรหัส 6 หลักจากแอป Authenticator');
      return;
    }

    setAdminLoading(true);
    try {
      const res = await adminApi.login(adminUser.trim(), adminPass, adminNeedOtp ? adminOtp : undefined);
      if (res.success && res.token) {
        loginAdmin(res.token);
      } else if (res.error === 'otp_required') {
        setAdminNeedOtp(true);
        setAdminError('');
      } else if (res.error === 'invalid_otp') {
        setAdminOtp('');
        setAdminError('รหัส 6 หลักไม่ถูกต้องหรือหมดอายุ ลองใหม่อีกครั้ง');
      } else {
        setAdminNeedOtp(false);
        setAdminOtp('');
        setAdminError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err: any) {
      setAdminError(err.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustError('');
    if (!custEmail || !custPass) {
      setCustError('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
      return;
    }
    if (needOtp && otp.length !== 6) {
      setCustError('กรุณากรอกรหัส 6 หลักจากแอป Authenticator');
      return;
    }

    setLoading(true);
    try {
      const res = await customerApi.login(custEmail, custPass, needOtp ? otp : undefined);
      if (res.success && res.token) {
        loginCustomer(res.token);
      } else if (res.error === 'otp_required') {
        setNeedOtp(true);
        setCustError('');
      } else if (res.error === 'invalid_otp') {
        setOtp('');
        setCustError('รหัส 6 หลักไม่ถูกต้องหรือหมดอายุ ลองใหม่อีกครั้ง');
      } else {
        setNeedOtp(false);
        setOtp('');
        setCustError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err: any) {
      setCustError(err.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = tab === 'admin';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)' }}>
      {/* แถบบางบนสุด — จุดแบรนด์เดียวที่ยอมให้เด่น */}
      <div style={{ height: '3px', background: 'var(--jade)' }} />

      <div className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[26rem] flex flex-col gap-9">
          <header className="flex flex-col gap-2.5">
            <span className="text-[24px] font-bold tracking-[-.025em]">
              Pay<span style={{ color: 'var(--jade)' }}>Box</span>
            </span>
            <h1 className="text-[15px]" style={{ color: 'var(--ink-soft)' }}>
              {isAdmin ? 'ระบบผู้ดูแล — จัดการอุปกรณ์และการเคลียร์บิล' : 'เข้าสู่ระบบเพื่อดูยอดขายและจัดการเครื่องของคุณ'}
            </h1>
          </header>

          {showTabs && (
            <div className="flex gap-5" style={{ borderBottom: '1px solid var(--line)' }}>
              {(
                [
                  ['admin', 'ผู้ดูแลระบบ'],
                  ['customer', 'ร้านค้า'],
                ] as const
              ).map(([key, label]) => {
                const on = tab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className="relative pb-2.5 text-[14px] transition-colors"
                    style={{ color: on ? 'var(--ink)' : 'var(--ink-faint)', fontWeight: on ? 600 : 500 }}
                  >
                    {label}
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-0 -bottom-px h-[2px]"
                      style={{ background: 'var(--jade)', opacity: on ? 1 : 0 }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {isAdmin ? (
            <form onSubmit={handleAdminSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="adminuser" className="label">
                  ชื่อผู้ใช้
                </label>
                <input
                  id="adminuser"
                  type="text"
                  value={adminUser}
                  onChange={(e) => setAdminUser(e.target.value)}
                  placeholder="admin"
                  className="field"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="adminpw" className="label">
                  รหัสผ่าน
                </label>
                <input
                  id="adminpw"
                  type="password"
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  placeholder="••••••••••"
                  className="field"
                  autoComplete="current-password"
                />
              </div>

              {adminNeedOtp && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="adminotp" className="label">
                    รหัสยืนยัน 6 หลัก
                  </label>
                  <input
                    id="adminotp"
                    className="field figure"
                    value={adminOtp}
                    onChange={(e) => setAdminOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    style={{ letterSpacing: '.28em', fontSize: '17px' }}
                  />
                  <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                    เปิดแอป Authenticator แล้วกรอกรหัสที่แสดงอยู่
                  </span>
                </div>
              )}

              {adminError && <ErrorNote>{adminError}</ErrorNote>}

              <button type="submit" disabled={adminLoading} className="btn btn-primary w-full" style={{ padding: '11px 16px' }}>
                {adminLoading ? 'กำลังตรวจสอบ…' : adminNeedOtp ? 'ยืนยันรหัส' : 'เข้าสู่ระบบ'}
                {!adminLoading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCustomerSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="label">
                  อีเมล
                </label>
                <input
                  id="email"
                  type="email"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="field"
                  autoComplete="email"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="pw" className="label">
                  รหัสผ่าน
                </label>
                <input
                  id="pw"
                  type="password"
                  value={custPass}
                  onChange={(e) => setCustPass(e.target.value)}
                  placeholder="••••••••••"
                  className="field"
                  autoComplete="current-password"
                />
              </div>

              {needOtp && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="otp" className="label">
                    รหัสยืนยัน 6 หลัก
                  </label>
                  <input
                    id="otp"
                    className="field figure"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    style={{ letterSpacing: '.28em', fontSize: '17px' }}
                  />
                  <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                    เปิดแอป Authenticator แล้วกรอกรหัสที่แสดงอยู่
                  </span>
                </div>
              )}

              {custError && <ErrorNote>{custError}</ErrorNote>}

              <button type="submit" disabled={loading} className="btn btn-primary w-full" style={{ padding: '11px 16px' }}>
                {loading ? 'กำลังตรวจสอบ…' : needOtp ? 'ยืนยันรหัส' : 'เข้าสู่ระบบ'}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          )}

          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            การเข้าสู่ระบบนี้เชื่อมต่อแบบเข้ารหัส หากลืมรหัสผ่านกรุณาติดต่อผู้ดูแลระบบ
          </p>
        </div>
      </div>
    </div>
  );
};

function ErrorNote({ children }: { children: React.ReactNode }) {
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
