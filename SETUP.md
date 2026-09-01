# ติดตั้งตั้งแต่ศูนย์

คู่มือนี้พาไปจนถึงเครื่องรับเงินจริงหนึ่งเครื่องที่ใช้งานได้ ใช้เวลาประมาณหนึ่งถึงสองชั่วโมง
ถ้ามีโดเมนกับเซิร์ฟเวอร์พร้อมอยู่แล้ว

อ่าน [`docs/SECURITY.md`](docs/SECURITY.md) ก่อนเปิดรับเงินจริง

## สิ่งที่ต้องมี

| อะไร | ทำไม |
|---|---|
| เซิร์ฟเวอร์ Linux ที่มี Docker และ Docker Compose v2 | รันทุกอย่าง |
| โดเมนที่ชี้มาที่เซิร์ฟเวอร์นั้น | Stripe ต้องยิง webhook เข้ามาได้ และเครื่องต้องต่อผ่าน HTTPS |
| reverse proxy ที่ทำ TLS ให้ | ไฟล์ compose เตรียมไว้ให้ใช้กับ Traefik ดูหัวข้อ "ถ้าไม่ได้ใช้ Traefik" |
| บัญชี Stripe ที่เปิด PromptPay แล้ว | สร้าง QR รับเงิน |
| บอร์ด ESP32-S3 อย่างน้อยหนึ่งตัว | ดูรุ่นที่ใช้ได้ใน `HARDWARE.md` ของ repo เฟิร์มแวร์ |

## 1 · เอาโค้ดขึ้นเซิร์ฟเวอร์

```sh
mkdir -p /opt/paybox && cd /opt/paybox
git clone <ที่อยู่ repo> platform
cd platform
```

โฟลเดอร์สองอันนี้ต้องมีอยู่ก่อนสตาร์ต เพราะ compose ผูก bind mount ไว้ และ backend ในคอนเทนเนอร์
รันด้วย uid 100 จึงต้องเป็นเจ้าของโฟลเดอร์ที่มันเขียน

```sh
mkdir -p /opt/paybox/alerts /opt/paybox/state
chown 100:101 /opt/paybox/alerts
chmod 700 /opt/paybox/alerts
```

## 2 · ตั้งค่า

```sh
cp .env.example .env
nano .env
```

ต้องกรอกทุกบรรทัด ไม่มีค่าไหนที่ใช้ค่าเริ่มต้นได้ ตั้งรหัสผ่านให้ยาวและสุ่มจริง —
`ADMIN_PASSWORD` คือรหัสที่ใช้เข้าหน้าผู้ดูแลระบบครั้งแรก

`STRIPE_WEBHOOK_SECRET` ยังไม่มีตอนนี้ ปล่อยว่างไว้ก่อนแล้วกลับมาเติมในขั้นที่ 5

แก้โดเมนในไฟล์ compose ด้วย มีสามจุดที่เขียนโดเมนไว้

```sh
sed -i 's/orca-paybox\.com/โดเมนของคุณ/g' docker-compose.yml
grep -c "โดเมนของคุณ" docker-compose.yml   # ควรได้ 6
```

## 3 · สร้างฐานข้อมูล

```sh
docker compose up -d mysql
sleep 20
docker compose exec -T mysql mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" \
    "$(grep '^DB_NAME=' .env | cut -d= -f2-)" < backend/db/schema.sql
```

`schema.sql` มีโครงสร้างครบทั้ง 10 ตาราง **ไม่ต้องรันอะไรใน `backend/db/migrations/` ตามอีก** —
โฟลเดอร์นั้นมีไว้อัปเกรดระบบที่ติดตั้งไปแล้วเท่านั้น

ตรวจว่าครบ

```sh
docker compose exec -T mysql mysql -uroot -p"..." paybox -e "SHOW TABLES"   # ต้องได้ 10 ตาราง
```

