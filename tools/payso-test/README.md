# ทดสอบสร้าง QR PromptPay ผ่าน Payso

เครื่องมือแยกต่างหากสำหรับดูว่า API ของ Payso ตอบอะไรกลับมาจริงๆ **ไม่ได้ต่อกับระบบจริง
ไม่แตะฐานข้อมูล และไม่มีอะไรใน `backend/` หรือ `frontend/` เรียกใช้ไฟล์พวกนี้**

```sh
node tools/payso-test/server.mjs
# เปิด http://127.0.0.1:8787
```

ตั้งค่าไว้ล่วงหน้าได้เพื่อไม่ต้องพิมพ์ใหม่ทุกครั้ง

```sh
PAYSO_MERCHANT_ID=12345678 PAYSO_TOKEN=xxxx node tools/payso-test/server.mjs
```

## ทำไมต้องมีเซิร์ฟเวอร์คั่น ไม่ยิงจากหน้าเว็บตรงๆ

สองเหตุผล — Payso ใช้ `Authorization: Bearer` ซึ่งเป็นความลับที่ไม่ควรอยู่ในเบราว์เซอร์ของใคร
และ Payso ไม่ได้เปิด CORS ให้เว็บอื่นเรียก เซิร์ฟเวอร์ตัวนี้ผูกกับ `127.0.0.1` อย่างเดียว
เครื่องอื่นในเครือข่ายเรียกไม่ได้

## สเปกที่ใช้อ้างอิง

| | |
|---|---|
| Endpoint | `POST https://apis.paysolutions.asia/tep/api/v2/promptpaynew` |
| พารามิเตอร์ | ส่งทาง query string ไม่ใช่ body |
| Header | `Authorization: Bearer <token>` · `Accept: application/json` |
| ฟิลด์ | `merchantID` 8 หลัก · `productDetail` · `customerEmail` · `customerName` · `total` ขั้นต่ำ 6 บาท · `referenceNo` 12 หลักห้ามซ้ำ |
| QR ที่ได้ | `data.image` เป็น base64 PNG พร้อม data URI ใช้ใส่ `<img src>` ได้เลย |
| หมดอายุ | `data.expiredate` ประมาณ 15 นาที เอกสารเตือนว่าบางครั้งส่งค่าว่างมา |

ข้อผิดพลาดที่เอกสารระบุไว้ — `{"message":"duplicate reference number"}`,
`{"message":"incomplete parameter"}` และแบบที่ตอบ `status: "error"` พร้อม `data` ที่ว่างทุกฟิลด์

## สิ่งที่เอกสารไม่ได้บอก

**Bearer token เอามาจากไหน** — หน้า PromptPay API มีหัวข้อ "Authorizations / Auth Key"
แต่ข้างในว่างเปล่า ส่วนหน้า Preparation บอกวิธีเอา MerchantID กับ Merchant Secret Key
จากหลังบ้าน (`controls.paysolutions.asia`) แต่ไม่ได้บอกว่าอันไหนคือ Bearer token

ลองเอา Secret Key มาใส่ก่อน ถ้าได้ HTTP 401 ให้ถาม Payso ตรงๆ (โทร 02-089-2869 หรือ LINE @payso)

**API เช็คสถานะใช้ auth คนละแบบ** — `POST /order/orderdetailpost` ใช้ header
`apikey` + `merchantSecretKey` + `merchantID` (5 หลักท้าย) ไม่ใช่ Bearer
และเอกสารเขียนว่า "Contact staff for apikey" คือต้องขอแยกอีกตัว

## ต่อจากนี้

เมื่อยืนยันว่าสร้าง QR ได้จริงแล้ว ขั้นถัดไปคือทำให้ Payso เป็นผู้ให้บริการตัวที่สองในระบบจริง
โดยเลือกได้ตอนเพิ่มเครื่อง — Stripe ยังอยู่เหมือนเดิม

## ผลทดสอบหา Bearer token (4 ก.ย. 2569)

ลองทุกชุดที่เป็นไปได้กับคีย์ที่ได้จากหลังบ้าน (Secret Key และ API Key) — **ไม่ผ่านสักแบบ**

