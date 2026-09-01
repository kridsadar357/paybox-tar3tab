import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import { useAuth } from '../../context/AuthContext';
import { FILES_BASE } from '../../api/client';
import type {
  PendingSettlement,
  PendingDeviceRow,
  SettlementHistory,
  HistoryDeviceRow,
} from '../../types';
import { RefreshCw, ExternalLink, AlertTriangle, ChevronDown, Copy, Check, X, Download } from 'lucide-react';
import { Notice, type NoticeState } from './ui';

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Filter = 'pending' | 'settled' | 'problem';

export const SettlementManager: React.FC = () => {
  const { adminToken } = useAuth();
  const [pending, setPending] = useState<PendingSettlement[]>([]);
  const [pendingDevices, setPendingDevices] = useState<PendingDeviceRow[]>([]);
  const [history, setHistory] = useState<SettlementHistory[]>([]);
  const [historyDevices, setHistoryDevices] = useState<HistoryDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');

  const [settling, setSettling] = useState<SettlementHistory | null>(null);
  const [problemFor, setProblemFor] = useState<SettlementHistory | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getSettlements(adminToken);
      if (res.success) {
        setPending(res.pending || []);
        setPendingDevices(res.pending_devices || []);
        setHistory(res.history || []);
        setHistoryDevices(res.history_devices || []);
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    load();
  }, [load]);

  const createSettlement = async (customerId: number) => {
    const res = await adminApi.createSettlement(adminToken, customerId);
    if (res.success) {
      setNotice({ ok: true, text: 'ปิดยอดเป็นรอบโอนแล้ว — ดูในรายการด้านล่าง' });
      load();
    } else {
      setNotice({
        ok: false,
        text: res.error === 'nothing_to_settle' ? 'ไม่มีรายการใหม่ที่ค้างชำระ' : 'ปิดยอดไม่สำเร็จ',
      });
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminApi.exportSettlements(adminToken);
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'ดาวน์โหลดไม่สำเร็จ' });
    } finally {
      setExporting(false);
    }
  };

  const waitingRounds = history.filter((h) => h.status === 'pending');
  const problemRounds = history.filter((h) => h.status === 'problem');
  const settledRounds = history.filter((h) => h.status === 'settled');

  const totalUnbilled = pending.reduce((s, p) => s + Number(p.total_net), 0);
  const totalWaiting = waitingRounds.reduce((s, h) => s + Number(h.total_net), 0);
  const totalProblem = problemRounds.reduce((s, h) => s + Number(h.total_net), 0);

  const shown = filter === 'pending' ? waitingRounds : filter === 'problem' ? problemRounds : settledRounds;

  return (
    <div className="flex flex-col gap-10">
      {/* ---- ยอดที่ต้องโอนทั้งหมด เป็นตัวเลขนำ ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-2">
            <span className="label">ยอดที่ต้องโอนให้ร้านค้าทั้งหมด</span>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="figure text-[15px]" style={{ color: 'var(--ink-faint)' }}>฿</span>
              <span className="figure font-semibold leading-none" style={{ fontSize: 'clamp(2.4rem, 6vw, 3.6rem)' }}>
                {baht(totalUnbilled + totalWaiting + totalProblem)}
              </span>
            </div>
            <p className="text-[13.5px]" style={{ color: 'var(--ink-soft)' }}>
              ยังไม่ปิดยอด ฿{baht(totalUnbilled)} · ปิดยอดแล้วรอโอน ฿{baht(totalWaiting)}
              {totalProblem > 0 && ` · ติดปัญหา ฿${baht(totalProblem)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportCsv} className="btn btn-ghost" disabled={exporting}>
              <Download className="w-4 h-4" />
              {exporting ? 'กำลังเตรียม…' : 'ดาวน์โหลด CSV'}
            </button>
            <button onClick={load} className="btn btn-ghost" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              รีเฟรช
            </button>
          </div>
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />
      </section>

      {/* ---- ขั้นที่ 1: ยอดสะสมที่ยังไม่ได้ปิดรอบ ---- */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-[-.01em]">ยอดสะสมที่ยังไม่ปิดรอบ</h2>
          <span className="label">{pending.length} ราย</span>
        </div>
        <p className="text-[13.5px] -mt-2" style={{ color: 'var(--ink-soft)' }}>
          รายการที่ชำระสำเร็จแล้วแต่ยังไม่ถูกรวมเป็นรอบโอน — กด "ปิดยอด" เพื่อล็อกยอดแล้วจึงโอนเงิน
        </p>

        {pending.length === 0 ? (
          <EmptyBox text="ไม่มียอดค้างปิดรอบ" />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <PendingCard
                key={p.customer_id}
                p={p}
                devices={pendingDevices.filter((d) => d.customer_id === p.customer_id)}
                onCreate={() => createSettlement(p.customer_id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---- ขั้นที่ 2: รอบที่ปิดแล้ว แยกตามสถานะ ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">รอบการโอนเงิน</h2>

        <div className="flex gap-1 flex-wrap">
          <FilterTab active={filter === 'pending'} onClick={() => setFilter('pending')} tone="wait" count={waitingRounds.length}>
            รอโอน
          </FilterTab>
          <FilterTab active={filter === 'problem'} onClick={() => setFilter('problem')} tone="down" count={problemRounds.length}>
            พบปัญหา
          </FilterTab>
          <FilterTab active={filter === 'settled'} onClick={() => setFilter('settled')} tone="up" count={settledRounds.length}>
            โอนแล้ว
          </FilterTab>
        </div>

        {shown.length === 0 ? (
          <EmptyBox
            text={
              filter === 'pending' ? 'ไม่มีรอบที่รอโอน' : filter === 'problem' ? 'ไม่มีรอบที่ติดปัญหา' : 'ยังไม่มีรอบที่โอนแล้ว'
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((h) => (
              <RoundCard
                key={h.id}
                h={h}
                devices={historyDevices.filter((d) => d.settlement_id === h.id)}
                onSettle={() => setSettling(h)}
                onProblem={() => setProblemFor(h)}
                onClearProblem={async () => {
                  await adminApi.clearProblem(adminToken, h.id);
                  load();
                }}
              />
            ))}
          </div>
        )}
      </section>

      {settling && (
        <SettleModal
          h={settling}
          token={adminToken}
          onClose={() => setSettling(null)}
          onDone={() => {
            setSettling(null);
            load();
          }}
        />
      )}
      {problemFor && (
        <ProblemModal
          h={problemFor}
          token={adminToken}
          onClose={() => setProblemFor(null)}
          onDone={() => {
            setProblemFor(null);
            load();
          }}
        />
      )}
    </div>
  );
};

/* ---------------- ชิ้นส่วน ---------------- */

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="sheet px-5 py-12 text-center">
      <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
        {text}
      </p>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
  tone: 'wait' | 'down' | 'up';
}) {
  const c = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--wait)';
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3.5 py-2 rounded text-[13.5px] transition-colors"
      style={{
        background: active ? 'var(--sunk)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-soft)',
        fontWeight: active ? 600 : 500,
        border: `1px solid ${active ? 'var(--line-strong)' : 'transparent'}`,
      }}
    >
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: c }} />
      {children}
      <span className="figure text-[12px]" style={{ color: 'var(--ink-faint)' }}>
        {count}
      </span>
    </button>
  );
}

