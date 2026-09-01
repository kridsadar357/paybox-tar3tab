import React, { useState, useEffect, useMemo } from 'react';
import { adminApi } from '../../api/adminApi';
import { useAuth } from '../../context/AuthContext';
import type { Device } from '../../types';
import type { Customer } from '../../types';
import { deviceContact, relativeTime, compareVersions } from '../../lib/format';
import { Modal, Notice, type NoticeState } from './ui';
import { DeviceSettingsModal } from './DeviceSettingsModal';
import { Plus, Power, Search, Settings2, Copy, Check, RefreshCw, Clock, AlertTriangle, RotateCcw } from 'lucide-react';

export const DeviceManager: React.FC = () => {
  const { adminToken } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [latestFw, setLatestFw] = useState<string | null>(null);
  const [quietMinutes, setQuietMinutes] = useState(5);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [settingsDevice, setSettingsDevice] = useState<Device | null>(null);
  const [copiedKey, setCopiedKey] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const fetchData = async () => {
    try {
      const [devRes, custRes] = await Promise.all([
        adminApi.getDevices(adminToken),
        adminApi.getCustomers(adminToken),
      ]);
      if (devRes.success) {
        setDevices(devRes.devices || []);
        setLatestFw(devRes.latest_firmware);
        if (devRes.quiet_period_minutes) setQuietMinutes(devRes.quiet_period_minutes);
      }
      if (custRes.success) setCustomers(custRes.customers || []);
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'โหลดข้อมูลอุปกรณ์ไม่สำเร็จ' });
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // คำสั่งอัปเดตถูกปล่อยตอน heartbeat (ทุก 5 นาที) — รีเฟรชเองเป็นระยะเพื่อให้เห็นสถานะขยับ
  useEffect(() => {
    const hasPending = devices.some((d) => d.command_status);
    if (!hasPending) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  const toggleActive = async (d: Device) => {
    try {
      await adminApi.toggleDevice(adminToken, d.id);
      fetchData();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เปลี่ยนสถานะเครื่องไม่สำเร็จ' });
    }
  };

  const assignCustomer = async (deviceId: number, customerId: number) => {
    try {
      await adminApi.assignDevice(adminToken, deviceId, customerId);
      fetchData();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'มอบหมายเจ้าของไม่สำเร็จ' });
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.shop_name || '').toLowerCase().includes(q) ||
        d.device_key.toLowerCase().includes(q) ||
        (d.customer_name || '').toLowerCase().includes(q)
    );
  }, [devices, query]);

  const selectedDevices = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);
  const allShownSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((d) => next.delete(d.id));
      else filtered.forEach((d) => next.add(d.id));
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runQueueUpdate = async () => {
    setBusy(true);
    try {
      const res: any = await adminApi.queueForceUpdate(adminToken, [...selected]);
      if (res.success) {
        const q = res.queued || [];
        const s = res.skipped || [];
        const waiting = q.filter((x: any) => !x.quiet).length;
        let text = `เข้าคิวแล้ว ${q.length} เครื่อง`;
        if (waiting > 0) text += ` · ${waiting} เครื่องกำลังมีรายการ จะรอจนนิ่งก่อน`;
        if (s.length > 0) text += ` · ข้าม ${s.length} เครื่อง (มีคำสั่งค้างอยู่แล้ว)`;
        setNotice({ ok: true, text });
        setSelected(new Set());
      } else {
        setNotice({ ok: false, text: 'สั่งอัปเดตไม่สำเร็จ' });
      }
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy(false);
      setConfirmUpdate(false);
      fetchData();
    }
  };

  const restartDevices = async (ids: number[]) => {
    setBusy(true);
    try {
      const res: any = await adminApi.restartDevices(adminToken, ids);
      if (res.success) {
        const q = res.queued || [];
        const withSession = q.filter((x: any) => x.had_open_session).length;
        let text = `ส่งคำสั่งรีสตาร์ต ${q.length} เครื่อง · เครื่องจะรับคำสั่งภายใน 1 นาที`;
        if (withSession > 0) text += ` · ${withSession} เครื่องมีรายการค้างอยู่ ตัวเครื่องจะรอให้จบก่อน`;
        setNotice({ ok: true, text });
        setSelected(new Set());
      } else {
        setNotice({ ok: false, text: 'สั่งรีสตาร์ตไม่สำเร็จ' });
      }
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy(false);
      setConfirmRestart(false);
      fetchData();
    }
  };

  const cancelUpdate = async (ids: number[]) => {
    try {
      const res: any = await adminApi.cancelForceUpdate(adminToken, ids);
      setNotice(
        res.success
          ? { ok: true, text: `ยกเลิกคำสั่งแล้ว ${res.cancelled ?? 0} รายการ` }
          : { ok: false, text: 'ยกเลิกไม่สำเร็จ' }
      );
      setSelected(new Set());
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      fetchData();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold tracking-[-.01em]">อุปกรณ์</h2>
          <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            กล่อง PayBox ทั้งหมด · เลือกหลายเครื่องเพื่อสั่งอัปเดตเฟิร์มแวร์พร้อมกัน
            {latestFw && ` · เวอร์ชันล่าสุด ${latestFw}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-faint)' }}
            />
            <input
              className="field"
              style={{ paddingLeft: '2.2rem', width: '14rem' }}
              placeholder="ค้นหาชื่อ / เจ้าของ / key"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button onClick={fetchData} className="btn btn-ghost" title="โหลดใหม่">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary shrink-0">
            <Plus className="w-4 h-4" />
            เพิ่มอุปกรณ์
          </button>
        </div>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {/* แถบคำสั่งกลุ่ม — โผล่เฉพาะตอนเลือกเครื่องไว้ ไม่กินที่ตอนไม่ได้ใช้ */}
      {selected.size > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded"
          style={{ background: 'var(--jade-wash)', border: '1px solid var(--line)' }}
        >
          <span className="text-[13.5px] font-medium" style={{ color: 'var(--jade)' }}>
            เลือกไว้ {selected.size} เครื่อง
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost" style={{ padding: '7px 12px' }}>
              ล้างการเลือก
            </button>
            {selectedDevices.some((d) => d.command_status) && (
              <button
                onClick={() => cancelUpdate(selectedDevices.filter((d) => d.command_status).map((d) => d.id))}
                className="btn btn-danger"
                style={{ padding: '7px 12px' }}
              >
                ยกเลิกคำสั่งที่ค้าง
              </button>
            )}
            <button
              onClick={() => setConfirmRestart(true)}
              disabled={busy}
              className="btn btn-ghost"
              style={{ padding: '7px 12px' }}
            >
              <RotateCcw className="w-4 h-4" />
              รีสตาร์ต
            </button>
            <button
              onClick={() => setConfirmUpdate(true)}
              disabled={busy}
              className="btn btn-primary"
              style={{ padding: '7px 14px' }}
            >
              สั่งอัปเดตเฟิร์มแวร์
            </button>
          </div>
        </div>
      )}

      {/* ---- ตาราง ---- */}
      <div className="sheet overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl" style={{ minWidth: '64rem' }}>
            <thead>
              <tr>
                <th style={{ width: '2.5rem' }}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAll}
                    aria-label="เลือกทั้งหมด"
                    style={{ width: 15, height: 15, accentColor: 'var(--jade)', cursor: 'pointer' }}
                  />
                </th>
                <th>อุปกรณ์</th>
                <th>สถานะ</th>
                <th>เฟิร์มแวร์</th>
                <th>เจ้าของ</th>
                <th>Device key</th>
                <th className="r">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const contact = deviceContact(d.last_seen_at, d.firmware_version);
                const outdated =
                  latestFw && d.firmware_version && compareVersions(latestFw, d.firmware_version) > 0;
                const on = selected.has(d.id);
                return (
                  <tr key={d.id} style={on ? { background: 'var(--jade-wash)' } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleOne(d.id)}
                        aria-label={`เลือก ${d.shop_name || d.name}`}
                        style={{ width: 15, height: 15, accentColor: 'var(--jade)', cursor: 'pointer' }}
                      />
                    </td>

                    <td>
                      <div className="font-semibold text-[14px]">{d.shop_name || d.name}</div>
                      {d.shop_name && d.shop_name !== d.name && (
                        <div className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                          {d.name}
                        </div>
                      )}
                    </td>

                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        <span className={d.is_active === 1 ? 'chip chip-up' : 'chip chip-mute'}>
                          {d.is_active === 1 ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                        <span className="text-[12px]" style={{ color: contact.color }}>
                          {contact.label}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        <span className="figure text-[13px]">{d.firmware_version || '—'}</span>
                        {outdated && !d.command_status && <span className="chip chip-wait">มีอัปเดต</span>}
                        {d.command_status && <CommandBadge device={d} quietMinutes={quietMinutes} />}
                      </div>
                    </td>

                    <td>
                      <select
                        className="field"
                        style={{ padding: '5px 8px', fontSize: '12.5px', minWidth: '10rem' }}
                        value={d.customer_id || 0}
                        onChange={(e) => assignCustomer(d.id, Number(e.target.value))}
                      >
                        <option value={0}>— ไม่มีเจ้าของ —</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(d.device_key);
                          setCopiedKey(d.id);
                          setTimeout(() => setCopiedKey(null), 1800);
                        }}
                        className="inline-flex items-center gap-1.5 figure text-[12px]"
                        style={{ color: 'var(--ink-soft)' }}
                        title="คัดลอก device key"
                      >
                        <span className="truncate" style={{ maxWidth: '7.5rem' }}>
                          {d.device_key}
                        </span>
                        {copiedKey === d.id ? (
                          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--up)' }} />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    </td>

                    <td className="r">
                      <div className="inline-flex items-center gap-3 text-[13px] font-medium">
                        <button
                          onClick={() => setSettingsDevice(d)}
                          className="inline-flex items-center gap-1"
                          style={{ color: 'var(--jade)' }}
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                          ตั้งค่า
                        </button>
                        <button
                          onClick={() => toggleActive(d)}
                          className="inline-flex items-center gap-1"
                          style={{ color: d.is_active === 1 ? 'var(--down)' : 'var(--up)' }}
                        >
                          <Power className="w-3.5 h-3.5" />
                          {d.is_active === 1 ? 'ปิด' : 'เปิด'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-14" style={{ color: 'var(--ink-faint)' }}>
                    {query ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น' : 'ยังไม่มีอุปกรณ์ในระบบ'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmRestart && (
        <Modal
          title="สั่งรีสตาร์ตเครื่อง"
          subtitle={`${selectedDevices.length} เครื่อง`}
          onClose={() => setConfirmRestart(false)}
        >
          <div className="flex flex-col gap-5">
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              คำสั่งนี้<strong style={{ color: 'var(--ink)' }}>ไม่รอให้เครื่องว่าง</strong> ต่างจากการอัปเดตเฟิร์มแวร์
              เพราะเหตุผลหลักที่ต้องสั่งรีสตาร์ตคือเครื่องค้าง ซึ่งเป็นตอนที่การรอไม่มีวันจบ
            </p>
            <div
              className="flex items-start gap-2.5 px-3.5 py-3 rounded"
              style={{ background: 'var(--wait-wash)', color: 'var(--wait)' }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span className="text-[13px] leading-relaxed">
                ตัวเครื่องยังกันอีกชั้น — ถ้ากำลังมีลูกค้าจ่ายเงินอยู่จริง จะรอให้จบก่อน (สูงสุด 2 นาที
                เท่าอายุ QR) แล้วค่อยรีบูต · เครื่องจะรับคำสั่งภายใน 1 นาที
              </span>
            </div>
            <ul className="sheet overflow-hidden">
              {selectedDevices.map((d, i) => (
                <li
                  key={d.id}
                  className="px-4 py-2.5 text-[13.5px]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                >
                  {d.shop_name || d.name}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmRestart(false)} className="btn btn-ghost">
                ยกเลิก
              </button>
              <button
                onClick={() => restartDevices([...selected])}
                disabled={busy}
                className="btn btn-danger"
              >
                {busy ? 'กำลังสั่ง…' : `รีสตาร์ต ${selectedDevices.length} เครื่อง`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmUpdate && (
        <ConfirmUpdateModal
          devices={selectedDevices}
          quietMinutes={quietMinutes}
          latestFw={latestFw}
          busy={busy}
          onClose={() => setConfirmUpdate(false)}
          onConfirm={runQueueUpdate}
        />
      )}

      {showAdd && (
        <AddDeviceModal
          token={adminToken}
          onClose={() => setShowAdd(false)}
          onDone={(text) => {
            setShowAdd(false);
            setNotice({ ok: true, text });
            fetchData();
          }}
        />
      )}

      {settingsDevice && (
        <DeviceSettingsModal
          adminToken={adminToken}
          deviceId={settingsDevice.id}
          deviceName={settingsDevice.shop_name || settingsDevice.name}
          onClose={() => {
            setSettingsDevice(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
};

/** ป้ายบอกว่าคำสั่งอัปเดตอยู่ขั้นไหน — สถานะรอเป็นเรื่องปกติ ไม่ใช่ความผิดพลาด จึงใช้สีเหลืองไม่ใช่แดง */
function CommandBadge({ device, quietMinutes }: { device: Device; quietMinutes: number }) {
  if (device.command_status === 'dispatched') {
    return (
      <span className="chip chip-up" title="ส่งคำสั่งให้เครื่องแล้ว รอเครื่องดาวน์โหลดและรีสตาร์ต">
        <RefreshCw className="w-3 h-3" />
        กำลังอัปเดต
      </span>
    );
  }
  return (
    <span
      className="chip chip-wait"
      title={device.command_hold_reason || `รอเครื่องไม่มีรายการครบ ${quietMinutes} นาที`}
    >
      <Clock className="w-3 h-3" />
      รอคิว
    </span>
  );
}

/** ยืนยันก่อนสั่ง — บอกให้ชัดว่าเครื่องไหนจะไปทันที เครื่องไหนต้องรอ และเพราะอะไร */
function ConfirmUpdateModal({
  devices,
  quietMinutes,
  latestFw,
  busy,
  onClose,
  onConfirm,
}: {
  devices: Device[];
  quietMinutes: number;
  latestFw: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const now = Date.now();
  const rows = devices.map((d) => {
    const last = d.last_tx_activity ? new Date(d.last_tx_activity).getTime() : null;
    const idleSec = last ? Math.floor((now - last) / 1000) : null;
    const quiet = idleSec === null || idleSec >= quietMinutes * 60;
    const upToDate = latestFw && d.firmware_version === latestFw;
    return { d, quiet, idleSec, upToDate };
  });
  const waiting = rows.filter((r) => !r.quiet).length;

  return (
    <Modal title="สั่งอัปเดตเฟิร์มแวร์" subtitle={`${devices.length} เครื่อง`} onClose={onClose} width="34rem">
      <div className="flex flex-col gap-5">
        <div
          className="flex items-start gap-2.5 px-3.5 py-3 rounded"
          style={{ background: 'var(--wait-wash)', color: 'var(--wait)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span className="text-[13px] leading-relaxed">
            การอัปเดตจบด้วยการรีสตาร์ตเครื่อง ระบบจะไม่ปล่อยคำสั่งจนกว่าเครื่องนั้นจะไม่มีรายการเคลื่อนไหว
            ครบ {quietMinutes} นาที ถ้ามีลูกค้าเข้ามาระหว่างรอ เวลาจะเริ่มนับใหม่เอง
          </span>
        </div>

        <div className="sheet overflow-hidden">
          {rows.map(({ d, quiet, upToDate }, i) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium truncate">{d.shop_name || d.name}</div>
                <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                  {d.firmware_version || 'ไม่ทราบเวอร์ชัน'}
                  {upToDate && ' · เป็นเวอร์ชันล่าสุดอยู่แล้ว'}
                </div>
              </div>
              {quiet ? (
                <span className="chip chip-up shrink-0">พร้อมอัปเดต</span>
              ) : (
                <span className="chip chip-wait shrink-0" title={`มีรายการเมื่อ ${relativeTime(d.last_tx_activity)}`}>
                  รอ · เพิ่งมีรายการ
                </span>
              )}
            </div>
          ))}
        </div>

        {waiting > 0 && (
          <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            {waiting} เครื่องกำลังมีรายการอยู่ — คำสั่งจะถูกเก็บไว้ในคิวและปล่อยเองเมื่อเครื่องนิ่ง ไม่ต้องมากดซ้ำ
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button onClick={onConfirm} disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังสั่ง…' : `เข้าคิวอัปเดต ${devices.length} เครื่อง`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddDeviceModal({
  token,
  onClose,
  onDone,
}: {
  token: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issuedKey, setIssuedKey] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await adminApi.addDevice(token, name.trim());
      if (res.success && res.device_key) setIssuedKey(res.device_key);
      else setErr('เพิ่มอุปกรณ์ไม่สำเร็จ');
    } catch (e: any) {
      setErr(e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  if (issuedKey) {
    return (
      <Modal title="เพิ่มอุปกรณ์แล้ว" subtitle={name} onClose={() => onDone(`เพิ่มอุปกรณ์ "${name}" แล้ว`)}>
        <div className="flex flex-col gap-3">
          <span className="label">Device key สำหรับตั้งค่าที่ตัวเครื่อง</span>
          <div className="flex items-center gap-2">
            <code
              className="figure text-[14px] px-3 py-2.5 rounded flex-1 break-all"
              style={{ background: 'var(--sunk)', border: '1px solid var(--line)' }}
            >
              {issuedKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(issuedKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="btn btn-ghost shrink-0"
              style={{ padding: '9px 11px' }}
            >
              {copied ? <Check className="w-4 h-4" style={{ color: 'var(--up)' }} /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            คีย์นี้ดูซ้ำได้ในตารางอุปกรณ์ ไม่ต้องรีบจด
          </p>
          <button onClick={() => onDone(`เพิ่มอุปกรณ์ "${name}" แล้ว`)} className="btn btn-primary self-start">
            เสร็จสิ้น
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="เพิ่มอุปกรณ์ PayBox" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="label">ชื่ออุปกรณ์</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น สาขาลาดพร้าว"
            required
            autoFocus
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

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            ยกเลิก
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'กำลังสร้าง…' : 'สร้างอุปกรณ์'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
