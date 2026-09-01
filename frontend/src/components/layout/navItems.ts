// รายการเมนูของแต่ละพอร์ทัล
//
// แยกออกจาก PortalSidebar.tsx เพราะไฟล์ที่ export ทั้งคอมโพเนนต์และค่าคงที่ทำให้ Fast Refresh
// ของ Vite ใช้ไม่ได้ — แก้ค่าคงที่ทีนึงแล้วทั้งหน้าจะรีโหลดใหม่แทนที่จะอัปเดตเฉพาะส่วนที่เปลี่ยน
// และ state ที่ค้างอยู่ในหน้าจะหายไปด้วย
import React from 'react';
import { LayoutDashboard, Cpu, Users, Wallet, BarChart3, Settings, Receipt } from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const ADMIN_TABS: NavItem[] = [
  { key: 'dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
  { key: 'devices', label: 'อุปกรณ์', icon: Cpu },
  { key: 'customers', label: 'ลูกค้า', icon: Users },
  { key: 'settlements', label: 'เคลียร์บิล', icon: Wallet },
  { key: 'reports', label: 'รายงาน', icon: BarChart3 },
  { key: 'settings', label: 'ตั้งค่า', icon: Settings },
];

export const CUSTOMER_TABS: NavItem[] = [
  { key: 'overview', label: 'ภาพรวม', icon: LayoutDashboard },
  { key: 'transactions', label: 'รายการชำระเงิน', icon: Receipt },
  { key: 'settlements', label: 'รอบโอนเงิน', icon: Wallet },
  { key: 'settings', label: 'ตั้งค่า', icon: Settings },
];
