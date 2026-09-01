import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_API_BASE } from '../../api/client';
import { ExternalLink, RefreshCw, Download, LayoutDashboard, TrendingUp, Cpu, MapPin } from 'lucide-react';
import { DUO, useIsDark } from '../../lib/chart';
import { adminApi } from '../../api/adminApi';

// จานสีที่ผ่าน validator แล้วอยู่ที่ lib/chart.ts — ใช้ร่วมกับกราฟฝั่งลูกค้า เพื่อไม่ให้ค่าที่ตรวจแล้ว
// ถูกคัดลอกไปหลายที่แล้วค่อยๆ เพี้ยนจากกัน
const SERIES = {
  amount: { ...DUO.a, label: 'ยอดรับชำระ' },
  profit: { ...DUO.b, label: 'กำไรแพลตฟอร์ม' },
};

interface Summary {
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_stripe_fee: number;
  total_profit: number;
  total_net: number;
}
interface DailyRow {
  day: string;
  tx_count: number;
  total_amount: number;
  total_profit: number;
}
interface DeviceRow {
  id: number;
  name: string;
  shop_name: string | null;
  region_zone: string | null;
  province: string | null;
  customer_name: string;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_stripe_fee: number;
  total_profit: number;
}
interface GroupRow {
  region_zone?: string;
  province?: string;
  tx_count: number;
  total_amount: number;
  total_profit: number;
}
interface ReportData {
  success: boolean;
  range: { from: string; to: string };
  summary: Summary;
  daily: DailyRow[];
  devices: DeviceRow[];
  top_device: DeviceRow | null;
  bottom_device: DeviceRow | null;
  regions: GroupRow[];
  provinces: GroupRow[];
}

type PaneKey = 'summary' | 'trend' | 'devices' | 'area';

const REPORT_PANES: { key: PaneKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'summary', label: 'สรุป', icon: LayoutDashboard },
  { key: 'trend', label: 'แนวโน้ม', icon: TrendingUp },
  { key: 'devices', label: 'รายเครื่อง', icon: Cpu },
  { key: 'area', label: 'ตามพื้นที่', icon: MapPin },
];

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortBaht = (n: number) => {
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toFixed(0);
};
const dayLabel = (d: string) => {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
};

