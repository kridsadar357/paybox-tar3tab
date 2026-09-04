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
