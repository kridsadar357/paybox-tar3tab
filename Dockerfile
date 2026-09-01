# Multi-stage build — รวมหน้าเว็บ (React SPA) + API (Node) เป็น image เดียว
#
# build context คือรากของ repo นี้ ทั้ง frontend/ และ backend/ จึงอยู่ในนั้นอยู่แล้ว
# ไม่ต้องพึ่งโครงโฟลเดอร์บนเซิร์ฟเวอร์ว่าใครวางอะไรไว้ตรงไหน:
#   cd /opt/paybox/platform && docker compose up -d --build
#
# ทั้งสองฝั่งถูก build พร้อมกันโดยตั้งใจ — เวอร์ชันของ API กับหน้าเว็บที่คู่กันจะออกไปด้วยกันเสมอ
# ไม่มีช่วงที่หน้าเว็บใหม่คุยกับ API เก่า

# ---- Stage 1: build paybox-control SPA ----
# COPY เจาะจงไฟล์/โฟลเดอร์ (ไม่ COPY ทั้งไดเรกทอรี) เพื่อไม่ให้ node_modules/dist ที่ build ไว้ก่อนหน้า
# หลุดเข้ามาทับของที่ npm ci ติดตั้งใหม่ในคอนเทนเนอร์
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.ts ./
COPY frontend/tsconfig*.json frontend/.oxlintrc.json ./
COPY frontend/src ./src
COPY frontend/public ./public
# lint ก่อน build — ให้การ deploy เป็นด่านที่บังคับคุณภาพจริง ไม่ใช่ขึ้นกับว่าใครจำได้ว่าต้องรันเอง
# (npm run build เรียก tsc -b อยู่แล้ว จึงได้ typecheck ไปด้วย)
RUN npm run lint && npm run build

# ---- Stage 2: build paybox-backend (TypeScript -> JS) ----
FROM node:22-alpine AS backend-build
WORKDIR /backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/tsconfig.json backend/.oxlintrc.json ./
COPY backend/src ./src
COPY backend/test ./test
# เทสต์ที่ครอบตรรกะการคิดเงินและการตรวจลายเซ็น webhook ต้องผ่านก่อนถึงจะได้ image
# ถ้าปล่อยให้เป็นแค่คำสั่งที่คนต้องจำว่าต้องรัน มันจะถูกลืมในวันที่รีบที่สุด ซึ่งเป็นวันที่ต้องการมันที่สุด
RUN npm run lint && npm test
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/uploads

# ffmpeg สำหรับแปลงวิดีโอที่ลูกค้าอัปโหลด (mp4/mov/webm ฯลฯ) เป็น .mjpeg ที่บอร์ดเล่นได้ — ทำฝั่งเซิร์ฟเวอร์
# ทั้งหมด ลูกค้าไม่ต้องแปลงไฟล์เองจากข้างนอก
RUN apk add --no-cache ffmpeg

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=backend-build /backend/dist ./dist
COPY --from=frontend-build /frontend/dist ./public/paybox-control
COPY backend/assets ./assets

RUN mkdir -p /app/uploads && addgroup -S paybox && adduser -S paybox -G paybox && \
    chown -R paybox:paybox /app
USER paybox

EXPOSE 3001
CMD ["node", "dist/server.js"]
