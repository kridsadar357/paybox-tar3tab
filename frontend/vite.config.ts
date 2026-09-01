import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // แยกเฉพาะ react ออกเป็นก้อน vendor เพื่อให้ cache ข้ามการ deploy ได้ (โค้ดแอปเปลี่ยนบ่อย
        // แต่ react แทบไม่เปลี่ยน) — ห้ามใส่ leaflet ตรงนี้เด็ดขาด เพราะการบังคับสร้าง manual chunk
        // ทำให้ rolldown ถือว่าเป็น dependency ตายตัวของ entry แล้วใส่ modulepreload ใน HTML
        // ผลคือหน้า login ต้องโหลดแผนที่ 160KB ทิ้งเปล่า ทั้งที่ FleetMap เป็น dynamic import แล้ว
        // ปล่อยให้ขอบเขตของ import() แยกก้อนเองจะได้พฤติกรรมที่ถูกต้อง
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
        },
      },
    },
    assetsInlineLimit: 2048,
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
});
