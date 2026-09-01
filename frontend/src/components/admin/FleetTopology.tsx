import React, { useState, useEffect, useRef } from 'react';
import type { TopologyDevice } from '../../types';
import { Power, PowerOff } from 'lucide-react';
import { deviceContact } from '../../lib/format';

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (n: number | string) => {
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 10_000) return (v / 1_000).toFixed(0) + 'K';
  return v.toLocaleString('th-TH', { maximumFractionDigits: 0 });
};

interface Group {
  key: string;
  customerId: number | null;
  customerName: string;
  devices: TopologyDevice[];
  today: number;
  settled: number;
  pending: number;
}

/**
 * ผังความสัมพันธ์ ลูกค้า → เครื่อง แบบแผ่กว้าง
 * เส้นเชื่อมวาดด้วย SVG ที่ซ้อนอยู่ใต้การ์ด แล้วคำนวณพิกัดจากตำแหน่งจริงของ DOM
 * (ไม่ใช้ไลบรารีกราฟ เพราะโครงเป็นต้นไม้สองชั้นตายตัว ไม่ต้องใช้ physics layout)
 */
interface Props {
  devices: TopologyDevice[];
  updatedAt: Date | null;
  live: boolean;
  onToggleLive: () => void;
  refreshMs: number;
}

export const FleetTopology: React.FC<Props> = ({ devices, updatedAt, live, onToggleLive, refreshMs }) => {
  const groups: Group[] = [];
  const byCustomer = new Map<string, Group>();
  for (const d of devices) {
    const key = d.customer_id === null ? 'none' : String(d.customer_id);
    let g = byCustomer.get(key);
    if (!g) {
      g = {
        key,
        customerId: d.customer_id,
        customerName: d.customer_name || 'ยังไม่มีเจ้าของ',
        devices: [],
        today: 0,
        settled: 0,
        pending: 0,
      };
      byCustomer.set(key, g);
      groups.push(g);
    }
    g.devices.push(d);
    g.today += Number(d.today_amount);
    g.settled += Number(d.settled_net);
    g.pending += Number(d.pending_net);
  }

  const totals = devices.reduce(
    (a, d) => ({
      today: a.today + Number(d.today_amount),
      settled: a.settled + Number(d.settled_net),
      pending: a.pending + Number(d.pending_net),
    }),
    { today: 0, settled: 0, pending: 0 }
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold tracking-[-.01em]">ผังเครื่องและเจ้าของ</h2>
          <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            เงินเข้าวันนี้ · โอนให้แล้ว · คงเหลือรอโอน — อัปเดตทุก {refreshMs / 1000} วินาที
          </p>
        </div>

        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="figure text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              {updatedAt.toLocaleTimeString('th-TH')}
            </span>
          )}
          <button
            onClick={onToggleLive}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[12.5px] transition-colors"
            style={{
              border: '1px solid var(--line)',
              color: live ? 'var(--up)' : 'var(--ink-faint)',
              background: live ? 'var(--up-wash)' : 'transparent',
            }}
            title={live ? 'กำลังอัปเดตอัตโนมัติ' : 'หยุดอัปเดตอัตโนมัติ'}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 6,
                height: 6,
                background: 'currentColor',
                animation: live ? 'pulse 2s ease-in-out infinite' : 'none',
              }}
            />
            {live ? 'สด' : 'หยุด'}
          </button>
        </div>
      </div>

      {/* ยอดรวมทั้งฟลีต */}
      <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--line)' }}>
        <Total label="เงินเข้าวันนี้" value={baht(totals.today)} />
        <Total label="โอนให้แล้วสะสม" value={baht(totals.settled)} tone="up" />
        <Total label="คงเหลือรอโอน" value={baht(totals.pending)} tone="wait" />
      </div>

      {devices.length === 0 ? (
        <div className="sheet px-5 py-14 text-center">
          <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            ยังไม่มีอุปกรณ์ในระบบ
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <CustomerBranch key={g.key} g={g} />
          ))}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>
    </section>
  );
};

function Total({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'wait' }) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'wait' ? 'var(--wait)' : 'var(--ink)';
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4" style={{ background: 'var(--paper)' }}>
      <span className="label">{label}</span>
      <span className="figure text-[20px] font-semibold leading-tight" style={{ color }}>
        ฿{value}
      </span>
    </div>
  );
}

