import React, { useState, useEffect, useCallback } from 'react';
import { customerApi } from '../../api/customerApi';
import { X, Image as ImageIcon, Film, Upload, Trash2, ChevronDown, Check, Save } from 'lucide-react';

interface Props {
  customerToken: string;
  deviceId: number;
  deviceName: string;
  onClose: () => void;
}

type BannerSlot = { slot: number; url: string | null; type: string; fps: number; version: number };

const SLOTS = [1, 2, 3, 4, 5];

// จัดการ banner (สไลด์ตอนเครื่อง idle) ของเครื่องที่ลูกค้าเป็นเจ้าของ — คนละส่วนกับ theme (หน้าจอ
// payment ตอนใช้งาน) เด็ดขาด — banner คือสไลด์โชว์ตอนไม่มีการทำรายการครบเวลาที่ตั้งไว้
export const BannerManager: React.FC<Props> = ({ customerToken, deviceId, deviceName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [idleSec, setIdleSec] = useState('20');
  const [idleSaving, setIdleSaving] = useState(false);
  const [idleSaved, setIdleSaved] = useState(false);
  const [slots, setSlots] = useState<BannerSlot[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const res = await customerApi.getBanner(customerToken, deviceId);
    if (res.success) {
      setIdleSec(String(res.banner_idle_sec ?? 20));
      setSlots(res.slots || []);
    }
  }, [customerToken, deviceId]);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  const handleSaveIdle = async () => {
    setIdleSaving(true);
    setIdleSaved(false);
    try {
      await customerApi.setBannerIdle(customerToken, deviceId, parseInt(idleSec, 10) || 20);
      setIdleSaved(true);
      setTimeout(() => setIdleSaved(false), 2500);
    } finally {
      setIdleSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay)' }}
    >
      <div
        className="w-full max-w-2xl max-h-[86vh] flex flex-col overflow-hidden rounded"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--lift)' }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 py-5 shrink-0"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold tracking-[-.01em]">Banner หน้าจอ</h3>
            <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--ink-soft)' }}>
              {deviceName} · แสดงเมื่อเครื่องไม่มีการทำรายการ
            </p>
          </div>
          <button onClick={onClose} className="btn btn-quiet shrink-0" aria-label="ปิด">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {loading ? (
          <p className="text-[14px] p-6" style={{ color: 'var(--ink-soft)' }}>
            กำลังโหลด…
          </p>
        ) : (
          <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5">
            {/* Idle timing */}
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 rounded"
              style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
            >
              <div className="flex flex-col">
                <span className="text-[14px] font-medium">เวลาก่อนแสดง Banner</span>
                <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                  นับจากครั้งสุดท้ายที่มีคนแตะหน้าจอ
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={5}
                    value={idleSec}
                    onChange={(e) => setIdleSec(e.target.value)}
                    className="field figure w-[76px] text-right"
                    style={{ padding: '7px 10px' }}
                  />
                  <span className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    วินาที
                  </span>
                </div>
                <button
                  onClick={handleSaveIdle}
                  disabled={idleSaving}
                  className="btn btn-primary text-[13px]"
                  style={{ padding: '7px 13px' }}
                >
                  {idleSaved ? <Check className="w-[14px] h-[14px]" /> : <Save className="w-[14px] h-[14px]" />}
                  {idleSaving ? 'กำลังบันทึก…' : idleSaved ? 'บันทึกแล้ว' : 'บันทึก'}
                </button>
              </div>
            </div>

            {/* Slots accordion */}
            <div className="flex flex-col gap-2">
              {SLOTS.map((slot) => {
                const data = slots.find((s) => s.slot === slot) || { slot, url: null, type: 'image', fps: 4, version: 1 };
                return (
                  <BannerSlotRow
                    key={slot}
                    data={data}
                    expanded={expandedSlot === slot}
                    onToggle={() => setExpandedSlot(expandedSlot === slot ? null : slot)}
                    customerToken={customerToken}
                    deviceId={deviceId}
                    onChanged={reload}
                  />
                );
              })}
            </div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
              รูปภาพรองรับ jpg / png / webp สูงสุด 5MB ระบบย่อขนาดให้พอดีจอเอง · วิดีโอใส่ไฟล์ต้นฉบับ
              mp4 / mov / webm ได้เลย ระบบแปลงให้อัตโนมัติ ความยาวไม่เกิน 20 วินาที
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

function BannerSlotRow({
  data,
  expanded,
  onToggle,
  customerToken,
  deviceId,
  onChanged,
}: {
  data: BannerSlot;
  expanded: boolean;
  onToggle: () => void;
  customerToken: string;
  deviceId: number;
  onChanged: () => void;
}) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFps, setVideoFps] = useState(String(data.fps || 4));
  const [imageBusy, setImageBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const busy = imageBusy || videoBusy || clearBusy;

  const { slot, url, type, fps } = data;
  const isVideo = type === 'video';
  const hasContent = !!url;

  const handleUploadImage = async () => {
    if (!imageFile) return;
    setImageBusy(true);
    setMsg('');
    try {
      const res = await customerApi.uploadBannerImage(customerToken, deviceId, slot, imageFile);
      if (res.success) {
        setImageFile(null);
        onChanged();
      } else {
        setMsg(res.error === 'invalid_image' ? 'ไฟล์รูปภาพไม่ถูกต้อง' : 'อัปโหลดไม่สำเร็จ');
      }
    } catch {
      setMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setImageBusy(false);
    }
  };

  const handleUploadVideo = async () => {
    if (!videoFile) return;
    setVideoBusy(true);
    setMsg('');
    try {
      const res = await customerApi.uploadBannerVideo(customerToken, deviceId, slot, videoFile, parseInt(videoFps, 10) || 4);
      if (res.success) {
        setVideoFile(null);
        onChanged();
      } else {
        setMsg(res.message || 'แปลง/อัปโหลดวิดีโอไม่สำเร็จ');
      }
    } catch {
      setMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setVideoBusy(false);
    }
  };

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setClearBusy(true);
    try {
      await customerApi.clearBannerSlot(customerToken, deviceId, slot);
      onChanged();
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded" style={{ border: '1px solid var(--line)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ background: expanded ? 'var(--sunk)' : 'transparent' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium">สไลด์ {slot}</span>
          {!hasContent ? (
            <span className="chip chip-mute">ว่าง</span>
          ) : isVideo ? (
            <span className="chip chip-up">
              <Film className="w-3 h-3" />
              วิดีโอ · {fps} FPS
            </span>
          ) : (
            <span className="chip chip-up">
              <ImageIcon className="w-3 h-3" />
              รูปภาพ
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasContent && (
            <span
              onClick={handleClear}
              className="p-1.5 rounded transition-colors cursor-pointer"
              style={{ color: 'var(--ink-faint)' }}
              title="ลบสไลด์นี้"
            >
              <Trash2 className="w-[15px] h-[15px]" />
            </span>
          )}
          <ChevronDown
            className="w-4 h-4 transition-transform"
            style={{ color: 'var(--ink-faint)', transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-4 flex flex-col gap-4" style={{ borderTop: '1px solid var(--line)' }}>
          {hasContent && !isVideo && (
            <img
              src={url!}
              alt={`สไลด์ ${slot}`}
              className="w-full max-h-40 object-contain rounded"
              style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
            />
          )}

          <div className="flex flex-col gap-2">
            <label className="label">รูปภาพ · jpg / png / webp</label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                disabled={busy}
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="field flex-1 text-[13px]"
                style={{ padding: '6px 9px' }}
              />
              <button
                type="button"
                onClick={handleUploadImage}
                disabled={!imageFile || busy}
                className="btn btn-ghost text-[13px] shrink-0"
                style={{ padding: '7px 12px' }}
              >
                <Upload className="w-[14px] h-[14px]" />
                {imageBusy ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="label">วิดีโอ · mp4 / mov / webm — ระบบแปลงให้อัตโนมัติ</label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="video/*"
                disabled={busy}
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="field flex-1 text-[13px]"
                style={{ padding: '6px 9px' }}
              />
              <input
                type="number"
                min={2}
                max={6}
                value={videoFps}
                disabled={busy}
                onChange={(e) => setVideoFps(e.target.value)}
                className="field figure w-[58px] text-center shrink-0"
                style={{ padding: '6px 6px' }}
                title="ความเร็วเล่น (FPS) — แนะนำ 3-4 ตามความเร็ว SD การ์ดของบอร์ด"
              />
              <button
                type="button"
                onClick={handleUploadVideo}
                disabled={!videoFile || busy}
                className="btn btn-ghost text-[13px] shrink-0"
                style={{ padding: '7px 12px' }}
              >
                <Upload className="w-[14px] h-[14px]" />
                {videoBusy ? 'กำลังแปลง…' : 'อัปโหลด'}
              </button>
            </div>
            {videoBusy && (
              <p className="text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
                กำลังแปลงวิดีโอเป็นรูปแบบที่เครื่องเล่นได้ อาจใช้เวลาสักครู่
              </p>
            )}
          </div>

          {msg && (
            <p
              className="text-[13px] px-3 py-2 rounded"
              style={{ color: 'var(--down)', background: 'var(--down-wash)' }}
            >
              {msg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
