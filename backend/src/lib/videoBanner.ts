// แปลงวิดีโอทั่วไป (mp4/mov/webm ฯลฯ) ที่ลูกค้าอัปโหลดตรงๆ ให้เป็น .mjpeg (JPEG เฟรมต่อกัน) ที่บอร์ด
// เล่นได้ — ทำฝั่งเซิร์ฟเวอร์ทั้งหมดผ่าน ffmpeg ลูกค้าไม่ต้องแปลงไฟล์เองจากข้างนอก
//
// ข้อจำกัดจริงของบอร์ดที่ต้องเคารพ (เจอบั๊กจริงตอนทดสอบ):
// - แคนวาสแสดงผลจริงคือ 480x320 (landscape) — banner_show_slide()/video_play_next_frame() ใน
//   main.cpp คุมด้วย lv_img_set_zoom() ที่ clamp สูงสุดที่ 256 (1:1) ไม่มีการขยายภาพเกินขนาดจริงเด็ดขาด
//   (กันภาพแตก) ส่งรูปเล็กกว่านี้ไปจะไม่เต็มจอ ต้อง crop-to-fill มาที่ 480x320 พอดีเป๊ะเท่านั้น
// - MjpegClass::readMjpegBuf() (เฟิร์มแวร์) copy ข้อมูลลง buffer ขนาดคงที่ VIDEO_READ_BUFFER_SIZE
//   (15360 ไบต์) โดยไม่เช็คขอบเขตเลย — ถ้าเฟรมไหนไบต์เกินนี้จะ overflow ไปเขียนทับ PSRAM ข้างเคียง
//   ทำให้ภาพเพี้ยน/เสียหายได้ (เจอจริง) ต้องบีบอัดให้ทุกเฟรมเล็กกว่านี้แน่ๆ พร้อม margin ปลอดภัย
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

export const BANNER_SCREEN_W = 480;
export const BANNER_SCREEN_H = 320;
const MAX_FRAME_BYTES = 12_000; // เผื่อ margin ใต้ VIDEO_READ_BUFFER_SIZE จริง (15360) ของเฟิร์มแวร์
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // เท่ากับ limit ของ multer ฝั่ง route
const MAX_DURATION_SEC = 20; // banner เป็นคลิปสั้นๆ วนซ้ำ ไม่ใช่วิดีโอเต็มเรื่อง
const QUALITY_LADDER = [16, 20, 24, 28, 31]; // ffmpeg mjpeg -q:v: ยิ่งมากยิ่งบีบอัดแรง/ไฟล์เล็กลง

export class VideoBannerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function probeDurationSec(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const sec = parseFloat(stdout.trim());
    return isNaN(sec) ? 0 : sec;
  } catch {
    throw new VideoBannerError('probe_failed', 'ไม่สามารถอ่านไฟล์วิดีโอได้ (ฟอร์แมตไม่รองรับ หรือไฟล์เสีย)');
  }
}

async function extractFrames(inputPath: string, outDir: string, fps: number, quality: number): Promise<string[]> {
  const pattern = path.join(outDir, 'frame_%05d.jpg');
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', `fps=${fps},scale=${BANNER_SCREEN_W}:${BANNER_SCREEN_H}:force_original_aspect_ratio=increase,crop=${BANNER_SCREEN_W}:${BANNER_SCREEN_H}`,
    '-q:v', String(quality),
    pattern,
  ]);
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

export interface TranscodeOptions {
  fps: number; // แนะนำ 3-4 จากการทดสอบจริงบนฮาร์ดแวร์ (SD การ์ดต่อแบบ 1-bit เท่านั้น อ่านช้า)
}

export async function transcodeVideoToMjpeg(
  inputBuffer: Buffer,
  originalName: string,
  opts: TranscodeOptions
): Promise<{ buffer: Buffer; frameCount: number }> {
  const fps = Math.max(1, Math.min(8, opts.fps || 4));
  const workDir = path.join(os.tmpdir(), `banner_${crypto.randomBytes(8).toString('hex')}`);
  const ext = path.extname(originalName) || '.mp4';
  const inputPath = path.join(workDir, `input${ext}`);

  fs.mkdirSync(workDir, { recursive: true });
  try {
    fs.writeFileSync(inputPath, inputBuffer);

    const duration = await probeDurationSec(inputPath);
    if (duration <= 0) {
      throw new VideoBannerError('invalid_video', 'ไม่สามารถอ่านวิดีโอนี้ได้');
    }
    if (duration > MAX_DURATION_SEC) {
      throw new VideoBannerError(
        'video_too_long',
        `วิดีโอยาวเกินไป (${duration.toFixed(1)} วิ) — banner รองรับคลิปสั้นสุด ${MAX_DURATION_SEC} วินาที`
      );
    }

    let framePaths: string[] = [];
    let maxFrameSize = Infinity;

    for (const quality of QUALITY_LADDER) {
      const framesDir = path.join(workDir, `q${quality}`);
      fs.mkdirSync(framesDir, { recursive: true });
      framePaths = await extractFrames(inputPath, framesDir, fps, quality);

      if (framePaths.length === 0) {
        throw new VideoBannerError('no_frames', 'แปลงวิดีโอไม่สำเร็จ — ไม่พบเฟรมภาพ');
      }

      maxFrameSize = Math.max(...framePaths.map((p) => fs.statSync(p).size));
      if (maxFrameSize <= MAX_FRAME_BYTES) {
        break; // เจอ quality ที่พอดีแล้ว หยุดลองต่อ
      }
    }

    if (maxFrameSize > MAX_FRAME_BYTES) {
      throw new VideoBannerError(
        'frame_too_large',
        'ไม่สามารถบีบอัดวิดีโอให้เล็กพอสำหรับหน้าจอเครื่องได้ (เนื้อหาซับซ้อนเกินไป) ลองคลิปอื่นหรือสั้นกว่านี้'
      );
    }

    const buffers = framePaths.map((p) => fs.readFileSync(p));
    const combined = Buffer.concat(buffers);
    if (combined.length > MAX_TOTAL_BYTES) {
      throw new VideoBannerError('video_too_large', 'ไฟล์วิดีโอที่แปลงแล้วมีขนาดใหญ่เกินไป ลองคลิปที่สั้นกว่านี้');
    }

    return { buffer: combined, frameCount: framePaths.length };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
