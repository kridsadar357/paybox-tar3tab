// ชิ้นส่วน UI ที่หน้าแอดมินใช้ร่วมกัน — modal และแถบแจ้งผล
//
// แถบแจ้งผลมาแทน alert() ที่กระจายอยู่ 14 จุด: alert() บล็อกทั้งหน้า ขึ้นเป็นกล่องของเบราว์เซอร์
// ที่ไม่เข้ากับดีไซน์ และผู้ใช้ปิดทิ้งโดยไม่อ่าน — ข้อความที่อยู่ในหน้าเลยสื่อสารได้ดีกว่า
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export type NoticeState = { ok: boolean; text: string } | null;

export function Notice({ notice, onDismiss }: { notice: NoticeState; onDismiss?: () => void }) {
  if (!notice) return null;
  return (
    <div
      className="flex items-start justify-between gap-3 px-3.5 py-2.5 rounded"
      style={{
        color: notice.ok ? 'var(--up)' : 'var(--down)',
        background: notice.ok ? 'var(--up-wash)' : 'var(--down-wash)',
      }}
      role="status"
    >
      <span className="text-[13.5px] leading-relaxed">{notice.text}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 mt-px" aria-label="ปิดข้อความ">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** ปิดได้ด้วย Esc, คลิกพื้นหลัง หรือปุ่มกากบาท — ทั้งสามทางที่ผู้ใช้คาดหวังจากกล่องแบบนี้ */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = '30rem',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="sheet w-full my-auto"
        style={{ maxWidth: width, background: 'var(--paper)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-4 px-5 py-4"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <h3 className="text-[16px] font-semibold tracking-[-.01em]">{title}</h3>
            {subtitle && (
              <p className="text-[13px] truncate" style={{ color: 'var(--ink-faint)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn btn-quiet shrink-0" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