/** ลูกค้าหนึ่งราย + เครื่องทั้งหมดของเขา พร้อมเส้นเชื่อมที่วาดตามตำแหน่ง DOM จริง */
function CustomerBranch({ g }: { g: Group }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // คำนวณเส้นใหม่ทุกครั้งที่ layout เปลี่ยน (resize / จำนวนเครื่องเปลี่ยน)
  useEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current;
      const root = rootRef.current;
      if (!wrap || !root) return;
      const wb = wrap.getBoundingClientRect();
      const rb = root.getBoundingClientRect();
      const startX = rb.right - wb.left;
      const startY = rb.top + rb.height / 2 - wb.top;

      const next: string[] = [];
      nodeRefs.current.forEach((n) => {
        if (!n) return;
        const nb = n.getBoundingClientRect();
        const endX = nb.left - wb.left;
        const endY = nb.top + nb.height / 2 - wb.top;
        const mid = startX + (endX - startX) / 2;
        next.push(`M${startX},${startY} C${mid},${startY} ${mid},${endY} ${endX},${endY}`);
      });
      setPaths(next);
      setBox({ w: wb.width, h: wb.height });
    };

    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', draw);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [g.devices.length]);

  return (
    <div ref={wrapRef} className="relative sheet p-5">
      {/* เส้นเชื่อมอยู่หลังการ์ดเสมอ และไม่รับ event */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={box.w}
        height={box.h}
        style={{ zIndex: 0 }}
        aria-hidden="true"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />
        ))}
      </svg>

      <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-center" style={{ zIndex: 1 }}>
        {/* โหนดลูกค้า */}
        <div
          ref={rootRef}
          className="shrink-0 lg:w-[15rem] rounded px-4 py-3.5 flex flex-col gap-2"
          style={{ background: 'var(--sunk)', border: '1px solid var(--line-strong)' }}
        >
          <span className="font-semibold text-[15px] truncate">{g.customerName}</span>
          <span className="label" style={{ fontSize: '10px' }}>
            {g.devices.length} เครื่อง
          </span>
          <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
            <Badge label="วันนี้" value={compact(g.today)} />
            <Badge label="โอนแล้ว" value={compact(g.settled)} tone="up" />
            <Badge label="คงเหลือ" value={compact(g.pending)} tone="wait" />
          </div>
        </div>

        {/* โหนดเครื่อง */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {g.devices.map((d, i) => (
            <div
              key={d.id}
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
              className="rounded px-4 py-3 flex flex-col gap-2.5"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13.5px] font-medium truncate">{d.shop_name || d.name}</span>
                {/* ไอคอนนี้บอกสวิตช์เปิด/ปิดของแอดมิน ไม่ใช่การเชื่อมต่อ — เดิมใช้ไอคอน Wifi
                    ซึ่งสื่อผิดว่าเครื่องออนไลน์อยู่ ทั้งที่ค่าเดียวกันไม่ได้บอกเรื่องเน็ตเลย */}
                {d.is_active === 1 ? (
                  <Power
                    className="w-[14px] h-[14px] shrink-0"
                    style={{ color: 'var(--up)' }}
                    aria-label="เปิดใช้งาน"
                  />
                ) : (
                  <PowerOff
                    className="w-[14px] h-[14px] shrink-0"
                    style={{ color: 'var(--ink-faint)' }}
                    aria-label="ปิดใช้งาน"
                  />
                )}
              </div>

              <span className="text-[11.5px] leading-tight" style={{ color: deviceContact(d.last_seen_at, d.firmware_version).color }}>
                {deviceContact(d.last_seen_at, d.firmware_version).text}
              </span>

              <div className="flex flex-col gap-1">
                <Badge label="วันนี้" value={compact(d.today_amount)} sub={`${d.today_tx} รายการ`} />
                <Badge label="โอนแล้ว" value={compact(d.settled_net)} tone="up" />
                <Badge label="คงเหลือ" value={compact(d.pending_net)} tone="wait" sub={d.pending_tx > 0 ? `${d.pending_tx} รายการ` : undefined} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({ label, value, tone, sub }: { label: string; value: string; tone?: 'up' | 'wait'; sub?: string }) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'wait' ? 'var(--wait)' : 'var(--ink)';
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
      <span style={{ color: 'var(--ink-faint)' }}>{label}</span>
      <span className="flex items-baseline gap-1.5">
        {sub && (
          <span className="figure text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
            {sub}
          </span>
        )}
        <span className="figure font-semibold" style={{ color }}>
          ฿{value}
        </span>
      </span>
    </div>
  );
}
