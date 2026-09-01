#!/bin/sh
# ช่วยหา TELEGRAM_CHAT_ID ตอนตั้งค่าครั้งแรก
#
# ใช้: telegram-chatid.sh [token]
# ถ้าไม่ใส่ token จะอ่านจาก /opt/paybox/alerts/env.alerts
#
# ต้องทักบอทอย่างน้อยหนึ่งข้อความก่อนรัน ไม่งั้น getUpdates จะว่างเปล่า
set -eu

ENV_FILE=/opt/paybox/alerts/env.alerts
TOKEN=${1:-}

if [ -z "$TOKEN" ] && [ -f "$ENV_FILE" ]; then
    TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')
fi

if [ -z "$TOKEN" ]; then
    echo "ยังไม่มี token — ใส่มาเป็นอาร์กิวเมนต์ หรือเติม TELEGRAM_BOT_TOKEN ใน $ENV_FILE ก่อน" >&2
    exit 1
fi

# แสดงเฉพาะ id กับชื่อ ไม่พิมพ์ token ออกมาไม่ว่ากรณีใด
curl -s --max-time 15 "https://api.telegram.org/bot$TOKEN/getUpdates" \
    | python3 -c '
import json, sys

try:
    data = json.load(sys.stdin)
except Exception:
    print("อ่านคำตอบจาก Telegram ไม่ได้ — ตรวจว่า token ถูกต้องไหม")
    raise SystemExit(1)

if not data.get("ok"):
    print("Telegram ปฏิเสธ:", data.get("description", "ไม่ทราบสาเหตุ"))
    raise SystemExit(1)

seen = {}
for u in data.get("result", []):
    chat = (u.get("message") or u.get("channel_post") or {}).get("chat")
    if chat:
        seen[chat["id"]] = chat.get("title") or " ".join(
            filter(None, [chat.get("first_name"), chat.get("last_name")])
        ) or chat.get("username") or chat.get("type")

if not seen:
    print("ยังไม่มีข้อความเข้ามา — ทักบอทสักข้อความหนึ่งก่อนแล้วรันใหม่")
    print("(ถ้าจะใช้กลุ่ม ต้องเชิญบอทเข้ากลุ่มแล้วพิมพ์ในกลุ่ม)")
else:
    print("เจอปลายทางที่ใช้ได้:")
    for cid, name in seen.items():
        print(f"  TELEGRAM_CHAT_ID={cid}   ({name})")
'