function PayoutLine({ p }: { p: { payout_bank: string | null; payout_account_no: string | null; payout_account_name: string | null } }) {
  const [copied, setCopied] = useState(false);
  if (!p.payout_account_no) {
    return (
      <span className="chip chip-down">
        <AlertTriangle className="w-3 h-3" />
        ยังไม่ได้ตั้งบัญชีรับเงิน
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap text-[13px]">
      <span style={{ color: 'var(--ink-soft)' }}>{p.payout_bank}</span>
      <span className="figure font-medium">{p.payout_account_no}</span>
      <span style={{ color: 'var(--ink-soft)' }}>{p.payout_account_name}</span>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(p.payout_account_no || '');
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="btn btn-quiet"
        style={{ padding: '3px 7px' }}
        title="คัดลอกเลขบัญชี"
      >
        {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--up)' }} /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function DeviceBreakdown({
  rows,
}: {
  rows: { device_id: number; device_name: string; shop_name: string | null; tx_count: number; total_net: number }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid var(--line)' }}>
      {rows.map((d) => (
        <div key={d.device_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
          <span className="truncate">{d.shop_name || d.device_name}</span>
          <div className="flex items-center gap-5 shrink-0">
            <span className="figure" style={{ color: 'var(--ink-faint)' }}>
              {d.tx_count} รายการ
            </span>
            <span className="figure font-medium" style={{ minWidth: '5.5rem', textAlign: 'right' }}>
              ฿{baht(d.total_net)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingCard({
  p,
  devices,
  onCreate,
}: {
  p: PendingSettlement;
  devices: PendingDeviceRow[];
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sheet overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-[15px]">{p.customer_name}</span>
            <span className="chip chip-mute">{p.tx_count} รายการ</span>
          </div>
          <PayoutLine p={p} />
        </div>

        <div className="flex items-center gap-6 shrink-0">
          <div className="flex flex-col">
            <span className="label" style={{ fontSize: '10px' }}>
              ยอดโอนสุทธิ
            </span>
            <span className="figure text-[19px] font-semibold" style={{ color: 'var(--up)' }}>
              ฿{baht(p.total_net)}
            </span>
          </div>
          <button onClick={onCreate} className="btn btn-primary shrink-0">
            ปิดยอด
          </button>
        </div>
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-2.5 text-[12.5px] transition-colors"
        style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-soft)' }}
      >
        <span>มาจาก {devices.length} เครื่อง</span>
        <ChevronDown className="w-4 h-4" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <DeviceBreakdown rows={devices} />}
    </div>
  );
}

function RoundCard({
  h,
  devices,
  onSettle,
  onProblem,
  onClearProblem,
}: {
  h: SettlementHistory;
  devices: HistoryDeviceRow[];
  onSettle: () => void;
  onProblem: () => void;
  onClearProblem: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chip =
    h.status === 'settled' ? 'chip chip-up' : h.status === 'problem' ? 'chip chip-down' : 'chip chip-wait';
  const chipText = h.status === 'settled' ? 'โอนแล้ว' : h.status === 'problem' ? 'พบปัญหา' : 'รอโอน';

  return (
    <div className="sheet overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="figure text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
              รอบ #{h.id}
            </span>
            <span className="font-semibold text-[15px]">{h.customer_name}</span>
            <span className={chip}>{chipText}</span>
          </div>
          <PayoutLine p={h} />
          <span className="figure text-[12px]" style={{ color: 'var(--ink-faint)' }}>
            ปิดยอด {String(h.created_at).slice(0, 16).replace('T', ' ')}
            {h.settled_at && ` · โอน ${String(h.settled_at).slice(0, 16).replace('T', ' ')}`}
          </span>
        </div>

        <div className="flex items-center gap-6 shrink-0 flex-wrap">
          <div className="flex flex-col">
            <span className="label" style={{ fontSize: '10px' }}>
              ยอดโอนสุทธิ
            </span>
            <span
              className="figure text-[19px] font-semibold"
              style={{ color: h.status === 'settled' ? 'var(--ink)' : 'var(--up)' }}
            >
              ฿{baht(h.total_net)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {h.status !== 'settled' && (
              <button onClick={onSettle} className="btn btn-primary">
                ยืนยันโอนแล้ว
              </button>
            )}
            {h.status === 'pending' && (
              <button onClick={onProblem} className="btn btn-ghost">
                แจ้งปัญหา
              </button>
            )}
            {h.status === 'problem' && (
              <button onClick={onClearProblem} className="btn btn-ghost">
                กลับเป็นรอโอน
              </button>
            )}
            {h.proof_file && (
              <a
                href={`${FILES_BASE}/settlement-proofs/${h.proof_file}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                <ExternalLink className="w-[14px] h-[14px]" />
                สลิป
              </a>
            )}
          </div>
        </div>
      </div>

      {h.status === 'problem' && h.note && (
        <div
          className="flex gap-2.5 px-5 py-3 text-[13px]"
          style={{ background: 'var(--down-wash)', color: 'var(--down)', borderTop: '1px solid var(--line)' }}
        >
          <AlertTriangle className="w-[16px] h-[16px] shrink-0 mt-px" />
          <span>{h.note}</span>
        </div>
      )}

      {h.proof_reference && h.status === 'settled' && (
        <div className="px-5 py-2.5 text-[12.5px]" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
          อ้างอิงการโอน: <span className="figure">{h.proof_reference}</span>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-2.5 text-[12.5px] transition-colors"
        style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-soft)' }}
      >
        <span>
          {h.tx_count} รายการ จาก {devices.length} เครื่อง
        </span>
        <ChevronDown className="w-4 h-4" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <DeviceBreakdown rows={devices} />}
    </div>
  );
}

function SettleModal({
  h,
  token,
  onClose,
  onDone,
}: {
  h: SettlementHistory;
  token: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [ref, setRef] = useState(h.proof_reference || '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.markSettled(token, h.id, ref, file || undefined);
      if (res.success) onDone();
      else setErr('บันทึกไม่สำเร็จ — รอบนี้อาจถูกปิดไปแล้ว ลองรีเฟรชหน้า');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`ยืนยันการโอน รอบ #${h.id}`} onClose={onClose}>
      <p className="text-[13.5px]" style={{ color: 'var(--ink-soft)' }}>
        โอนให้ <strong style={{ color: 'var(--ink)' }}>{h.customer_name}</strong> ยอด{' '}
        <span className="figure font-semibold" style={{ color: 'var(--up)' }}>
          ฿{baht(h.total_net)}
        </span>
      </p>
      <div className="px-4 py-3 rounded" style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}>
        <PayoutLine p={h} />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="label">เลขอ้างอิงการโอน</label>
          <input className="field figure" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="TRX12345678" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label">แนบสลิป (jpg / png / pdf)</label>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="field text-[13px]"
            style={{ padding: '7px 10px' }}
          />
        </div>
        {err && (
          <p
            className="text-[13.5px] px-3.5 py-2.5 rounded"
            style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
            role="alert"
          >
            {err}
          </p>
        )}

        <div className="rule pt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึกว่าโอนแล้ว'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProblemModal({
  h,
  token,
  onClose,
  onDone,
}: {
  h: SettlementHistory;
  token: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.markProblem(token, h.id, note);
      if (res.success) onDone();
      else setErr(res.error === 'note_required' ? 'กรุณาระบุสาเหตุ' : 'บันทึกไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`แจ้งปัญหา รอบ #${h.id}`} onClose={onClose}>
      <p className="text-[13.5px]" style={{ color: 'var(--ink-soft)' }}>
        รอบนี้จะถูกย้ายไปสถานะ "พบปัญหา" และยังคงนับเป็นยอดค้างโอนจนกว่าจะแก้ไขเสร็จ
      </p>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="label">สาเหตุ</label>
          <textarea
            className="field"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น เลขบัญชีไม่ถูกต้อง ธนาคารตีกลับ รอเอกสารเพิ่มเติม"
            maxLength={500}
          />
        </div>
        {err && (
          <p
            className="text-[13.5px] px-3.5 py-2.5 rounded"
            style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
            role="alert"
          >
            {err}
          </p>
        )}

        <div className="rule pt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy || !note.trim()} className="btn btn-primary">
            {busy ? 'กำลังบันทึก…' : 'บันทึกปัญหา'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // ปิดด้วย Esc ได้ตามที่ผู้ใช้คาดหวังจาก dialog ทั่วไป
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded overflow-hidden flex flex-col max-h-[88vh]"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--lift)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 py-4 shrink-0 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="text-[17px] font-semibold tracking-[-.01em]">{title}</h3>
          <button onClick={onClose} className="btn btn-quiet shrink-0" aria-label="ปิด">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
