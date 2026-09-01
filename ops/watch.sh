#!/bin/sh
# เฝ้าระวัง PayBox — เว็บล่ม ฐานข้อมูลล่ม หรือเครื่องรับเงินหยุดส่ง heartbeat
#
# รันจาก cron ทุก 5 นาที ดูวิธีติดตั้งใน ops/README.md
#
# ทำไมรันบน host ไม่ใช่ข้างใน backend: สิ่งที่ต้องเฝ้ารวมถึงตัว backend เอง ถ้าเอาตัวเฝ้าไปไว้
# ข้างในนั้น พอ container ตายตัวเฝ้าก็ตายไปด้วยและไม่มีใครรู้ — cron บน host อยู่คนละชั้นกับ
# สิ่งที่มันเฝ้าอยู่ จึงยังรายงานได้แม้ container ล่มทั้งตัว
#
# แจ้งเฉพาะตอนสถานะ "เปลี่ยน" ไม่ใช่ทุกรอบที่ยังเจอปัญหา เพราะการเตือนที่ดังทุก 5 นาที
# จะถูกปิดเสียงภายในวันเดียว แล้วหลังจากนั้นก็ไม่เหลือการเตือนอีกเลย
set -eu

# URL สาธารณะของระบบ ตั้งทับด้วย environment variable ได้ เพื่อให้สคริปต์ใช้กับโดเมนอื่นได้
PAYBOX_URL=${PAYBOX_URL:-https://orca-paybox.com}

ENV_FILE=/opt/paybox/paybox-backend/.env
STATE_DIR=/opt/paybox/state
LOG=/opt/paybox/logs/watch.log
NOTIFY=/opt/paybox/scripts/notify.sh
HEALTH_URL="$PAYBOX_URL"

# heartbeat ตั้งไว้ทุก 60 วินาที ให้อภัยได้ถึง 10 นาทีก่อนถือว่าหาย — เผื่อเน็ตร้านสะดุดชั่วครู่
# โดยไม่ต้องปลุกใคร แต่ยังรู้เร็วพอที่จะแก้ก่อนร้านเปิดรอบถัดไป
OFFLINE_MINUTES=10
# ถ้ายังเสียอยู่ ย้ำอีกครั้งทุก 12 ชั่วโมง กันเรื่องที่ค้างข้ามวันแล้วถูกลืม
REMIND_HOURS=12

mkdir -p "$STATE_DIR" "$(dirname "$LOG")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

notify() {
    log "แจ้งเตือน: $(echo "$1" | head -1)"
    sh "$NOTIFY" "$1" || true
}

# บันทึกสถานะของสิ่งที่เฝ้าอยู่หนึ่งอย่าง แล้วแจ้งเมื่อสถานะเปลี่ยน หรือเมื่อยังเสียอยู่และเงียบมานาน
#   report <คีย์> <up|down> <ข้อความ>
# ไฟล์สถานะเก็บว่า "<สถานะ> <เวลาที่แจ้งครั้งล่าสุด>" เวลาที่เก็บคือเวลาที่แจ้ง ไม่ใช่เวลาที่ตรวจ
# เพื่อให้ระยะห่างของการย้ำนับจากครั้งที่ผู้รับได้ยินจริง
report() {
    key=$1
    status=$2
    message=$3
    file="$STATE_DIR/$(printf '%s' "$key" | tr -c 'A-Za-z0-9_.-' '_').state"

    prev=""
    prev_at=0
    if [ -f "$file" ]; then
        prev=$(cut -d' ' -f1 "$file" 2>/dev/null || echo "")
        prev_at=$(cut -d' ' -f2 "$file" 2>/dev/null || echo 0)
        case $prev_at in
            ''|*[!0-9]*) prev_at=0 ;;
        esac
    fi

    now=$(date +%s)

    # ครั้งแรกสุดที่เห็นคีย์นี้และทุกอย่างปกติ — จดไว้เฉยๆ ไม่ต้องประกาศว่า "ปกติ"
    # ไม่งั้นตอนติดตั้งเสร็จจะมีข้อความรัวเข้ามาชุดหนึ่งโดยไม่มีเหตุ
    if [ -z "$prev" ] && [ "$status" = "up" ]; then
        echo "up $now" > "$file"
        return 0
    fi

    if [ "$prev" != "$status" ]; then
        notify "$message"
        echo "$status $now" > "$file"
        return 0
    fi

    if [ "$status" = "down" ] && [ $((now - prev_at)) -ge $((REMIND_HOURS * 3600)) ]; then
        notify "$message"
        echo "$status $now" > "$file"
    fi
}