export const ReportsView: React.FC = () => {
  const { adminToken } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState<'daily' | 'devices' | null>(null);
  const [pane, setPane] = useState<PaneKey>('summary');
  const dark = useIsDark();

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${ADMIN_API_BASE}/reports/data?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await res.json();
      if (json.success) setData(json);
      else setErr('ไม่สามารถโหลดรายงานได้');
    } catch {
      setErr('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, [adminToken, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async (kind: 'daily' | 'devices') => {
    setExporting(kind);
    setErr('');
    try {
      await adminApi.exportReport(adminToken, kind, from, to);
    } catch (e: any) {
      setErr(e.message || 'ดาวน์โหลดไม่สำเร็จ');
    } finally {
      setExporting(null);
    }
  };

  const s = data?.summary;
  const margin = s && Number(s.total_amount) > 0 ? (Number(s.total_profit) / Number(s.total_amount)) * 100 : 0;

  return (
    <div className="flex flex-col gap-10">
      {/* ---- ตัวกรอง: อยู่แถวเดียวเหนือทุกอย่าง ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="label">ตั้งแต่</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field figure" style={{ width: 'auto' }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="label">ถึง</label>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="field figure" style={{ width: 'auto' }} />
        </div>
        <button onClick={load} className="btn btn-ghost" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          รีเฟรช
        </button>

        {/* สองไฟล์เพราะเอาไปใช้คนละอย่าง: รายวันไว้กระทบยอด รายเครื่องไว้ดูว่าเครื่องไหนทำเงิน */}
        <button onClick={() => exportCsv('daily')} className="btn btn-ghost" disabled={Boolean(exporting)}>
          <Download className="w-4 h-4" />
          {exporting === 'daily' ? 'กำลังเตรียม…' : 'CSV รายวัน'}
        </button>
        <button onClick={() => exportCsv('devices')} className="btn btn-ghost" disabled={Boolean(exporting)}>
          <Download className="w-4 h-4" />
          {exporting === 'devices' ? 'กำลังเตรียม…' : 'CSV รายเครื่อง'}
        </button>
        <a
          href={`${ADMIN_API_BASE}/reports?token=${encodeURIComponent(adminToken)}&from=${from}&to=${to}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-quiet ml-auto text-[13px]"
        >
          <ExternalLink className="w-[14px] h-[14px]" />
          เวอร์ชันสำหรับพิมพ์
        </a>
      </div>

      {err && (
        <p className="text-[14px] px-4 py-3 rounded" style={{ color: 'var(--down)', background: 'var(--down-wash)' }}>
          {err}
        </p>
      )}

      {!data && loading && (
        <p className="text-[14px]" style={{ color: 'var(--ink-soft)' }}>
          กำลังโหลดรายงาน…
        </p>
      )}

      {data && s && (
        // ผังเดียวกับหน้าตั้งค่า: เมนูหัวข้ออยู่ซ้าย เนื้อหาอยู่ขวา
        // เดิมทุกส่วนต่อกันเป็นหน้ายาวหน้าเดียว ต้องเลื่อนผ่านกราฟและตารางกว่าจะถึงสิ่งที่อยากดู
        <div className="grid gap-7 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-9">
          <nav
            className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible lg:sticky lg:top-4 lg:self-start"
            style={{ scrollbarWidth: "none" }}
            aria-label="หัวข้อรายงาน"
          >
            {REPORT_PANES.map(({ key, label, icon: Icon }) => {
              const on = pane === key;
              return (
                <button
                  key={key}
                  onClick={() => setPane(key)}
                  aria-current={on ? "page" : undefined}
                  className="flex items-center gap-2.5 shrink-0 rounded px-3 py-2.5 text-[14px] text-left transition-colors"
                  style={{
                    background: on ? "var(--jade-wash)" : "transparent",
                    color: on ? "var(--jade)" : "var(--ink-soft)",
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <Icon className="w-[16px] h-[16px] shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex flex-col gap-8">
            {pane === "summary" && (
              <>
        {/* ---- ตัวเลขนำ: กำไรคือคำตอบของหน้านี้ ---- */}
        <section className="flex flex-col gap-2">
          <span className="label">กำไรแพลตฟอร์มในช่วงที่เลือก</span>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="figure text-[15px]" style={{ color: 'var(--ink-faint)' }}>฿</span>
            <span
              className="figure font-semibold leading-none"
              style={{
                fontSize: 'clamp(2.4rem, 6vw, 3.6rem)',
                color: Number(s.total_profit) >= 0 ? 'var(--ink)' : 'var(--down)',
              }}
            >
              {baht(s.total_profit)}
            </span>
            <span className="chip chip-mute ml-1">อัตรากำไร {margin.toFixed(1)}%</span>
          </div>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-soft)' }}>
            จาก {Number(s.tx_count).toLocaleString('th-TH')} รายการ · {data.range.from} ถึง {data.range.to}
          </p>
        </section>

        {/* ---- ที่มาของกำไร: อ่านเป็นลำดับการหักจากบนลงล่าง ---- */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
          <Stat label="ยอดรับชำระรวม" value={baht(s.total_amount)} />
          <Stat label="ค่าธรรมเนียมที่เก็บ" value={baht(s.total_fee)} tone="up" />
          <Stat label="ต้นทุน Stripe" value={`−${baht(s.total_stripe_fee)}`} tone="down" />
          <Stat label="จ่ายคืนร้านค้า" value={baht(s.total_net)} />
        </section>
        {/* ---- เครื่องที่ทำผลงานสุดขั้ว ---- */}
        {(data.top_device || data.bottom_device) && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.top_device && <Extreme title="ทำยอดสูงสุด" d={data.top_device} tone="up" />}
            {data.bottom_device && data.bottom_device.id !== data.top_device?.id && (
              <Extreme title="ทำยอดต่ำสุด" d={data.bottom_device} tone="down" />
            )}
          </section>
        )}
              </>
            )}

            {pane === "trend" && (
              <>
        {/* ---- แนวโน้มรายวัน ---- */}
        <TrendChart daily={data.daily} dark={dark} />
              </>
            )}

            {pane === "area" && (
              <>
        {/* ---- อันดับตามพื้นที่ ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <RankedBars
            title="แยกตามภาค"
            rows={data.regions.map((r) => ({ label: r.region_zone || 'ไม่ระบุ', ...r }))}
            dark={dark}
          />
          <RankedBars
            title="แยกตามจังหวัด"
            rows={data.provinces.map((r) => ({ label: r.province || 'ไม่ระบุ', ...r }))}
            dark={dark}
          />
        </div>
              </>
            )}

            {pane === "devices" && (
              <>
        {/* ---- ตารางรายเครื่อง ---- */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-semibold tracking-[-.01em]">รายละเอียดรายเครื่อง</h2>
            <span className="label">{data.devices.length} เครื่อง</span>
          </div>
          <div className="sheet overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tbl" style={{ minWidth: '54rem' }}>
                <thead>
                  <tr>
                    <th>เครื่อง</th>
                    <th>เจ้าของ</th>
                    <th>พื้นที่</th>
                    <th className="r">รายการ</th>
                    <th className="r">ยอดรับชำระ</th>
                    <th className="r">ค่าธรรมเนียม</th>
                    <th className="r">ต้นทุน Stripe</th>
                    <th className="r">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((d) => {
                    const p = Number(d.total_profit);
                    return (
                      <tr key={d.id}>
                        <td className="font-medium">{d.shop_name || d.name}</td>
                        <td style={{ color: 'var(--ink-soft)' }}>{d.customer_name}</td>
                        <td style={{ color: 'var(--ink-soft)' }}>
                          {[d.province, d.region_zone].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="r figure">{Number(d.tx_count).toLocaleString('th-TH')}</td>
                        <td className="r figure">{baht(d.total_amount)}</td>
                        <td className="r figure">{baht(d.total_fee)}</td>
                        <td className="r figure" style={{ color: 'var(--ink-soft)' }}>
                          {baht(d.total_stripe_fee)}
                        </td>
                        <td
                          className="r figure font-semibold"
                          style={{ color: p > 0 ? 'var(--up)' : p < 0 ? 'var(--down)' : 'var(--ink-soft)' }}
                        >
                          {baht(p)}
                        </td>
                      </tr>
                    );
                  })}
                  {data.devices.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-14" style={{ color: 'var(--ink-faint)' }}>
                        ไม่มีข้อมูลในช่วงที่เลือก
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------------- ชิ้นส่วน ---------------- */

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--ink)';
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5" style={{ background: 'var(--paper)' }}>
      <span className="label">{label}</span>
      <span className="figure text-[21px] font-semibold leading-tight" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function Extreme({ title, d, tone }: { title: string; d: DeviceRow; tone: 'up' | 'down' }) {
  return (
    <div className="sheet p-5 flex flex-col gap-3">
      <span className="label">{title}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{d.shop_name || d.name}</span>
        <span className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          {d.customer_name}
          {d.province ? ` · ${d.province}` : ''}
        </span>
      </div>
      <div className="flex items-baseline gap-6 pt-1">
        <div className="flex flex-col">
          <span className="label" style={{ fontSize: '10px' }}>
            ยอดรับชำระ
          </span>
          <span className="figure text-[16px] font-semibold">{baht(d.total_amount)}</span>
        </div>
        <div className="flex flex-col">
          <span className="label" style={{ fontSize: '10px' }}>
            กำไร
          </span>
          <span
            className="figure text-[16px] font-semibold"
            style={{ color: tone === 'up' ? 'var(--up)' : 'var(--down)' }}
          >
            {baht(d.total_profit)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="label" style={{ fontSize: '10px' }}>
            รายการ
          </span>
          <span className="figure text-[16px]">{Number(d.tx_count).toLocaleString('th-TH')}</span>
        </div>
      </div>
    </div>
  );
}

/* ---- กราฟเส้น 2 ชุด + crosshair tooltip ---- */
function TrendChart({ daily, dark }: { daily: DailyRow[]; dark: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const cAmount = dark ? SERIES.amount.dark : SERIES.amount.light;
  const cProfit = dark ? SERIES.profit.dark : SERIES.profit.light;

  if (daily.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">แนวโน้มรายวัน</h2>
        <div className="sheet px-5 py-16 text-center">
          <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            ไม่มีรายการในช่วงที่เลือก
          </p>
        </div>
      </section>
    );
  }

  const W = 900;
  const H = 260;
  const P = { t: 16, r: 16, b: 30, l: 54 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;

  const maxVal = Math.max(
    ...daily.map((d) => Math.max(Number(d.total_amount), Number(d.total_profit))),
    1
  );
  const x = (i: number) => (daily.length === 1 ? P.l + iw / 2 : P.l + (i / (daily.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (Number(v) / maxVal) * ih;

  const path = (key: 'total_amount' | 'total_profit') =>
    daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(d[key])).toFixed(1)}`).join(' ');

  const ticks = [0, 0.5, 1].map((f) => ({ v: maxVal * f, yy: P.t + ih - f * ih }));
  const hoveredDay = hover !== null ? daily[hover] : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">แนวโน้มรายวัน</h2>
        {/* legend — มี 2 ชุดจึงต้องมีเสมอ ไม่ให้ระบุตัวตนด้วยสีอย่างเดียว */}
        <div className="flex items-center gap-4">
          <LegendKey color={cAmount} label={SERIES.amount.label} />
          <LegendKey color={cProfit} label={SERIES.profit.label} />
        </div>
      </div>

      <div className="sheet p-4 relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 'auto', display: 'block' }}
          role="img"
          aria-label="กราฟแนวโน้มยอดรับชำระและกำไรรายวัน"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const idx = Math.round(((px - P.l) / iw) * (daily.length - 1));
            setHover(Math.max(0, Math.min(daily.length - 1, idx)));
          }}
        >
          {/* เส้นกริดจางๆ ถอยไปอยู่ข้างหลัง */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={P.l} x2={W - P.r} y1={t.yy} y2={t.yy} stroke="var(--line)" strokeWidth={1} />
              <text
                x={P.l - 8}
                y={t.yy + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-faint)"
                fontFamily="var(--mono)"
              >
                {shortBaht(t.v)}
              </text>
            </g>
          ))}

          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
          )}

          <path d={path('total_amount')} fill="none" stroke={cAmount} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path('total_profit')} fill="none" stroke={cProfit} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* จุดเน้นเฉพาะตอน hover — ไม่ใส่ marker ทุกจุดให้รก */}
          {hover !== null && (
            <>
              <circle cx={x(hover)} cy={y(Number(daily[hover].total_amount))} r={4.5} fill={cAmount} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(Number(daily[hover].total_profit))} r={4.5} fill={cProfit} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}

          {/* แกนวันที่ — โชว์แค่หัว/ท้าย/กลาง กันตัวหนังสือชนกัน */}
          {[0, Math.floor((daily.length - 1) / 2), daily.length - 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--ink-faint)"
                fontFamily="var(--mono)"
              >
                {dayLabel(daily[i].day)}
              </text>
            ))}
        </svg>

        {hoveredDay && (
          <div
            className="absolute top-3 right-3 rounded px-3 py-2 pointer-events-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--lift)' }}
          >
            <div className="figure text-[12px] mb-1" style={{ color: 'var(--ink-faint)' }}>
              {String(hoveredDay.day).slice(0, 10)}
            </div>
            <TipRow color={cAmount} label={SERIES.amount.label} value={baht(hoveredDay.total_amount)} />
            <TipRow color={cProfit} label={SERIES.profit.label} value={baht(hoveredDay.total_profit)} />
            <div className="figure text-[12px] mt-1" style={{ color: 'var(--ink-faint)' }}>
              {Number(hoveredDay.tx_count).toLocaleString('th-TH')} รายการ
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
      <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: color }} />
      {label}
    </span>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="inline-block rounded-full shrink-0" style={{ width: 8, height: 8, background: color }} />
      <span style={{ color: 'var(--ink-soft)' }}>{label}</span>
      <span className="figure ml-auto pl-3 font-medium">{value}</span>
    </div>
  );
}

