// ทะเบียนผู้ให้บริการรับชำระเงิน
//
// ที่เดียวที่รู้ว่ามีใครบ้าง ส่วนอื่นของระบบเรียกผ่าน getProvider() เท่านั้น
import { config } from '../../config';
import { PaymentProvider, ProviderName } from './types';
import { stripeProvider } from './stripe';
import { ksherProvider } from './ksher';
import { paysoProvider } from './payso';

const REGISTRY: Record<ProviderName, PaymentProvider> = {
  stripe: stripeProvider,
  ksher: ksherProvider,
  payso: paysoProvider,
};

export const PROVIDER_NAMES = Object.keys(REGISTRY) as ProviderName[];

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && v in REGISTRY;
}

/** ชื่อที่ไม่รู้จักให้ตกกลับไปที่ stripe เพื่อไม่ให้ข้อมูลเก่าที่ไม่มีคอลัมน์นี้พังทั้งระบบ */
export function getProvider(name: string | null | undefined): PaymentProvider {
  return isProviderName(name) ? REGISTRY[name] : REGISTRY.stripe;
}

/** อัตราที่ผู้ให้บริการเจ้านั้นเก็บจากเรา ใช้เป็นพื้นขั้นต่ำของค่าธรรมเนียมที่ตั้งให้ร้านค้า */
export function providerFeePercent(name: string | null | undefined): number {
  const key = isProviderName(name) ? name : 'stripe';
  return config.providerFeePercent[key] ?? config.providerFeePercent.stripe;
}

/** สถานะพร้อมใช้งานของทุกเจ้า ใช้ให้หน้าแอดมินบอกได้ว่าเลือกอันไหนได้บ้าง */
export function providerStatus() {
  return PROVIDER_NAMES.map((name) => ({
    name,
    configured: REGISTRY[name].isConfigured(),
    fee_percent: providerFeePercent(name),
  }));
}

export * from './types';