# ---------- 1) เว็บตอบสนองไหม ----------
# ยิงผ่าน URL สาธารณะจริง ไม่ใช่ยิงเข้า container ตรงๆ เพราะสิ่งที่ต้องรู้คือ "ลูกค้าใช้ได้ไหม"
# ซึ่งรวม DNS, Traefik และใบรับรองเข้าไปด้วย ไม่ใช่แค่โปรเซสยังไม่ตาย
if curl -fsS --max-time 15 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
    report backend up "🟢 PayBox: เว็บกลับมาแล้ว
$HEALTH_URL ตอบสนองปกติ"
else
    report backend down "🔴 PayBox: เว็บไม่ตอบสนอง
$HEALTH_URL เรียกไม่ขึ้น — ลูกค้าจ่ายเงินไม่ได้จนกว่าจะกลับมา"
fi

# ---------- 2) ฐานข้อมูล ----------
MYSQL_PW=""
if [ -f "$ENV_FILE" ]; then
    MYSQL_PW=$(grep '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || echo "")
fi

DB_OK=0
if [ -n "$MYSQL_PW" ]; then
    # ส่งรหัสผ่านทาง MYSQL_PWD แทน -p เพื่อไม่ให้โผล่ใน process list ของ container
    if docker exec -e MYSQL_PWD="$MYSQL_PW" paybox-mysql \
        mysqladmin ping -uroot --silent >/dev/null 2>&1; then
        DB_OK=1
    fi
else
    log "อ่าน MYSQL_ROOT_PASSWORD ไม่ได้จาก $ENV_FILE"
fi

if [ "$DB_OK" = "1" ]; then
    report mysql up "🟢 PayBox: ฐานข้อมูลกลับมาแล้ว"
else
    report mysql down "🔴 PayBox: ต่อฐานข้อมูลไม่ได้
paybox-mysql ไม่ตอบ ping — รายการชำระเงินใหม่จะบันทึกไม่ได้"
fi

# ---------- 3) เครื่องที่ควรออนไลน์ ----------
# ตรวจเฉพาะเมื่อฐานข้อมูลใช้ได้ ถ้า DB ล่มแล้วยังเดินต่อ เราจะประกาศว่าเครื่องทุกตัวหายพร้อมกัน
# ทั้งที่ความจริงคือเรามองไม่เห็นมันต่างหาก — การเตือนที่ผิดทำลายความน่าเชื่อถือของการเตือนที่เหลือ
if [ "$DB_OK" = "1" ]; then
    # เอาเฉพาะเครื่องที่แอดมินเปิดสวิตช์ไว้ และเคยติดต่อเข้ามาแล้วอย่างน้อยหนึ่งครั้ง
    # เครื่องที่ยังไม่เคยแฟลชหรือถูกปิดไว้ ไม่ใช่ความผิดปกติ จึงไม่ควรส่งเสียง
    DEVICES=$(docker exec -i -e MYSQL_PWD="$MYSQL_PW" paybox-mysql \
        mysql --default-character-set=utf8mb4 -uroot -N -B paybox -e "
            SELECT id,
                   name,
                   TIMESTAMPDIFF(MINUTE, last_seen_at, UTC_TIMESTAMP()),
                   DATE_FORMAT(DATE_ADD(last_seen_at, INTERVAL 7 HOUR), '%Y-%m-%d %H:%i')
            FROM devices
            WHERE is_active = 1 AND last_seen_at IS NOT NULL;" 2>/dev/null || echo "")

    printf '%s\n' "$DEVICES" | while IFS='	' read -r id name mins seen; do
        [ -n "${id:-}" ] || continue
        case $mins in
            ''|*[!0-9]*) continue ;;
        esac

        if [ "$mins" -ge "$OFFLINE_MINUTES" ]; then
            report "device_$id" down "🔴 PayBox: เครื่องเงียบไป $mins นาที
$name (#$id)
heartbeat ล่าสุด $seen น."
        else
            report "device_$id" up "🟢 PayBox: เครื่องกลับมาแล้ว
$name (#$id)"
        fi
    done
fi

# ไม่ log ทุกรอบที่ผ่านปกติ — 288 บรรทัดต่อวันจะกลบบรรทัดที่มีความหมายจริงจนหาไม่เจอ
# บันทึกแค่เวลาที่ตรวจล่าสุดไว้ในไฟล์เดียว ให้คนตรวจได้ว่า cron ยังเดินอยู่จริงไหม
date '+%Y-%m-%d %H:%M:%S' > "$STATE_DIR/last-run"
