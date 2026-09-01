import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, PanelLeftClose, PanelLeftOpen, Menu, X } from 'lucide-react';
import type { NavItem } from './navItems';

interface Props {
  items: NavItem[];
  /** คำกำกับใต้แบรนด์ บอกว่ากำลังอยู่พอร์ทัลไหน */
  tag: string;
  /** แยกคีย์ localStorage ตามพอร์ทัล — คนคนเดียวอาจย่อเมนูฝั่งหนึ่งแต่ไม่ย่ออีกฝั่ง */
  storageKey: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

/**
 * เมนูหลักของพอร์ทัล ใช้ร่วมกันทั้งฝั่งผู้ดูแลระบบและฝั่งร้านค้า
 *
 * เป็นแถบข้างแทนแท็บแนวนอน เพราะเมนูแนวนอนกินความสูงของหน้าจอ ซึ่งเป็นทรัพยากรที่ขาดแคลนกว่า
 * ความกว้างเสมอบนจอคอมพิวเตอร์ และเมื่อเมนูย้ายมาด้านข้าง เนื้อหาจึงใช้ความกว้างได้เต็ม
 *
 * สามสภาพตามขนาดจอ:
 *   จอใหญ่ (lg+) — แถบข้างอยู่ประจำที่ ย่อเหลือเฉพาะไอคอนได้ จำสถานะไว้ใน localStorage
 *   จอเล็ก       — ซ่อนไว้ เปิดเป็นลิ้นชักทับหน้าจอเมื่อกดปุ่มเมนู แล้วปิดเองเมื่อเลือกหัวข้อ
 */
export const PortalSidebar: React.FC<Props> = ({ items, tag, storageKey, activeTab, setActiveTab }) => {
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, collapsed ? '1' : '0');
  }, [collapsed, storageKey]);

  // ปิดลิ้นชักด้วย Esc ตามที่ผู้ใช้คาดหวังจากอะไรก็ตามที่ทับหน้าจออยู่
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const width = collapsed ? '4.25rem' : '13.5rem';

  const NavList = ({ compact, onPick }: { compact: boolean; onPick?: () => void }) => (
    <nav className="flex flex-col gap-1 px-2.5" aria-label="เมนูหลัก">
      {items.map(({ key, label, icon: Icon }) => {
        const on = activeTab === key;
        return (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key);
              onPick?.();
            }}
            aria-current={on ? 'page' : undefined}
            title={compact ? label : undefined}
            className="flex items-center gap-3 rounded px-3 py-2.5 text-[14px] text-left transition-colors"
            style={{
              background: on ? 'var(--jade-wash)' : 'transparent',
              color: on ? 'var(--jade)' : 'var(--ink-soft)',
              fontWeight: on ? 600 : 500,
            }}
          >
            <Icon className="w-[17px] h-[17px] shrink-0" />
            {!compact && <span className="truncate">{label}</span>}
          </button>
        );
      })}
    </nav>
  );

  const Brand = ({ showText }: { showText: boolean }) => (
    <div className="flex items-center gap-2.5 h-[58px] px-4 shrink-0">
      <span className="text-[19px] font-bold tracking-[-.02em] leading-none" style={{ color: 'var(--ink)' }}>
        {showText ? (
          <>
            Pay<span style={{ color: 'var(--jade)' }}>Box</span>
          </>
        ) : (
          <span style={{ color: 'var(--jade)' }}>P</span>
        )}
      </span>
      {showText && (
        <span className="label truncate" style={{ letterSpacing: '.14em' }}>
          {tag}
        </span>
      )}
    </div>
  );

  return (
    <>
      <header
        className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-[56px] px-3"
        style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          className="btn btn-quiet"
          aria-label="เปิดเมนู"
          aria-expanded={drawerOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-[17px] font-bold tracking-[-.02em]">
          Pay<span style={{ color: 'var(--jade)' }}>Box</span>
        </span>
        <button onClick={logout} className="btn btn-quiet" aria-label="ออกจากระบบ">
          <LogOut className="w-[18px] h-[18px]" />
        </button>
      </header>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="เมนูหลัก">
          <div className="flex-1 max-w-[15rem] flex flex-col" style={{ background: 'var(--paper)' }}>
            <div className="flex items-center justify-between pr-2" style={{ borderBottom: '1px solid var(--line)' }}>
              <Brand showText />
              <button onClick={() => setDrawerOpen(false)} className="btn btn-quiet" aria-label="ปิดเมนู">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <NavList compact={false} onPick={() => setDrawerOpen(false)} />
            </div>
            <div className="p-2.5" style={{ borderTop: '1px solid var(--line)' }}>
              <button onClick={logout} className="btn btn-ghost w-full">
                <LogOut className="w-4 h-4" />
                ออกจากระบบ
              </button>
            </div>
          </div>
          <div className="flex-1" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      <aside
        className="hidden lg:flex flex-col shrink-0 sticky top-0 h-screen transition-[width] duration-150"
        style={{ width, background: 'var(--paper)', borderRight: '1px solid var(--line)' }}
      >
        <div style={{ borderBottom: '1px solid var(--line)' }}>
          <Brand showText={!collapsed} />
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <NavList compact={collapsed} />
        </div>

        <div className="p-2.5 flex flex-col gap-1" style={{ borderTop: '1px solid var(--line)' }}>
          <button
            onClick={logout}
            className="flex items-center gap-3 rounded px-3 py-2.5 text-[14px] transition-colors"
            style={{ color: 'var(--ink-soft)' }}
            title={collapsed ? 'ออกจากระบบ' : undefined}
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {!collapsed && <span>ออกจากระบบ</span>}
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-3 rounded px-3 py-2.5 text-[14px] transition-colors"
            style={{ color: 'var(--ink-faint)' }}
            aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
            title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-[17px] h-[17px] shrink-0" />
            ) : (
              <PanelLeftClose className="w-[17px] h-[17px] shrink-0" />
            )}
            {!collapsed && <span>ย่อเมนู</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
