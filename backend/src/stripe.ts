// เรียก Stripe REST API ตรงๆ ผ่าน fetch — ทดแทน lib/stripe_http.php (ไม่ใช้ stripe-node SDK
// เพื่อความง่าย/สอดคล้องกับของเดิมที่ไม่พึ่ง SDK ใดๆ)
import { config } from './config';

interface StripeResult {
  ok: boolean;
  httpCode: number;
  data: any;
  error: string | null;
}

export async function stripeRequest(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, any> = {}
): Promise<StripeResult> {
  let url = `https://api.stripe.com/v1${path}`;
  const authHeader = 'Basic ' + Buffer.from(`${config.stripeSecretKey}:`).toString('base64');

  const init: RequestInit = {
    method,
    headers: {
      Authorization: authHeader,
    },
  };

  if (method === 'GET' && Object.keys(params).length > 0) {
    url += '?' + toFormBody(params);
  } else if (method === 'POST') {
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    init.body = toFormBody(params);
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, httpCode: res.status, data: null, error: 'invalid_response' };
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      httpCode: res.status,
      data,
      error: data?.error?.message ?? null,
    };
  } catch (e: any) {
    console.error('Stripe request transport error:', e.message);
    return { ok: false, httpCode: 0, data: null, error: 'transport_error' };
  }
}

// Stripe รับ params แบบ PHP-style array encoding เช่น expand[]=a&expand[]=b — เขียน encoder เอง
// เพราะ URLSearchParams มาตรฐานไม่รองรับ array ซ้ำ key แบบนี้โดยตรง
function toFormBody(params: Record<string, any>): string {
  const pairs: string[] = [];
  function walk(key: string, value: any) {
    if (Array.isArray(value)) {
      value.forEach((v) => walk(`${key}[]`, v));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(`${key}[${k}]`, v));
    } else if (value !== undefined && value !== null) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  Object.entries(params).forEach(([k, v]) => walk(k, v));
  return pairs.join('&');
}
