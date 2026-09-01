import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { PortalSidebar } from './components/layout/PortalSidebar';
import { ADMIN_TABS, CUSTOMER_TABS } from './components/layout/navItems';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { DeviceManager } from './components/admin/DeviceManager';
import { CustomerManager } from './components/admin/CustomerManager';
import { SettlementManager } from './components/admin/SettlementManager';
import { CustomerDashboard } from './components/customer/CustomerDashboard';

// สองหน้านี้ลากของหนักมาด้วย (รายงานมีกราฟ, ภาพรวมมีแผนที่ Leaflet) และไม่ได้ถูกเปิดทันทีที่
// เข้าระบบ โหลดแบบ lazy เพื่อให้หน้า login กับหน้าแรกไม่ต้องรอโค้ดที่ยังไม่ได้ใช้
const ReportsView = lazy(() =>
  import('./components/admin/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const AdminSettings = lazy(() =>
  import('./components/admin/AdminSettings').then((m) => ({ default: m.AdminSettings }))
);

const ADMIN_KEYS = ADMIN_TABS.map((t) => t.key);
const CUSTOMER_KEYS = CUSTOMER_TABS.map((t) => t.key);

function PaneFallback() {
  return (
    <p className="text-[14px] pt-2" style={{ color: 'var(--ink-soft)' }}>
      กำลังโหลด…
    </p>
  );
}

const MainContent: React.FC = () => {
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState('');

  // ค่าเริ่มต้น tab ต่างกันตาม role — เซ็ตครั้งเดียวตอน role เปลี่ยนจาก 'none' เป็นค่าจริงหลัง login
  useEffect(() => {
    if (role === 'admin' && !ADMIN_KEYS.includes(activeTab)) setActiveTab('dashboard');
    else if (role === 'customer' && !CUSTOMER_KEYS.includes(activeTab)) setActiveTab('overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (role === 'none') return <LoginPage />;

  const admin = role === 'admin';

  // เมนูอยู่แถบข้าง เนื้อหากินความกว้างเต็มจอ — โครงเดียวกันทั้งสองพอร์ทัล
  // min-w-0 จำเป็นกับ flex child ที่มีตารางกว้างข้างใน ไม่งั้นตารางจะดันทั้งหน้าให้เลื่อนแนวนอน
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <PortalSidebar
        items={admin ? ADMIN_TABS : CUSTOMER_TABS}
        tag={admin ? 'ADMIN' : 'MERCHANT'}
        storageKey={admin ? 'paybox_sidebar_collapsed' : 'paybox_sidebar_collapsed_customer'}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        {admin ? (
          <Suspense fallback={<PaneFallback />}>
            {activeTab === 'dashboard' && <AdminDashboard />}
            {activeTab === 'devices' && <DeviceManager />}
            {activeTab === 'customers' && <CustomerManager />}
            {activeTab === 'settlements' && <SettlementManager />}
            {activeTab === 'reports' && <ReportsView />}
            {activeTab === 'settings' && <AdminSettings />}
          </Suspense>
        ) : (
          <CustomerDashboard activeTab={activeTab} />
        )}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
