export interface Device {
  id: number;
  device_key: string;
  name: string;
  shop_name: string | null;
  is_active: number; // 1 or 0
  created_at: string;
  last_seen_at: string | null;
  firmware_version: string | null;
  customer_id: number | null;
  customer_name?: string | null;
  /** ผู้ให้บริการรับชำระเงินของเครื่องนี้ — เลือกได้ต่อเครื่อง */
  payment_provider?: string | null;
  entry_method?: string;
  op_mode?: string;
  fixed_amount?: number;
  /** สถานะคำสั่งอัปเดตที่ค้างอยู่ — null ถ้าไม่มีคำสั่ง */
  command_status?: 'pending' | 'dispatched' | null;
  /** เหตุผลที่ยังปล่อยคำสั่งไม่ได้ เช่น "เพิ่งมีรายการเมื่อ 2 นาทีที่แล้ว" */
  command_hold_reason?: string | null;
  command_created_at?: string | null;
  /** ความเคลื่อนไหวล่าสุดของรายการชำระเงินบนเครื่องนี้ */
  last_tx_activity?: string | null;
}

export interface ProviderInfo {
  name: string;
  /** ตั้งค่า credential ครบแล้วหรือยัง ถ้ายังจะเลือกไม่ได้ */
  configured: boolean;
  /** อัตราที่ผู้ให้บริการเจ้านี้เก็บจากเรา */
  fee_percent: number;
}

export interface DevicesResponse {
  success: boolean;
  devices: Device[];
  latest_firmware: string | null;
  quiet_period_minutes: number;
  providers?: ProviderInfo[];
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  is_active: number;
  created_at: string;
  fee_tier: 'percentage' | 'flat';
  fee_percent: number;
  flat_fee_amount: number;
  device_count: number;
  fee_collected: number;
  /** ลูกค้าเปิดยืนยันสองชั้นไว้หรือไม่ — แอดมินต้องรู้เพื่อช่วยปลดล็อกกรณีทำอุปกรณ์หาย */
  totp_enabled: number;
  payout_bank: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
}

export interface PayoutAccount {
  payout_bank: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
}

export interface PendingSettlement extends PayoutAccount {
  customer_id: number;
  customer_name: string;
  customer_email: string;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_net: number;
  oldest_tx: string;
  newest_tx: string;
}

/** ยอดค้างโอนแตกถึงระดับเครื่อง — ตอบคำถาม "เงินก้อนนี้มาจากเครื่องไหน" */
export interface PendingDeviceRow {
  customer_id: number;
  device_id: number;
  device_name: string;
  shop_name: string | null;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_net: number;
}

export interface HistoryDeviceRow {
  settlement_id: number;
  device_id: number;
  device_name: string;
  shop_name: string | null;
  tx_count: number;
  total_net: number;
}

export interface SettlementHistory extends PayoutAccount {
  id: number;
  customer_id: number;
  customer_name: string;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_net: number;
  status: 'pending' | 'settled' | 'problem';
  proof_reference: string | null;
  proof_file: string | null;
  note: string | null;
  settled_at: string | null;
  created_at: string;
}

/** โหนดในผังความสัมพันธ์ ลูกค้า → เครื่อง พร้อมยอดเงินสามชั้น */
export interface TopologyDevice {
  id: number;
  name: string;
  shop_name: string | null;
  is_active: number;
  last_seen_at: string | null;
  firmware_version: string | null;
  lat: number | null;
  lng: number | null;
  province: string | null;
  region_zone: string | null;
  customer_id: number | null;
  customer_name: string | null;
  today_amount: number;
  today_tx: number;
  settled_net: number;
  pending_net: number;
  pending_tx: number;
}

export interface FirmwareRelease {
  id: number;
  version: string;
  filename: string;
  notes: string | null;
  uploaded_at: string;
}

export interface SummaryData {
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_provider_fee: number;
  total_profit: number;
  total_net: number;
}

export interface AdminSummaryResponse {
  success: boolean;
  from: string;
  to: string;
  summary: SummaryData;
  device_count: number;
  device_active_count: number;
  customer_count: number;
  customers_pending_settlement: number;
}

// Customer Portal Types
export interface CustomerFeeInfo {
  fee_tier: 'percentage' | 'flat';
  fee_percent: number;
  flat_fee_amount: number;
}

export interface CustomerDevice {
  id: number;
  name: string;
  shop_name: string | null;
  is_active: number;
  firmware_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_net: number;
}

export interface CustomerDevicesResponse {
  success: boolean;
  fee_info: CustomerFeeInfo;
  devices: CustomerDevice[];
}

/** ยอดขายรายวัน (วันที่ตามเวลาไทย) — backend เติมวันที่ไม่มียอดขายมาให้ครบแล้ว */
export interface CustomerDailyPoint {
  day: string;
  tx_count: number;
  amount: number;
  net: number;
}

export interface CustomerPeriodDevice {
  id: number;
  name: string;
  shop_name: string | null;
  is_active: number;
  last_seen_at: string | null;
  tx_count: number;
  amount: number;
  fee: number;
  net: number;
}

export interface CustomerSummary {
  success: boolean;
  range: { from: string; to: string };
  /** เงินที่เก็บได้แล้วแต่ยังไม่ได้โอนให้ร้านค้า — ไม่ผูกกับช่วงเวลาที่เลือก */
  pending_payout: { tx_count: number; net: number; oldest_tx: string | null };
  today: { tx_count: number; amount: number; net: number };
  period: { tx_count: number; amount: number; fee: number; net: number };
  all_time: { tx_count: number; amount: number; fee: number; net: number };
  daily: CustomerDailyPoint[];
  devices: CustomerPeriodDevice[];
}

export interface CustomerTransaction {
  id: number;
  device_id: number;
  device_name: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  status: string;
  fee_amount: number;
  fee_tier_snapshot: string | null;
  net_amount: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerSettlement {
  id: number;
  tx_count: number;
  total_amount: number;
  total_fee: number;
  total_net: number;
  status: 'pending' | 'settled' | 'problem';
  proof_reference: string | null;
  proof_url: string | null;
  /** เหตุผลที่รอบนี้ติดปัญหา — มีค่าเมื่อ status = 'problem' */
  note: string | null;
  settled_at: string | null;
  created_at: string;
}