/* ---- แท่งเรียงอันดับ: วัด "ขนาด" ของมิติเดียว จึงใช้สีเดียว ไม่ใช่หลายสี ---- */
function RankedBars({
  title,
  rows,
  dark,
}: {
  title: string;
  rows: (GroupRow & { label: string })[];
  dark: boolean;
}) {
  const color = dark ? SERIES.amount.dark : SERIES.amount.light;
  const max = Math.max(...rows.map((r) => Number(r.total_amount)), 1);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[17px] font-semibold tracking-[-.01em]">{title}</h2>
      <div className="sheet p-5">
        {rows.length === 0 ? (
          <p className="text-[14px] py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
            ไม่มีข้อมูล
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {rows.map((r) => {
              const pct = (Number(r.total_amount) / max) * 100;
              return (
                <div key={r.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-medium truncate">{r.label}</span>
                    <span className="figure text-[13px] shrink-0">{baht(r.total_amount)}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-[7px] rounded-sm overflow-hidden" style={{ background: 'var(--sunk)' }}>
                      <div
                        style={{
                          width: `${Math.max(pct, 1.5)}%`,
                          height: '100%',
                          background: color,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span className="figure text-[11.5px] shrink-0" style={{ color: 'var(--ink-faint)', minWidth: '5.5rem', textAlign: 'right' }}>
                      กำไร {baht(r.total_profit)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