ต้องสร้างผู้ใช้ฐานข้อมูลที่ไม่ใช่ root ให้ตรงกับ `DB_USER` และ `DB_PASS` ใน `.env` ด้วย

```sql
CREATE USER 'paybox_app'@'%' IDENTIFIED BY 'รหัสผ่านเดียวกับ DB_PASS';
GRANT SELECT, INSERT, UPDATE, DELETE ON paybox.* TO 'paybox_app'@'%';
FLUSH PRIVILEGES;
```

## 4 · สตาร์ตระบบ

```sh
docker compose up -d --build backend
docker compose logs -f backend      # ต้องเห็น "paybox-backend listening on :3001"
curl https://โดเมนของคุณ/           # ต้องได้ {"ok":true,"service":"paybox-backend"}
```

การ build จะรัน lint กับเทสต์ก่อนเสมอ ถ้าเทสต์ไม่ผ่าน image จะไม่ถูกสร้าง — ตั้งใจให้เป็นแบบนั้น

## 5 · ต่อ Stripe

ในหน้า Stripe Dashboard

1. เปิดใช้ PromptPay ที่ **Settings → Payment methods**
2. ไปที่ **Developers → Webhooks → Add endpoint**
   - URL: `https://โดเมนของคุณ/api/stripe/webhook`
   - เลือกอีเวนต์กลุ่ม `payment_intent` ทั้งหมด — ตัวรับฝั่งเราประมวลผลทุกอีเวนต์ที่
     ขึ้นต้นด้วย `payment_intent.` และข้ามอย่างอื่นทิ้ง
3. คัดลอก **Signing secret** (ขึ้นต้นด้วย `whsec_`) มาใส่ `STRIPE_WEBHOOK_SECRET` ใน `.env`
4. `docker compose up -d backend` แล้วตรวจ

```sh
curl -X POST -H 'Content-Type: application/json' -d '{}' https://โดเมนของคุณ/api/stripe/webhook
```

ต้องได้ **400** (`invalid_signature`) ถ้าได้ **503** แปลว่ายังไม่ได้ตั้ง secret และรายการที่จ่ายสำเร็จ
จะไม่ถูกอัปเดตเลย

## 6 · เข้าระบบครั้งแรก

เปิด `https://โดเมนของคุณ/portal/administrator/` ล็อกอินด้วย username `admin` กับรหัสจาก
`ADMIN_PASSWORD` ระบบสร้างบัญชีนี้ให้อัตโนมัติตอนบูตครั้งแรก

ทำสามอย่างทันที

1. **เปลี่ยนรหัสผ่าน** และเปิดยืนยันตัวตนสองชั้นที่ ตั้งค่า → ยืนยันตัวตนสองชั้น
2. **สร้างบัญชีร้านค้า** ที่ ลูกค้า → เพิ่มลูกค้า
3. **ตั้งค่าธรรมเนียม** ระบบจะไม่ยอมให้ตั้งต่ำกว่าหรือเท่ากับ `PROVIDER_FEE_PERCENT`
   เพราะนั่นคือขาดทุนแน่นอน — หน้าจอจะบอกกำไรสุทธิที่เหลือให้เห็นขณะพิมพ์

## 7 · เฟิร์มแวร์และเครื่องแรก

จาก repo `paybox-firmware` ตั้งสองค่านี้ใน `platformio.ini` ก่อน build

```ini
build_flags =
    -D BACKEND_BASE_URL='"https://โดเมนของคุณ/api/"'
    -D MA_PIN='"รหัสหกหลักของคุณ"'
```

ถ้าไม่ตั้ง `BACKEND_BASE_URL` เครื่องจะติดต่อเซิร์ฟเวอร์ไม่ได้เลย และคอมไพเลอร์จะเตือนให้

```sh
pio run -t upload      # แฟลชผ่าน USB
```

