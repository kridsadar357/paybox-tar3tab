# ทดสอบสร้าง QR ผ่าน Ksher (Native Pay / C scan B)

เครื่องมือแยกต่างหาก **ไม่ได้ต่อกับระบบจริง ไม่แตะฐานข้อมูล** และไม่มีอะไรใน `backend/`
หรือ `frontend/` เรียกใช้

```sh
node tools/ksher-test/server.mjs
# เปิด http://127.0.0.1:8788
```

ตรวจว่าการเซ็นลายเซ็นถูกต้องโดยไม่ต้องมีบัญชีจริง

```sh
node tools/ksher-test/sign.test.mjs
```

## สเปกที่ใช้อ้างอิง

| | |
|---|---|
| Endpoint | `POST https://api.mch.ksher.net/KsherPay/native_pay` |
| Content-Type | `application/x-www-form-urlencoded` |
| ช่องทาง | `promptpay` `truemoney` `alipay` `alipayplus` `wechat` `airpay` `scb_qrcard` |
| จำนวนเงิน | `total_fee` เป็น **จำนวนเต็มหน่วยสตางค์** — 150.50 บาท ส่ง `15050` |
| QR ที่ได้ | `data.imgdat` เป็นรูป base64 (png หรือ svg ตาม `img_type`) และ `data.code_url` เป็นสตริงดิบ |
| เช็คสถานะ | `POST /KsherPay/order_query` — `SUCCESS` `NOTPAY` `USERPAYING` `PAYERROR` `CLOSED` `PENDING` `NOTSURE` `REFUND` |
| Webhook | POST มาที่ `notify_url` ต้องตอบ `{"result":"SUCCESS","msg":"OK"}` ไม่งั้นเขายิงซ้ำ 12 ครั้งใน ~29 ชั่วโมง |

## ลายเซ็น

RSA-MD5 ด้วยกุญแจส่วนตัวของร้านค้า ขั้นตอนตามเอกสาร

1. เอาพารามิเตอร์ทั้งหมด **ยกเว้น `sign`** มาเรียงตามชื่อแบบ ASCII
2. ต่อกันเป็น `key=value` **ติดกันไปเลยไม่มีตัวคั่น**
3. เข้ารหัส UTF-8 แล้วเซ็นด้วย RSA-MD5 ผลลัพธ์เป็นเลขฐานสิบหก
4. คำตอบที่ Ksher ส่งกลับมาตรวจได้ด้วยกุญแจสาธารณะของ Ksher ด้วยวิธีเดียวกัน

`ksherSign.mjs` แยกออกมาเป็นไฟล์ที่ไม่ยุ่งกับเครือข่าย จึงเทสต์ได้โดยไม่ต้องมีบัญชี
`sign.test.mjs` ตรวจ 19 ข้อ รวมถึงเซ็นแล้วตรวจกลับด้วยคู่กุญแจที่สร้างขึ้นเอง
และยืนยันว่าแก้ข้อมูลแม้แต่ฟิลด์เดียวแล้วลายเซ็นต้องไม่ผ่าน

## ต้องมีอะไรก่อนถึงจะยิงจริงได้

ใส่ในไฟล์ `tools/ksher-test/.env.local` (ถูก `.gitignore` กันไว้แล้ว **ห้ามเอาไปใส่ไฟล์ที่ commit**)

```
KSHER_APPID=mch20163
KSHER_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
MIIEow...
-----END RSA PRIVATE KEY-----
KSHER_PUBLIC_KEY=-----BEGIN RSA PUBLIC KEY-----
MIIBCg...
-----END RSA PUBLIC KEY-----
```

กุญแจแบบ PEM กินหลายบรรทัดได้ ตัวอ่านไฟล์ต่อบรรทัดถัดไปเข้ากับคีย์ล่าสุดให้เอง

ทั้งสามค่าเอามาจากหลังบ้านของ Ksher — appid อยู่ในหน้า Merchant No. ส่วนกุญแจดาวน์โหลดได้
จากหน้า Download Private key / Public key **ไม่มี credential ทดสอบแบบสาธารณะ** ต้องสมัครบัญชีก่อน

`KSHER_PUBLIC_KEY` ไม่ใส่ก็สร้าง QR ได้ แต่จะไม่ได้ตรวจว่าคำตอบที่กลับมาเป็นของ Ksher จริง

## เทียบกับ Payso

| | Ksher | Payso |
|---|---|---|
| หน่วยเงิน | สตางค์ (จำนวนเต็ม) | บาท (ทศนิยม 2 ตำแหน่ง) |
| ยืนยันตัวตน | RSA-MD5 เซ็นทุกคำขอ | Bearer token ตายตัว |
| ตรวจคำตอบได้ไหม | ได้ ด้วยกุญแจสาธารณะ | ไม่มีกลไก |
| เอกสาร | ครบ มีตัวอย่าง request/response | ขาดเรื่องที่มาของ token |

**หน่วยเงินต่างกันคือจุดที่พลาดแล้วผิดร้อยเท่า** ตอนทำเป็นผู้ให้บริการหลายตัวในระบบจริง
ต้องให้แต่ละตัวแปลงหน่วยของตัวเอง ห้ามส่งตัวเลขดิบข้ามกัน
