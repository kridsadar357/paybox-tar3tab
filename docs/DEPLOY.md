# Deploy บน VPS (root@$PAYBOX_HOST) — ห้ามกระทบ services เดิมที่รันอยู่

เช็คแล้วจาก `docker ps` จริงบนเครื่องนี้: มี **Traefik** (รับ 80/443 ทั้งเครื่อง, cert อัตโนมัติผ่าน
Let's Encrypt HTTP-01 บน certresolver ชื่อ `le`), แอปอื่น (แอปอื่น ใช้ network `web` +
network ภายในของแอปนั้น), ฐานข้อมูลของแอปนั้น (DB ของแอปนั้น) — สามตัวนี้จะ**ไม่ถูกแตะต้องเลย**ตลอด
ขั้นตอนด้านล่าง เรา attach เข้า network `web` แค่เพื่อให้ Traefik มองเห็น container ของเราเฉยๆ
(Traefik ตั้ง `exposedbydefault=false` ไว้ — container ที่ไม่ติด label `traefik.enable=true`
จะไม่ถูกแตะโดยดีไซน์อยู่แล้ว)

## 0) จัดโฟลเดอร์ deploy

```bash
mkdir -p /opt/paybox
cd /opt/paybox
# clone หรือ scp โค้ดทั้งสอง repo มาไว้เป็นพี่น้องกัน:
#   /opt/paybox/paybox-backend/
#   /opt/paybox/paybox-control/   (เอาแค่โฟลเดอร์ paybox-control ไม่ต้องมี paybox-api ห่อ)
```

## 1) ตั้งค่า .env

```bash
cd /opt/paybox/paybox-backend
cp .env.example .env
nano .env   # ใส่ STRIPE_SECRET_KEY, ADMIN_PASSWORD, DB_PASS, MYSQL_ROOT_PASSWORD จริง
```

## 2) ย้ายฐานข้อมูล

ทำตาม `db/MIGRATION.md` — สรุปสั้นๆ: `docker compose up -d mysql` ก่อน, import
`paybox_dump.sql` (dump จาก โฮสต์เดิม) เข้าไป, สร้าง user `paybox_app` แยกจาก root
(MySQL ของเราอยู่บน network `paybox-net` ของตัวเอง ไม่เกี่ยวอะไรกับ ฐานข้อมูลของแอปนั้น เลย)

## 3) Build + รัน

```bash
cd /opt/paybox/paybox-backend
docker compose up -d --build
docker compose logs -f backend   # เช็คว่าขึ้น "paybox-backend listening on :3001" ไม่มี error
```

`docker-compose.yml` ต่อเข้า Traefik ให้แล้วผ่าน label (`traefik.http.routers.paybox.rule=
Host(orca-paybox.com)...`, service port 3001) — **ไม่ publish port ออก host เลยแม้แต่พอร์ตเดียว**
Traefik คุยกับ container ผ่าน network `web` ตรงๆ เพราะงั้นเช็คจากในเครื่องต้อง exec เข้า network
เดียวกันหรือรอ DNS ชี้มาก่อน จะ curl `127.0.0.1:<port>` ตรงๆ จากนอก container ไม่ได้เหมือนสมัยที่
ยังไม่มี reverse proxy:

```bash
docker exec paybox-backend wget -qO- http://localhost:3001/
# ควรได้ {"ok":true,"service":"paybox-backend"}
```

## 4) ทดสอบผ่านโดเมนจริงก่อนประกาศใช้งาน

รอ DNS ของ `orca-paybox.com`/`www.orca-paybox.com` ชี้มาที่ IP เครื่องนี้ก่อน (คุณเป็นคนตั้งค่า
Cloudflare) — พอ DNS โพรพาเกตแล้ว Traefik จะเห็น router ใหม่และขอ cert Let's Encrypt ให้เองอัตโนมัติ
(ตัวเดียวกับที่แอปอื่นบนเครื่องใช้อยู่) เช็ค log ว่าได้ cert จริง:

```bash
docker logs traefik --tail 50 | grep -i paybox
curl -I https://orca-paybox.com/    # ควรได้ 200 พร้อม cert ที่ถูกต้อง ไม่ใช่ self-signed warning
```

จากนั้นทดสอบ:
- `/portal/administrator` login ได้, เห็นรายการอุปกรณ์/ลูกค้า
- `/customer` login ลูกค้าเดิม (bcrypt hash เดิม) ได้
- อัปโหลด firmware ผ่านหน้าแอดมิน แล้ว `curl https://orca-paybox.com/devices/firmware/<filename>`
  ดึงไฟล์ได้จริง
- `curl https://orca-paybox.com/api/audio/digit_0.wav` ได้ไฟล์เสียงจริง (สิ่งที่บอร์ดใหม่จะเรียก)

## 5) ค่อย push firmware OTA

ดู `FIRMWARE_CUTOVER.md` — ต้องทำ **หลัง** ยืนยันข้อ 4 ผ่านครบเท่านั้น เพราะบอร์ดที่ OTA ไปแล้วจะ
เลิกคุยกับ โฮสต์เดิม ทันที
