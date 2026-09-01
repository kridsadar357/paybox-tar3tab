#!/bin/sh
# ส่งข้อความแจ้งเตือนของ PayBox ออกทุกช่องทางที่ตั้งค่า credential ไว้
#
# ใช้: notify.sh "ข้อความ"
#
# ช่องทางไหนยังไม่ได้ใส่ค่าใน .env.alerts ก็ข้ามไปเงียบๆ — ตั้งใจให้เปิด Telegram ใช้ก่อน
# แล้วเติม LINE ทีหลังได้โดยไม่ต้องแตะสคริปต์
#
# หลักที่ยึด: ไฟล์นี้ห้าม exit ด้วยค่าที่ไม่ใช่ศูนย์เพราะส่งข้อความไม่สำเร็จ ตัวเรียกคือ watch.sh
# ที่รันด้วย set -e ถ้าการส่งล้มเหลวลากมันตายไปด้วย เราจะเสียทั้งการแจ้งเตือนและตัวเฝ้าระวัง
# พร้อมกัน ซึ่งแย่กว่าการที่ข้อความหนึ่งข้อความหายไป
set -u

ENV_FILE=/opt/paybox/alerts/env.alerts
LOG=/opt/paybox/logs/alert.log

mkdir -p "$(dirname "$LOG")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

MSG=${1:-}
[ -n "$MSG" ] || { log "ถูกเรียกโดยไม่มีข้อความ"; exit 0; }

[ -f "$ENV_FILE" ] || { log "ไม่พบ $ENV_FILE จึงไม่ได้ส่ง: $MSG"; exit 0; }

# อ่านค่าทีละตัวแทนการ source ไฟล์ เพื่อไม่ให้ไฟล์ config สั่งรันอะไรได้ถ้ามันถูกแก้
cfg() {
    grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'\r'
}

TG_TOKEN=$(cfg TELEGRAM_BOT_TOKEN)
TG_CHAT=$(cfg TELEGRAM_CHAT_ID)
LINE_TOKEN=$(cfg LINE_CHANNEL_ACCESS_TOKEN)
LINE_TO=$(cfg LINE_TO)

SENT=0
TMP=$(mktemp)

# ---------- Telegram ----------
if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    # ส่งเป็นข้อความธรรมดา ไม่ตั้ง parse_mode เพราะชื่อร้านที่ลูกค้าตั้งเองอาจมี _ * [ ] ปนอยู่
    # ซึ่งจะทำให้ Markdown พังและ Telegram ปฏิเสธทั้งข้อความ
    CODE=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 15 \
        -X POST "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
        --data-urlencode "chat_id=$TG_CHAT" \
        --data-urlencode "text=$MSG" 2>/dev/null) || CODE=000
    if [ "$CODE" = "200" ]; then
        SENT=$((SENT + 1))
    else
        # log แค่รหัสตอบกลับกับคำอธิบาย ไม่มีทางที่ token จะหลุดออกมาทางนี้
        log "Telegram ล้มเหลว (HTTP $CODE): $(head -c 300 "$TMP" 2>/dev/null)"
    fi
fi

# ---------- LINE Messaging API ----------
# หมายเหตุ: LINE Notify ปิดบริการไปแล้วเมื่อ 31 มี.ค. 2568 ตัวที่ยังใช้ได้คือ Messaging API
# ซึ่งต้องสร้าง channel ใน LINE Developers Console แล้วเอา channel access token มาใส่
if [ -n "$LINE_TOKEN" ] && [ -n "$LINE_TO" ]; then
    # ประกอบ JSON ด้วย python3 แทนการต่อสตริงเอง เพราะข้อความมีชื่อร้านภาษาไทยและอาจมี
    # อัญประกาศหรือขึ้นบรรทัดใหม่ปนมา ซึ่งจะทำให้ JSON ที่ต่อเองพัง
    BODY=$(MSG="$MSG" LINE_TO="$LINE_TO" python3 -c 'import json, os, sys
sys.stdout.write(json.dumps({
    "to": os.environ["LINE_TO"],
    "messages": [{"type": "text", "text": os.environ["MSG"][:4900]}],
}, ensure_ascii=False))' 2>/dev/null) || BODY=""

    if [ -n "$BODY" ]; then
        CODE=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 15 \
            -X POST https://api.line.me/v2/bot/message/push \
            -H "Authorization: Bearer $LINE_TOKEN" \
            -H 'Content-Type: application/json' \
            --data-binary "$BODY" 2>/dev/null) || CODE=000
        if [ "$CODE" = "200" ]; then
            SENT=$((SENT + 1))
        else
            log "LINE ล้มเหลว (HTTP $CODE): $(head -c 300 "$TMP" 2>/dev/null)"
        fi
    else
        log "LINE: ประกอบ JSON ไม่สำเร็จ"
    fi
fi

rm -f "$TMP"

if [ "$SENT" -eq 0 ]; then
    log "ไม่มีช่องทางใดส่งสำเร็จ ข้อความที่ตกหล่น: $MSG"
else
    log "ส่งสำเร็จ $SENT ช่องทาง: $(echo "$MSG" | head -1)"
fi

exit 0
