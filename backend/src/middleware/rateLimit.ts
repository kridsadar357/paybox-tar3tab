// Rate limit ต่อ IP ต่อ endpoint — ทดแทน lib/RateLimiter.php (ที่นั่นเป็นแบบ file-based เพราะ PHP
// ไม่มี state ข้าม request ได้ Node เป็น process เดียวรันต่อเนื่อง ใช้ in-memory ผ่าน
// express-rate-limit ได้ตรงๆ ง่ายกว่าและเร็วกว่า)
import rateLimit from 'express-rate-limit';

export function bucketLimiter(_bucket: string, max = 30, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'rate_limited' },
  });
}
