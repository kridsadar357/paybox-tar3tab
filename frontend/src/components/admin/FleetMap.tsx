import React, { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { TopologyDevice } from '../../types';
import { deviceContact } from '../../lib/format';

const baht = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * แผนที่ตำแหน่งเครื่อง — ขนาดวงกลมสื่อถึง "ยอดเงินวันนี้" (มิติเดียว จึงใช้สีเดียว
 * ไล่ตามขนาดแทนการไล่สี) สีบอกแค่สถานะเปิด/ปิดใช้งานซึ่งเป็น state ไม่ใช่ series
 *
 * หมายเหตุ: is_active คือสวิตช์ที่แอดมินกด ไม่ใช่การเชื่อมต่อ — ความสดของเครื่องดูจาก
 * "ติดต่อล่าสุด" ใน tooltip แทน
 */
export const FleetMap: React.FC<{ devices: TopologyDevice[] }> = ({ devices }) => {
  const points = useMemo(
    () => devices.filter((d) => d.lat !== null && d.lng !== null),
    [devices]
  );

  const maxToday = useMemo(
    () => Math.max(...points.map((p) => Number(p.today_amount)), 1),
    [points]
  );

  if (points.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">ตำแหน่งเครื่อง</h2>
        <div className="sheet px-5 py-14 text-center">
          <p className="text-[14px]" style={{ color: 'var(--ink-faint)' }}>
            ยังไม่มีเครื่องที่ระบุพิกัด — ตั้งค่าละติจูด/ลองจิจูดได้ที่หน้าอุปกรณ์
          </p>
        </div>
      </section>
    );
  }

  const center: [number, number] = [
    points.reduce((s, p) => s + Number(p.lat), 0) / points.length,
    points.reduce((s, p) => s + Number(p.lng), 0) / points.length,
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-.01em]">ตำแหน่งเครื่อง</h2>
        <span className="label">{points.length} จุด · ขนาดวงคือยอดวันนี้ · สีคือสถานะเครื่อง</span>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
        <LegendDot color="#0D9488" label="ออนไลน์" />
        <LegendDot color="#C2410C" label="ติดต่อไม่ได้" />
        <LegendDot color="#8B9694" label="ปิดใช้งาน / ไม่รายงานสถานะ" />
      </div>

      <div className="sheet overflow-hidden" style={{ height: 420 }}>
        <MapContainer
          center={center}
          zoom={points.length === 1 ? 13 : 6}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p) => {
            const ratio = Number(p.today_amount) / maxToday;
            const radius = 7 + Math.sqrt(Math.max(ratio, 0)) * 15;
            const enabled = p.is_active === 1;
            const contact = deviceContact(p.last_seen_at, p.firmware_version);
            // สีบอกสถานะที่ต้องลงมือทำ: แดงคือเครื่องที่ควรเปิดอยู่แต่ติดต่อไม่ได้
            // เครื่องที่แอดมินปิดเองไม่ใช่ปัญหา จึงเป็นสีเทา ไม่ใช่แดง (กันสัญญาณเตือนลวง)
            const dotColor = !enabled
              ? '#8B9694'
              : contact.level === 'online'
                ? '#0D9488'
                : contact.level === 'offline'
                  ? '#C2410C'
                  : '#8B9694';
            return (
              <CircleMarker
                key={p.id}
                center={[Number(p.lat), Number(p.lng)]}
                radius={radius}
                pathOptions={{
                  color: dotColor,
                  weight: 2,
                  fillColor: dotColor,
                  fillOpacity: 0.28,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <strong>{p.shop_name || p.name}</strong>
                    <br />
                    {p.customer_name || 'ยังไม่มีเจ้าของ'}
                    {p.province ? ` · ${p.province}` : ''}
                    <br />
                    วันนี้ ฿{baht(p.today_amount)} ({p.today_tx} รายการ)
                    <br />
                    คงเหลือรอโอน ฿{baht(p.pending_net)}
                    <br />
                    {enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} · {contact.text}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </section>
  );
};

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ width: 9, height: 9, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}
