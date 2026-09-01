import React, { useState, useEffect, useCallback } from 'react';
import { DEVICE_SETTINGS_API_BASE } from '../../api/client';
import { Save } from 'lucide-react';
import { Modal } from './ui';

interface Props {
  adminToken: string;
  deviceId: number;
  deviceName: string;
  onClose: () => void;
}

// ตั้งค่าอุปกรณ์แบบละเอียด — เรียก /api/admin/device_settings/:id ตรงๆ (ไม่ผ่าน adminApi.ts เพราะ
// resource นี้แยก router ต่างหากจาก admin_api.php เดิม ใช้ path param ไม่ใช่ ?resource=)
// หมายเหตุ: banner (สไลด์ตอน idle) ย้ายไปให้ลูกค้าจัดการเองทั้งหมดที่ Customer Portal แล้ว ไม่มีในนี้
export const DeviceSettingsModal: React.FC<Props> = ({ adminToken, deviceId, deviceName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const settingsUrl = DEVICE_SETTINGS_API_BASE;

  const reload = useCallback(() => {
    return fetch(`${settingsUrl}/${deviceId}`, { headers: { Authorization: `Bearer ${adminToken}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const d = data.device;
          setForm({
            shop_name: d.shop_name || '',
            entry_method: d.entry_method || 'keypad',
            preset_amounts: d.preset_amounts || '5,10,20,50,100,500,1000',
            fixed_amount: d.fixed_amount != null ? String(Number(d.fixed_amount)) : '',
            op_mode: { 1: 'pulse', 2: 'thankyou', 3: 'payment' }[d.op_mode as number] || 'payment',
            pulse_pin: String(d.pulse_pin ?? 14),
            pulse_baht_inc: String(d.pulse_baht_inc ?? 0),
            ty_api: d.ty_api || '',
            ty_msg: d.ty_msg || 'Thank You!',
            pay_inc: String(d.pay_inc ?? 10),
            pay_ty_msg: d.pay_ty_msg || 'Payment Received!',
            region_zone: d.region_zone || '',
            province: d.province || '',
            district: d.district || '',
            subdistrict: d.subdistrict || '',
            lat: d.lat != null ? String(d.lat) : '',
            lng: d.lng != null ? String(d.lng) : '',
          });
        } else {
          setError('โหลดข้อมูลไม่สำเร็จ');
        }
      })
      .catch(() => setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
  }, [deviceId, adminToken, settingsUrl]);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const body = new URLSearchParams(form);
      const res = await fetch(`${settingsUrl}/${deviceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${adminToken}`,
        },
        body: body.toString(),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
      } else {
        setError('บันทึกไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="ตั้งค่าอุปกรณ์" subtitle={deviceName} onClose={onClose} width="34rem">
      <div>
        {loading ? (
          <p className="text-[14px]" style={{ color: 'var(--ink-soft)' }}>
            กำลังโหลด…
          </p>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-5">
            <Field label="ชื่อร้าน (แสดงบนหัวจอ)" value={form.shop_name} onChange={(v) => set('shop_name', v)} />

            <div className="flex flex-col gap-2">
              <label className="label">วิธีรับยอดชำระ</label>
              <select
                value={form.entry_method}
                onChange={(e) => set('entry_method', e.target.value)}
                className="field"
              >
                <option value="keypad">แป้นตัวเลข — ร้านค้าทั่วไป พิมพ์ยอดเอง</option>
                <option value="button">ปุ่มจำนวนเงิน — coin acceptor เลือกจากที่ตั้งไว้</option>
                <option value="fixed">จำนวนเงินคงที่ — ยอดเดียวตายตัวต่อการสแกน</option>
              </select>
            </div>

            {/* แสดงเฉพาะช่องที่โหมดนั้นใช้จริง — ไม่ให้ผู้ตั้งค่าต้องเดาว่าช่องไหนมีผลกับโหมดไหน */}
            {form.entry_method === 'button' && (
              <Field
                label="จำนวนเงินสำหรับปุ่ม (คั่นด้วย ,)"
                value={form.preset_amounts}
                onChange={(v) => set('preset_amounts', v)}
              />
            )}

            {form.entry_method === 'fixed' && (
              <div className="flex flex-col gap-2">
                <label className="label">ยอดคงที่ต่อการสแกน 1 รอบ (บาท)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.fixed_amount ?? ''}
                  onChange={(e) => set('fixed_amount', e.target.value)}
                  className="field figure"
                  placeholder="เช่น 100"
                />
                <span className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                  หน้าจอเครื่องจะแสดงยอดนี้ยอดเดียว กดปุ่มเดียวแล้วขึ้น QR ทันที ลูกค้าเลือกยอดอื่นไม่ได้
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="label">หลังชำระเงินสำเร็จ</label>
              <select
                value={form.op_mode}
                onChange={(e) => set('op_mode', e.target.value)}
                className="field"
              >
                <option value="payment">แสดงข้อความขอบคุณ</option>
                <option value="pulse">ส่งสัญญาณ Pulse ออก GPIO</option>
                <option value="thankyou">เรียก API ภายนอก + ข้อความ</option>
              </select>
            </div>

            {form.op_mode === 'pulse' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="GPIO Pin" value={form.pulse_pin} onChange={(v) => set('pulse_pin', v)} type="number" />
                <Field
                  label="บาทต่อพัลส์ (0=ครั้งเดียว)"
                  value={form.pulse_baht_inc}
                  onChange={(v) => set('pulse_baht_inc', v)}
                  type="number"
                />
              </div>
            )}
            {form.op_mode === 'thankyou' && (
              <>
                <Field label="API URL ({MAC} = MAC address)" value={form.ty_api} onChange={(v) => set('ty_api', v)} />
                <Field label="ข้อความขอบคุณ" value={form.ty_msg} onChange={(v) => set('ty_msg', v)} />
              </>
            )}
            {form.op_mode === 'payment' && (
              <>
                <Field label="ปุ่มเพิ่ม/ลด (Keypad)" value={form.pay_inc} onChange={(v) => set('pay_inc', v)} type="number" />
                <Field label="ข้อความขอบคุณ" value={form.pay_ty_msg} onChange={(v) => set('pay_ty_msg', v)} />
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="ภาค" value={form.region_zone} onChange={(v) => set('region_zone', v)} />
              <Field label="จังหวัด" value={form.province} onChange={(v) => set('province', v)} />
              <Field label="อำเภอ" value={form.district} onChange={(v) => set('district', v)} />
              <Field label="ตำบล" value={form.subdistrict} onChange={(v) => set('subdistrict', v)} />
              <Field label="Lat" value={form.lat} onChange={(v) => set('lat', v)} />
              <Field label="Lng" value={form.lng} onChange={(v) => set('lng', v)} />
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
            {saved && (
              <p
                className="text-[13.5px] px-3.5 py-2.5 rounded"
                style={{ color: 'var(--up)', background: 'var(--up-wash)' }}
                role="status"
              >
                บันทึกแล้ว — มีผลตอนบอร์ด reboot ครั้งถัดไป
              </p>
            )}

            <div className="rule pt-5 flex justify-end gap-3">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                ปิด
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="label">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </div>
  );
}
