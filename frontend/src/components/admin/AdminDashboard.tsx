import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { adminApi } from '../../api/adminApi';
import { useAuth } from '../../context/AuthContext';
import type { AdminSummaryResponse, TopologyDevice } from '../../types';
import { DollarSign, Cpu, Users, TrendingUp, RefreshCw, Calendar } from 'lucide-react';
import { FleetTopology } from './FleetTopology';
// Leaflet เป็นก้อนใหญ่ที่สุดในหน้าเว็บ (~160KB) และแผนที่อยู่ล่างสุดของหน้า
// โหลดแยกทีหลังเพื่อให้ตัวเลขและผังด้านบนขึ้นก่อน
const FleetMap = lazy(() => import('./FleetMap').then((m) => ({ default: m.FleetMap })));

const TOPOLOGY_REFRESH_MS = 15000;

export const AdminDashboard: React.FC = () => {
  const { adminToken } = useAuth();
  const [data, setData] = useState<AdminSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ดึง topology ที่นี่ที่เดียวแล้วส่งต่อให้ทั้งผังและแผนที่ — ข้อมูลชุดเดียวกัน ไม่ยิงซ้ำสองรอบ
  const [topology, setTopology] = useState<TopologyDevice[]>([]);
  const [topoAt, setTopoAt] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  const todayStr = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  const fetchSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getSummary(adminToken, fromDate, toDate);
      if (res.success) {
        setData(res);
      } else {
        setError('ไม่สามารถโหลดข้อมูลสรุปได้');
      }
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const fetchTopology = useCallback(async () => {
    try {
      const res = await adminApi.getTopology(adminToken);
      if (res.success) {
        setTopology(res.devices || []);
        setTopoAt(new Date());
      }
    } catch {
      /* เงียบไว้ รอบถัดไปค่อยลองใหม่ — ไม่ต้องขึ้น error รบกวนทั้งหน้า */
    }
  }, [adminToken]);

  useEffect(() => {
    fetchSummary();
  }, [fromDate, toDate]);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  // อัปเดตอัตโนมัติ และหยุดยิงเมื่อผู้ใช้สลับไปแท็บอื่น
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchTopology();
    }, TOPOLOGY_REFRESH_MS);
    return () => clearInterval(id);
  }, [live, fetchTopology]);

  const num = (v: unknown) =>
    Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold tracking-[-.01em]">ภาพรวมระบบ</h2>
          <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            ยอดขาย ค่าธรรมเนียม และสถานะอุปกรณ์ทั้งหมด
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded text-[13px]"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
          >
            <Calendar className="w-4 h-4 shrink-0" style={{ color: 'var(--jade)' }} />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="figure bg-transparent focus:outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <span style={{ color: 'var(--ink-faint)' }}>ถึง</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="figure bg-transparent focus:outline-none"
              style={{ color: 'var(--ink)' }}
            />
          </div>

          <button onClick={fetchSummary} className="btn btn-ghost" title="โหลดใหม่">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <p
          className="text-[13.5px] px-3.5 py-2.5 rounded"
          style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      {/* ตัวเลขหลัก — แยกด้วยเส้น ไม่ใช่การ์ดลอย ให้เข้ากับหน้าอื่นในระบบ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
        <Metric
          icon={DollarSign}
          label="ยอดรวมรับชำระ"
          value={`฿${num(data?.summary?.total_amount)}`}
          sub={`${data?.summary?.tx_count || 0} รายการ`}
        />
        <Metric
          icon={TrendingUp}
          label="กำไรแพลตฟอร์ม"
          value={`฿${num(data?.summary?.total_profit)}`}
          sub={`ค่าธรรมเนียม ฿${num(data?.summary?.total_fee)} − Stripe ฿${num(data?.summary?.total_stripe_fee)}`}
          tone="jade"
        />
        <Metric
          icon={Cpu}
          label="อุปกรณ์เปิดใช้งาน"
          value={`${data?.device_active_count || 0} / ${data?.device_count || 0}`}
          sub="เครื่องที่เปิดสวิตช์ไว้"
        />
        <Metric
          icon={Users}
          label="ลูกค้า"
          value={`${data?.customer_count || 0}`}
          sub={`${data?.customers_pending_settlement || 0} รายรอเคลียร์บิล`}
          tone={data?.customers_pending_settlement ? 'wait' : undefined}
        />
      </section>

      {/* ผังเครื่อง–เจ้าของ และแผนที่ ใช้ข้อมูลชุดเดียวกันที่อัปเดตอัตโนมัติ */}
      <div>
        <FleetTopology
          devices={topology}
          updatedAt={topoAt}
          live={live}
          onToggleLive={() => setLive((v) => !v)}
          refreshMs={TOPOLOGY_REFRESH_MS}
        />
      </div>

      <div>
        <Suspense
          fallback={
            <div className="sheet px-5 py-14 text-center text-[14px]" style={{ color: 'var(--ink-faint)' }}>
              กำลังโหลดแผนที่…
            </div>
          }
        >
          <FleetMap devices={topology} />
        </Suspense>
      </div>
    </div>
  );
};

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  sub?: string;
  tone?: 'jade' | 'wait';
}) {
  const color = tone === 'jade' ? 'var(--jade)' : tone === 'wait' ? 'var(--wait)' : 'var(--ink)';
  return (
    <div className="flex flex-col gap-2 px-5 py-5" style={{ background: 'var(--paper)' }}>
      <div className="flex items-center gap-2">
        <Icon className="w-[15px] h-[15px] shrink-0" style={{ color: 'var(--ink-faint)' }} />
        <span className="label">{label}</span>
      </div>
      <span className="figure text-[22px] font-semibold leading-tight" style={{ color }}>
        {value}
      </span>
      {sub && (
        <span className="text-[12px] leading-snug" style={{ color: 'var(--ink-faint)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}
