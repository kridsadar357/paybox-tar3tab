import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { customerApi } from '../../api/customerApi';
import type {
  CustomerDevice,
  CustomerTransaction,
  CustomerSettlement,
  CustomerFeeInfo,
  CustomerSummary,
} from '../../types';
import { ExternalLink, Image as ImageIcon, AlertTriangle, Clock, Download, RotateCcw } from 'lucide-react';
import { BannerManager } from './BannerManager';
import { AccountSettings } from './AccountSettings';
import { RevenueTrend } from './RevenueTrend';
import { deviceContact, formatDateTime, relativeTime, txStatusChip, settlementStatusChip } from '../../lib/format';

/** วันนี้ตามเวลาไทย — เซิร์ฟเวอร์เก็บเป็น UTC ถ้าใช้ toISOString ตรงๆ ช่วงเช้ามืดจะได้วันที่ผิด */
function thaiToday(offsetDays = 0): string {
  return new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}

const PERIODS: { key: string; label: string; days: number }[] = [
  { key: '7d', label: '7 วัน', days: 6 },
  { key: '30d', label: '30 วัน', days: 29 },
  { key: '90d', label: '90 วัน', days: 89 },
];

interface Props {
  activeTab: string;
}

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CustomerDashboard: React.FC<Props> = ({ activeTab }) => {
  const { customerToken } = useAuth();
  const [feeInfo, setFeeInfo] = useState<CustomerFeeInfo | null>(null);
  const [devices, setDevices] = useState<CustomerDevice[]>([]);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [settlements, setSettlements] = useState<CustomerSettlement[]>([]);
  const [bannerDevice, setBannerDevice] = useState<CustomerDevice | null>(null);

  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [period, setPeriod] = useState('30d');

  const [lastTxId, setLastTxId] = useState<number | undefined>(undefined);
  const [hasMoreTx, setHasMoreTx] = useState(true);

  // ตัวกรองรายการชำระเงิน — backend รองรับมาตลอด แต่หน้าเว็บเดิมไม่เคยส่งมาให้
  const [fDevice, setFDevice] = useState(0);
  const [fStatus, setFStatus] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const range = (() => {
    const p = PERIODS.find((x) => x.key === period) || PERIODS[1];
    return { from: thaiToday(-p.days), to: thaiToday() };
  })();

  const loadData = async () => {
    try {
      const [devRes, setRes] = await Promise.all([
        customerApi.getDevices(customerToken),
        customerApi.getSettlements(customerToken),
      ]);

      if (devRes.success) {
        setDevices(devRes.devices || []);
        if (devRes.fee_info) setFeeInfo(devRes.fee_info);
      }
      if (setRes.success) setSettlements(setRes.settlements || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadTx = useCallback(async () => {
    try {
      const res = await customerApi.getTransactions(customerToken, fDevice || undefined, 20, undefined, {
        status: fStatus || undefined,
        from: fFrom || undefined,
        to: fTo || undefined,
      });
      if (res.success && res.transactions) {
        setTransactions(res.transactions);
        setLastTxId(res.transactions[res.transactions.length - 1]?.id);
        setHasMoreTx(Boolean(res.has_more));
      }
    } catch (err: any) {
      console.error(err);
    }
  }, [customerToken, fDevice, fStatus, fFrom, fTo]);

  useEffect(() => {
    loadData();
  }, [customerToken]);

  useEffect(() => {
    loadTx();
  }, [loadTx]);

  useEffect(() => {
    customerApi
      .getSummary(customerToken, range.from, range.to)
      .then((res) => {
        if (res.success) setSummary(res);
      })
      .catch(() => {
        /* ปล่อยให้หน้ายังใช้ได้ ไม่ขึ้น error ทั้งหน้าเพราะกราฟโหลดไม่ได้ */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerToken, period]);

  const loadMoreTx = async () => {
    if (!lastTxId) return;
    try {
      const res = await customerApi.getTransactions(customerToken, fDevice || undefined, 20, lastTxId, {
        status: fStatus || undefined,
        from: fFrom || undefined,
        to: fTo || undefined,
      });
      if (res.success && res.transactions && res.transactions.length > 0) {
        setTransactions((prev) => [...prev, ...res.transactions!]);
        setLastTxId(res.transactions[res.transactions.length - 1].id);
        setHasMoreTx(Boolean(res.has_more));
      } else {
        setHasMoreTx(false);
      }
    } catch {
      setHasMoreTx(false);
    }
  };

  // สั่งรีสตาร์ตเครื่องของตัวเอง — เครื่องค้างมักเกิดนอกเวลาทำการของผู้ดูแลระบบ
  const [restarting, setRestarting] = useState<number | null>(null);
  const [restartNote, setRestartNote] = useState('');

  const restartDevice = async (d: CustomerDevice) => {
    if (!window.confirm(`สั่งรีสตาร์ต "${d.shop_name || d.name}" ใช่หรือไม่?

เครื่องจะรับคำสั่งภายใน 1 นาที และถ้ากำลังมีลูกค้าจ่ายเงินอยู่ เครื่องจะรอให้จบก่อน`)) {
      return;
    }
    setRestarting(d.id);
    setRestartNote('');
    try {
      const res = await customerApi.restartDevice(customerToken, d.id);
      setRestartNote(
        res.success
          ? res.already_queued
            ? `"${d.shop_name || d.name}" มีคำสั่งรีสตาร์ตค้างอยู่แล้ว`
            : `ส่งคำสั่งรีสตาร์ต "${d.shop_name || d.name}" แล้ว เครื่องจะรับภายใน 1 นาที`
          : 'สั่งรีสตาร์ตไม่สำเร็จ'
      );
    } catch {
      setRestartNote('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setRestarting(null);
    }
  };

  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  const runExport = async (fn: () => Promise<void>) => {
    setExporting(true);
    setExportErr('');
    try {
      await fn();
    } catch (err: any) {
      setExportErr(err.message || 'ดาวน์โหลดไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  const exportTx = () =>
    runExport(() =>
      customerApi.exportTransactions(customerToken, fDevice || undefined, {
        status: fStatus || undefined,
        from: fFrom || undefined,
        to: fTo || undefined,
      })
    );

  const exportSettlements = () => runExport(() => customerApi.exportSettlements(customerToken));

  const clearFilters = () => {
    setFDevice(0);
    setFStatus('');
    setFFrom('');
    setFTo('');
  };
  const filterActive = Boolean(fDevice || fStatus || fFrom || fTo);

  // is_active คือสวิตช์เปิด/ปิดที่แอดมินตั้ง ไม่ใช่การเชื่อมต่อ — นับและเรียกให้ตรงกับความหมายจริง
  const enabled = devices.filter((d) => d.is_active === 1).length;

  return (
    <div>
      {/* ======================= ภาพรวม ======================= */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-8">
          {/* พระเอกคือ "เงินที่รอรับโอน" — ตัวเลขที่เจ้าของร้านอยากรู้ที่สุดเวลาเปิดหน้านี้
              ไม่ใช่ยอดสะสมตลอดกาลซึ่งเปลี่ยนไม่ได้และทำอะไรกับมันไม่ได้ */}
          {/* บนจอกว้างยอดรอรับโอนกับตัวเลขสรุปอยู่แถวเดียวกัน ใช้ความกว้างที่มีแทนที่จะไล่ลงแนวตั้ง */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:items-center gap-8 xl:gap-10">
            <section className="flex flex-col gap-2 pt-2">
            <span className="label">ยอดรอรับโอน</span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="figure text-[15px]" style={{ color: 'var(--ink-faint)' }}>฿</span>
              <span
                className="figure font-semibold leading-none"
                style={{ fontSize: 'clamp(2.6rem, 7vw, 3.9rem)', color: 'var(--wait)' }}
              >
                {baht(summary?.pending_payout.net ?? 0)}
              </span>
              {feeInfo && (
                <span className="chip chip-mute ml-1">
                  {feeInfo.fee_tier === 'flat'
                    ? `เหมาจ่าย ฿${feeInfo.flat_fee_amount}/งวด`
                    : `ค่าธรรมเนียม ${feeInfo.fee_percent}%`}
                </span>
              )}
            </div>
            <p className="text-[13.5px] mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--ink-soft)' }}>
              <span>
                จาก {summary?.pending_payout.tx_count ?? 0} รายการที่ยังไม่ได้ปิดรอบ
              </span>
              {summary?.pending_payout.oldest_tx && (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--ink-faint)' }}>
                  <Clock className="w-[13px] h-[13px]" />
                  เก่าสุด {relativeTime(summary.pending_payout.oldest_tx)}
                </span>
              )}
            </p>
          </section>

          {/* วันนี้ + ยอดสะสม — สองมุมมองที่ต่างกันคนละแบบ จึงแยกแถวกัน */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
            <Figure label="ยอดขายวันนี้" value={baht(summary?.today.amount ?? 0)} sub={`${summary?.today.tx_count ?? 0} รายการ`} />
            <Figure label="สุทธิวันนี้" value={baht(summary?.today.net ?? 0)} tone="up" />
            <Figure label="รับชำระสะสม" value={baht(summary?.all_time.amount ?? 0)} />
            <Figure label="สุทธิสะสม" value={baht(summary?.all_time.net ?? 0)} tone="up" />
            </section>
          </div>

          {/* แนวโน้ม */}
          <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <h2 className="text-[17px] font-semibold tracking-[-.01em]">แนวโน้มยอดขาย</h2>
                <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
                  รายวันตามเวลาไทย · เลื่อนเมาส์บนกราฟเพื่อดูตัวเลขแต่ละวัน
                </p>
              </div>
              <div className="flex gap-1">
                {PERIODS.map((p) => {
                  const on = period === p.key;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setPeriod(p.key)}
                      className="px-3 py-1.5 rounded text-[13px] transition-colors"
                      style={{
                        background: on ? 'var(--jade-wash)' : 'transparent',
                        color: on ? 'var(--jade)' : 'var(--ink-faint)',
                        fontWeight: on ? 600 : 500,
                        border: '1px solid ' + (on ? 'transparent' : 'var(--line)'),
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <RevenueTrend daily={summary?.daily ?? []} />

            <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--line)' }}>
              <Figure label="รับชำระในช่วงนี้" value={baht(summary?.period.amount ?? 0)} sub={`${summary?.period.tx_count ?? 0} รายการ`} />
              <Figure label="ค่าธรรมเนียม" value={`−${baht(summary?.period.fee ?? 0)}`} tone="down" />
              <Figure label="สุทธิในช่วงนี้" value={baht(summary?.period.net ?? 0)} tone="up" />
            </div>
          </section>

          {/* รายการอุปกรณ์ — เป็นรายการมีเส้นคั่น ไม่ใช่กริดการ์ด */}
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] font-semibold tracking-[-.01em]">อุปกรณ์ของฉัน</h2>
              <span className="label">
                {devices.length} เครื่อง · เปิดใช้งาน {enabled} · ตัวเลขเป็นยอดสะสม
              </span>
            </div>

            {restartNote && (
              <p
                className="text-[13.5px] px-3.5 py-2.5 rounded"
                style={{ color: 'var(--up)', background: 'var(--up-wash)' }}
                role="status"
              >
                {restartNote}
              </p>
            )}

            <div className="sheet overflow-hidden">
              {devices.map((d, i) => (
                <div
                  key={d.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-[15px] truncate">{d.shop_name || d.name}</span>
                      <span className={d.is_active === 1 ? 'chip chip-up' : 'chip chip-mute'}>
                        {d.is_active === 1 ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {d.shop_name && d.shop_name !== d.name && (
                        <span className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                          {d.name}
                        </span>
                      )}
                      <span className="text-[12.5px]" style={{ color: deviceContact(d.last_seen_at, d.firmware_version).color }}>
                        {deviceContact(d.last_seen_at, d.firmware_version).text}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-7 sm:gap-9">
                    <MiniFigure label="รับชำระ" value={baht(d.total_amount)} />
                    <MiniFigure label="ค่าธรรมเนียม" value={`−${baht(d.total_fee)}`} tone="down" />
                    <MiniFigure label="สุทธิ" value={baht(d.total_net)} tone="up" strong />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setBannerDevice(d)}
                      className="btn btn-ghost text-[13px]"
                      style={{ padding: '7px 12px' }}
                    >
                      <ImageIcon className="w-[14px] h-[14px]" />
                      Banner
                    </button>
                    <button
                      onClick={() => restartDevice(d)}
                      disabled={restarting === d.id}
                      className="btn btn-ghost text-[13px]"
                      style={{ padding: '7px 12px' }}
                      title="ใช้เมื่อจอค้างหรือเครื่องไม่ตอบสนอง"
                    >
                      <RotateCcw className="w-[14px] h-[14px]" />
                      {restarting === d.id ? 'กำลังสั่ง…' : 'รีสตาร์ต'}
                    </button>
                  </div>
                </div>
              ))}

              {devices.length === 0 && (
                <div className="px-5 py-14 text-center">
                  <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
                    ยังไม่มีอุปกรณ์ในความดูแลของคุณ
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ======================= รายการชำระเงิน ======================= */}
      {activeTab === 'transactions' && (
        <div className="flex flex-col gap-5 pt-2">
          <SectionHead
            title="รายการชำระเงิน"
            note={filterActive ? `${transactions.length} รายการที่ตรงเงื่อนไข` : `${transactions.length} รายการล่าสุด`}
          />

          {/* ตัวกรองอยู่แถวเดียวเหนือตาราง — เครื่อง / สถานะ / ช่วงวันที่ */}
          <div className="sheet px-4 py-3.5 flex flex-wrap items-end gap-x-4 gap-y-3">
            <FilterField label="เครื่อง">
              <select className="field" value={fDevice} onChange={(e) => setFDevice(Number(e.target.value))}>
                <option value={0}>ทุกเครื่อง</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.shop_name || d.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="สถานะ">
              <select className="field" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">ทุกสถานะ</option>
                <option value="succeeded">สำเร็จ</option>
                <option value="pending">รอดำเนินการ</option>
                <option value="requires_action">ยังไม่ได้ชำระ</option>
                <option value="failed">ไม่สำเร็จ</option>
                <option value="canceled">ยกเลิก</option>
              </select>
            </FilterField>

            <FilterField label="ตั้งแต่วันที่">
              <input type="date" className="field figure" value={fFrom} max={fTo || undefined} onChange={(e) => setFFrom(e.target.value)} />
            </FilterField>

            <FilterField label="ถึงวันที่">
              <input type="date" className="field figure" value={fTo} min={fFrom || undefined} onChange={(e) => setFTo(e.target.value)} />
            </FilterField>

            {filterActive && (
              <button onClick={clearFilters} className="btn btn-ghost" style={{ padding: '9px 14px' }}>
                ล้างตัวกรอง
              </button>
            )}

            {/* ดาวน์โหลดตามตัวกรองปัจจุบัน และได้ครบทุกแถว ไม่ใช่แค่หน้าที่โหลดไว้ */}
            <button
              onClick={exportTx}
              disabled={exporting}
              className="btn btn-ghost ml-auto"
              style={{ padding: '9px 14px' }}
            >
              <Download className="w-4 h-4" />
              {exporting ? 'กำลังเตรียม…' : 'ดาวน์โหลด CSV'}
            </button>
          </div>

          {exportErr && (
            <p
              className="text-[13.5px] px-3.5 py-2.5 rounded"
              style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
              role="alert"
            >
              {exportErr}
            </p>
          )}

          <div className="sheet overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tbl" style={{ minWidth: '46rem' }}>
                <thead>
                  <tr>
                    <th>วันที่ / เวลา</th>
                    <th>เครื่อง</th>
                    <th className="r">ยอดชำระ</th>
                    <th className="r">ค่าธรรมเนียม</th>
                    <th className="r">สุทธิ</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="figure text-[13px]" style={{ color: 'var(--ink-soft)' }}>
                        {formatDateTime(tx.created_at)}
                      </td>
                      <td className="font-medium">{tx.device_name}</td>
                      <td className="r figure">{baht(tx.amount)}</td>
                      <td className="r figure" style={{ color: 'var(--down)' }}>
                        −{baht(tx.fee_amount)}
                      </td>
                      <td className="r figure font-semibold">{baht(tx.net_amount)}</td>
                      <td>
                        {/* สถานะจริงจาก Stripe — เดิมฮาร์ดโค้ดเป็นเขียว "สำเร็จ" ทุกแถว
                            ทำให้รายการที่ยังไม่ได้ชำระดูเหมือนชำระแล้ว */}
                        <span className={txStatusChip(tx.status).chip}>{txStatusChip(tx.status).label}</span>
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-14" style={{ color: 'var(--ink-faint)' }}>
                        {filterActive ? 'ไม่มีรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีรายการ'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {hasMoreTx && transactions.length > 0 && (
            <button onClick={loadMoreTx} className="btn btn-ghost self-center">
              โหลดรายการเพิ่ม
            </button>
          )}
        </div>
      )}

      {/* ======================= รอบโอนเงิน ======================= */}
      {activeTab === 'settlements' && (
        <div className="flex flex-col gap-5 pt-2">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <SectionHead title="รอบโอนเงิน" note={`${settlements.length} รอบ`} />
            <button onClick={exportSettlements} disabled={exporting} className="btn btn-ghost">
              <Download className="w-4 h-4" />
              {exporting ? 'กำลังเตรียม…' : 'ดาวน์โหลด CSV'}
            </button>
          </div>

          <div className="sheet overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tbl" style={{ minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th>รอบ</th>
                    <th>วันที่สร้าง</th>
                    <th className="r">รายการ</th>
                    <th className="r">ยอดรวม</th>
                    <th className="r">ค่าธรรมเนียม</th>
                    <th className="r">รับโอนสุทธิ</th>
                    <th>สถานะ</th>
                    <th>หลักฐาน</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <React.Fragment key={s.id}>
                    <tr>
                      <td className="figure" style={{ color: 'var(--ink-faint)' }}>
                        #{s.id}
                      </td>
                      <td className="figure text-[13px]" style={{ color: 'var(--ink-soft)' }}>
                        {formatDateTime(s.created_at)}
                      </td>
                      <td className="r figure">{s.tx_count}</td>
                      <td className="r figure">{baht(s.total_amount)}</td>
                      <td className="r figure" style={{ color: 'var(--ink-soft)' }}>
                        {baht(s.total_fee)}
                      </td>
                      <td className="r figure font-semibold">{baht(s.total_net)}</td>
                      <td>
                        {/* ต้องรู้จัก 'problem' ด้วย — เดิมสถานะที่ไม่ใช่ settled ถูกตีเป็น "รอโอน" ทั้งหมด
                            ลูกค้าจึงไม่รู้ว่าการโอนล้มเหลวและตัวเองต้องไปแก้อะไร */}
                        <span className={settlementStatusChip(s.status).chip}>
                          {settlementStatusChip(s.status).label}
                        </span>
                      </td>
                      <td>
                        {s.proof_url ? (
                          <a
                            href={s.proof_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[13px] font-medium"
                            style={{ color: 'var(--jade)' }}
                          >
                            ดูสลิป
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink-faint)' }}>—</span>
                        )}
                      </td>
                    </tr>

                    {/* เหตุผลที่โอนไม่สำเร็จ — วางเป็นแถวเต็มความกว้างใต้รอบนั้น เพราะข้อความยาวเกิน
                        กว่าจะยัดลงช่องสถานะ และเป็นข้อมูลที่ลูกค้าต้องอ่านจริงเพื่อไปแก้ไข */}
                    {s.status === 'problem' && s.note && (
                      <tr>
                        <td colSpan={8} style={{ paddingTop: 0 }}>
                          <div
                            className="flex items-start gap-2.5 px-3.5 py-3 rounded"
                            style={{ background: 'var(--down-wash)', color: 'var(--down)' }}
                          >
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                            <div className="flex flex-col gap-1 min-w-0">
                              <span className="text-[13px] font-semibold">โอนเงินรอบนี้ไม่สำเร็จ</span>
                              <span className="text-[13px] leading-relaxed">{s.note}</span>
                              <span className="text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
                                ตรวจสอบบัญชีรับเงินในหน้าตั้งค่า หรือติดต่อผู้ดูแลระบบเพื่อโอนใหม่
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                  {settlements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-14" style={{ color: 'var(--ink-faint)' }}>
                        ยังไม่มีรอบโอนเงิน
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* ======================= ตั้งค่าผู้ใช้งาน ======================= */}
      {activeTab === 'settings' && <AccountSettings />}

      {bannerDevice && (
        <BannerManager
          customerToken={customerToken}
          deviceId={bannerDevice.id}
          deviceName={bannerDevice.shop_name || bannerDevice.name}
          onClose={() => setBannerDevice(null)}
        />
      )}
    </div>
  );
};

/* ---------- ชิ้นส่วนย่อย ---------- */

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5" style={{ minWidth: '9.5rem' }}>
      <span className="label" style={{ fontSize: '10px' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-[17px] font-semibold tracking-[-.01em]">{title}</h2>
      {note && <span className="label shrink-0">{note}</span>}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  sub?: string;
}) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--ink)';
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5" style={{ background: 'var(--paper)' }}>
      <span className="label">{label}</span>
      <span className="figure text-[22px] font-semibold leading-tight" style={{ color }}>
        {value}
      </span>
      {sub && (
        <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function MiniFigure({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  strong?: boolean;
}) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--ink)';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label" style={{ fontSize: '10px' }}>
        {label}
      </span>
      <span
        className="figure text-[14.5px] leading-tight"
        style={{ color, fontWeight: strong ? 600 : 400 }}
      >
        {value}
      </span>
    </div>
  );
}