| รูปแบบ | ผล |
|---|---|
| `Authorization: Bearer <secret key>` | 500 `authorization error` |
| `Authorization: Bearer <api key>` | 500 `authorization error` |
| `Authorization: Basic base64(...)` | 500 `authorization error` |
| `Authorization: Bearer base64(apikey:secret)` | 500 `authorization error` |
| `Authorization: Bearer base64(merchantID:secret)` | 500 `authorization error` |
| `apikey: <key>` อย่างเดียว ไม่มี Authorization | 500 `no Authorization` |

แถวสุดท้ายยืนยันว่า endpoint นี้อ่าน header `Authorization` จริง และบังคับต้องมี —
ต่างจาก endpoint อื่นของ Payso ที่ใช้ header `apikey` เฉยๆ

ลองหา endpoint ที่ออก token ด้วย (`/tep/api/v*/token`, `/authen`, `/auth/token`) ได้ 404 ทุกอัน

**ข้อสรุปเดิม (ยืนยันแล้วว่าถูก):** Bearer token เป็นคีย์คนละตัวกับ Secret Key และ API Key

## คำตอบ: Auth Key อยู่ในหลังบ้าน

Merchant Settings > Merchant Details > พารามิเตอร์คีย์ มีสามช่อง — Secret Key, API Key
และ **Auth Key** ช่องที่สามนี้คือตัวที่ใช้เป็น Bearer token ของ PromptPay API

ต่างจากอีกสองช่องตรงที่ไม่มีไอคอนรูปตาให้กดเปิดดู เพราะถ้ายังไม่ถูกออกให้ก็จะว่างเปล่า
ต้องติดต่อ Payso ให้ออกให้ (support@paysolutions.asia หรือ LINE @payso)

Auth Key เป็น JWT ลงนามด้วย RS256 ข้างในมี `sub` เป็นเลข 5 หลักท้ายของ MerchantID
และอายุยาวประมาณ 50 ปี — **ถือเป็นความลับระดับเดียวกับรหัสผ่าน ห้ามให้หลุด**

### ยืนยันว่าใช้ได้จริง

| ส่งอะไรไป | ได้อะไรกลับ |
|---|---|
| Bearer + token ปลอม | `{"message":"authorization error"}` |
| Bearer + Auth Key จริง | `{"message":"error : the shop is not open yet. Please contact the store."}` |

ข้อความที่ต่างกันพิสูจน์ว่า auth ผ่านแล้ว ที่ค้างอยู่เป็นเรื่องสถานะร้านค้าไม่ใช่เรื่องสิทธิ์
ทดสอบทั้งยอด 6 บาทและ 100 บาทได้ผลเหมือนกัน จำนวนเงินจึงไม่เกี่ยว

### ที่ต้องทำต่อ

"the shop is not open yet" แปลว่าบัญชีร้านค้ายังไม่ได้เปิดใช้บริการ QR/PromptPay
ต้องให้ Payso เปิดให้ก่อน หรือขอ Terminal ID ที่ Merchant Settings > TID
เมื่อเปิดแล้วหน้าเทสต์นี้จะสร้าง QR ได้ทันทีโดยไม่ต้องแก้อะไร


## แยกให้ชัดว่าติดตรงไหน (4 ก.ย. 2569)

หลังขอ Terminal ID มาแล้ว (`TID00001`, Service Type = **`normal-payment`**, สถานะ Active)
API `promptpaynew` ยังตอบ `the shop is not open yet` เหมือนเดิม

ลองยิงช่องทาง redirect ซึ่งเป็นคนละระบบกันเพื่อแยกสาเหตุ

```sh
POST https://payments.paysolutions.asia/payment
merchantid=89354342 refno=... total=10 channel=promptpay
```

ผลคือ `{"type":"success","status":200}` และใน payload มี `paymentResponse.error = false`
กับ `message = ""` — **ช่องทาง redirect รับ PromptPay ของร้านนี้ได้ปกติ**

แปลว่าบัญชีร้านค้าเปิด PromptPay ไว้แล้ว แต่ **API แบบ none-UI เป็นบริการแยกที่ยังไม่ได้เปิด**
ไม่ใช่ว่าร้านยังไม่เปิดทั้งร้านอย่างที่ข้อความ error สื่อ

หมายเหตุ: ช่องทาง redirect ใช้แทนกันไม่ได้ เพราะมันพาลูกค้าไปหน้าเว็บของ Payso
ส่วนเครื่อง PayBox ต้องการรูป QR มาแสดงบนจอเอง จึงต้องใช้ none-UI API เท่านั้น