เสียบไฟแล้วเครื่องจะขอ WiFi ก่อน จากนั้นลงทะเบียนตัวเองเข้าระบบอัตโนมัติ **โดยมีสถานะปิดอยู่** —
กลับมาที่หน้า อุปกรณ์ ในเว็บ จะเห็นเครื่องใหม่ชื่อ "รอตั้งชื่อ (MAC: …)" ให้ตั้งชื่อ ผูกกับร้านค้า
แล้วเปิดสวิตช์ เครื่องถึงจะรับเงินได้

เข้าโหมดช่างบนเครื่องได้ด้วยการแตะชื่อร้าน 10 ครั้งภายใน 5 วินาที แล้วใส่ `MA_PIN`

## 8 · งานเบื้องหลัง (ทำก็ต่อเมื่อจะใช้จริง)

ติดตั้งการสำรองข้อมูลและการเฝ้าระวังตาม [`ops/README.md`](ops/README.md)

```sh
cp ops/*.sh /opt/paybox/scripts/ && chmod 700 /opt/paybox/scripts/*.sh
crontab -e
```

```cron
0 20 * * *   /opt/paybox/scripts/backup.sh
30 20 * * 0  /opt/paybox/scripts/restore-test.sh >> /opt/paybox/backups/restore-test.log 2>&1
*/5 * * * *  /opt/paybox/scripts/watch.sh
```

เวลาใน cron เป็น UTC ตัวอย่างข้างบนคือ 03:00 และ 03:30 เวลาไทย

ตั้งช่องทางแจ้งเตือน (Telegram หรือ LINE) ที่หน้า ตั้งค่า → การแจ้งเตือน ในเว็บ มีวิธีหา token
อยู่ในปุ่ม "อ่านวิธีตั้งค่า"

## ถ้าไม่ได้ใช้ Traefik

ไฟล์ compose ผูกกับ Traefik ผ่าน label และต้องการ network ภายนอกชื่อ `web` กับ certresolver
ชื่อ `le` ถ้าไม่มี ให้แก้ service `backend` เป็น

```yaml
    ports:
      - "127.0.0.1:3001:3001"
    networks:
      - paybox-net
```

ลบบล็อก `labels:` ทั้งหมด และลบ `web:` ออกจาก `networks:` ท้ายไฟล์ แล้วเอา nginx หรือ Caddy
มาวางหน้า `127.0.0.1:3001` พร้อมใบรับรอง TLS

**ต้องเป็น HTTPS เท่านั้น** เฟิร์มแวร์ต่อผ่าน TLS อย่างเดียว และ Stripe ไม่ยิง webhook ไปที่ HTTP

## ปล่อยของครั้งต่อไป

```sh
git push
ssh root@เซิร์ฟเวอร์ /opt/paybox/platform/ops/deploy.sh
```

สคริปต์จะหยุดถ้าเจอไฟล์ที่ถูกแก้ค้างไว้บนเซิร์ฟเวอร์ ต้องสั่ง `FORCE=1` ถึงจะยอมทับ

## เจอปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| `/` ตอบ 502 | backend ยังไม่ขึ้น — `docker compose logs backend` |
| webhook ตอบ 503 | ยังไม่ได้ตั้ง `STRIPE_WEBHOOK_SECRET` |
| เข้าหน้าแอดมินไม่ได้ | `ADMIN_PASSWORD` ว่างตอนบูตครั้งแรก ตั้งแล้วรีสตาร์ต backend |
| `provision_register` ตอบ 500 | ฐานข้อมูลไม่ครบ import `backend/db/schema.sql` ใหม่ |
| เครื่องขึ้น "เชื่อมต่อไม่ได้" | `BACKEND_BASE_URL` ผิด หรือโดเมนยังไม่มีใบรับรอง TLS |
| หน้าเว็บเรียก API ผิดที่ | ปกติไม่ต้องตั้ง `VITE_API_ROOT` เพราะหน้าเว็บกับ API อยู่โดเมนเดียวกัน |
