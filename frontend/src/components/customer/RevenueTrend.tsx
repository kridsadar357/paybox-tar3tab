import React, { useState } from 'react';
import type { CustomerDailyPoint } from '../../types';
import { DUO, pick, useIsDark } from '../../lib/chart';

const baht = (n: number) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

/**
 * แนวโน้มยอดขายรายวัน — สองเส้นหน่วยเดียวกัน (บาท) จึงใช้แกนเดียวได้อย่างถูกต้อง
 * ไม่ใช้แกนคู่เด็ดขาด เพราะสองสเกลบนกราฟเดียวทำให้เปรียบเทียบผิด
 *
 * สีมาจากจานที่ผ่าน validator แล้ว (lib/chart.ts) และมีทั้ง legend และ direct label
 * ที่ปลายเส้น เพื่อไม่ให้ตัวตนของเส้นขึ้นกับสีอย่างเดียว
 */
export const RevenueTrend: React.FC<{ daily: CustomerDailyPoint[] }> = ({ daily }) => {
  const dark = useIsDark();
  const [hover, setHover] = useState<number | null>(null);

  const cGross = pick(DUO.a, dark);
  const cNet = pick(DUO.b, dark);

  const W = 720;
  const H = 240;
  const P = { t: 16, r: 16, b: 28, l: 52 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;

  if (daily.length === 0) {
    return (
      <div className="sheet px-5 py-14 text-center">
        <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
          ยังไม่มียอดขายในช่วงที่เลือก
        </p>
      </div>
    );
  }

  const maxVal = Math.max(...daily.map((d) => Math.max(d.amount, d.net)), 1);
  // ปัดเพดานขึ้นให้เป็นเลขกลมเพื่อให้เส้นกริดอ่านง่าย
  const step = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const top = Math.ceil(maxVal / step) * step;

  const x = (i: number) => P.l + (daily.length === 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / top) * ih;

  const path = (key: 'amount' | 'net') =>
    daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const hovered = hover !== null ? daily[hover] : null;
  // ย้ายกล่องไปฝั่งตรงข้ามเมื่อชี้ครึ่งขวา กันล้นขอบ (คำนวณไว้ก่อนเพื่อให้ TS แคบชนิดของ hover ได้)
  const tipOnLeft = hover !== null && hover > daily.length / 2;

  // แสดงป้ายแกนเวลาไม่เกิน 6 จุด กันตัวหนังสือทับกันตอนช่วงยาว
  const labelEvery = Math.max(1, Math.ceil(daily.length / 6));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-5 flex-wrap">
        <LegendItem color={cGross} label="ยอดรับชำระ" />
        <LegendItem color={cNet} label="ยอดสุทธิ" />
      </div>

      <div className="sheet relative overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block', height: 'auto' }}
          role="img"
          aria-label="กราฟแนวโน้มยอดขายรายวัน"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((px - P.l) / iw) * (daily.length - 1));
            setHover(Math.max(0, Math.min(daily.length - 1, i)));
          }}
        >
          {/* เส้นกริดแนวนอน — จางกว่าเส้นข้อมูลเสมอ */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={P.l} x2={P.l + iw} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text
                x={P.l - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-faint)"
                fontFamily="var(--font-mono, monospace)"
              >
                {compact(t)}
              </text>
            </g>
          ))}

          {/* ป้ายแกนเวลา */}
          {daily.map((d, i) =>
            i % labelEvery === 0 || i === daily.length - 1 ? (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-faint)">
                {dayLabel(d.day)}
              </text>
            ) : null
          )}

          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
          )}

          <path d={path('amount')} fill="none" stroke={cGross} strokeWidth={2} strokeLinejoin="round" />
          <path d={path('net')} fill="none" stroke={cNet} strokeWidth={2} strokeLinejoin="round" />

          {/* จุดเน้นเฉพาะตอน hover — ไม่ใส่ marker ทุกจุดให้รก */}
          {hover !== null && (
            <>
              <circle cx={x(hover)} cy={y(daily[hover].amount)} r={4.5} fill={cGross} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(daily[hover].net)} r={4.5} fill={cNet} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}
        </svg>

        {hovered && (
          <div
            className="absolute pointer-events-none px-3 py-2.5 rounded flex flex-col gap-1.5"
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--line-strong)',
              top: 12,
              left: tipOnLeft ? 12 : undefined,
              right: tipOnLeft ? undefined : 12,
              minWidth: '11rem',
            }}
          >
            <span className="text-[12.5px] font-semibold">{dayLabel(hovered.day)}</span>
            <TipRow color={cGross} label="ยอดรับชำระ" value={baht(hovered.amount)} />
            <TipRow color={cNet} label="ยอดสุทธิ" value={baht(hovered.net)} />
            <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              {hovered.tx_count} รายการ
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
      <span style={{ width: 14, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-4 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-soft)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
        {label}
      </span>
      <span className="figure font-semibold">฿{value}</span>
    </span>
  );
}
