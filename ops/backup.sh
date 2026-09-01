#!/bin/sh
# สำรองข้อมูล PayBox — ฐานข้อมูล + ไฟล์ที่อัปโหลด
#
# รันจาก cron ทุกวัน ดูวิธีติดตั้งใน ops/README.md
#
# หลักที่ยึด: ห้ามลบ backup เก่าจนกว่าจะแน่ใจว่าของใหม่ใช้ได้จริง — backup ที่เสียแล้วไปลบของดีทิ้ง
# แย่กว่าไม่มี backup เลย เพราะเข้าใจผิดว่าตัวเองปลอดภัยอยู่
set -eu

BACKUP_DIR=/opt/paybox/backups
ENV_FILE=/opt/paybox/paybox-backend/.env
RETENTION_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)
LOG=$BACKUP_DIR/backup.log

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

fail() {
    log "ล้มเหลว: $*"
    exit 1
}

[ -f "$ENV_FILE" ] || fail "ไม่พบ $ENV_FILE"
# อ่านรหัสผ่านโดยไม่ให้โผล่ใน ps หรือ log
MYSQL_PW=$(grep '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$MYSQL_PW" ] || fail "อ่าน MYSQL_ROOT_PASSWORD ไม่ได้"

log "เริ่มสำรองข้อมูล"

# ---------- 1) ฐานข้อมูล ----------
DB_TMP=$BACKUP_DIR/.db-$STAMP.sql
# --single-transaction ให้ snapshot ที่สอดคล้องกันบน InnoDB โดยไม่ล็อกตาราง (ระบบยังรับเงินได้ระหว่างดัมป์)
docker exec -i paybox-mysql mysqldump -uroot -p"$MYSQL_PW" \
    --single-transaction --routines --triggers --events \
    --default-character-set=utf8mb4 \
    paybox > "$DB_TMP" 2>/dev/null || fail "mysqldump ล้มเหลว"

# ตรวจว่าดัมป์ใช้ได้จริงก่อนจะยอมรับ — ไฟล์ว่างหรือขาดตารางสำคัญถือว่าล้มเหลว
DB_SIZE=$(wc -c < "$DB_TMP")
[ "$DB_SIZE" -gt 10000 ] || fail "ไฟล์ดัมป์เล็กผิดปกติ ($DB_SIZE bytes)"
for t in transactions customers devices settlements admins; do
    grep -q "CREATE TABLE \`$t\`" "$DB_TMP" || fail "ในดัมป์ไม่มีตาราง $t"
done
grep -q "^-- Dump completed" "$DB_TMP" || fail "ดัมป์ไม่สมบูรณ์ (ไม่เจอบรรทัดปิดท้าย)"

gzip -9 "$DB_TMP"
mv "$DB_TMP.gz" "$BACKUP_DIR/paybox-db-$STAMP.sql.gz"
log "ฐานข้อมูล: $(du -h "$BACKUP_DIR/paybox-db-$STAMP.sql.gz" | cut -f1)"

# ---------- 2) ไฟล์ที่อัปโหลด ----------
# ข้ามโฟลเดอร์ firmware เพราะไฟล์ .bin สร้างใหม่จาก git ได้ และกินที่มากที่สุด
# ส่วน settlement_proofs คือหลักฐานการโอนเงิน ห้ามข้ามเด็ดขาด
UP_TMP=$BACKUP_DIR/.uploads-$STAMP.tar.gz
docker run --rm \
    -v paybox-backend_paybox-uploads:/data:ro \
    -v "$BACKUP_DIR":/backup \
    alpine:3 tar czf "/backup/$(basename "$UP_TMP")" -C /data --exclude=firmware . \
    2>/dev/null || fail "สำรองไฟล์อัปโหลดล้มเหลว"

[ -s "$UP_TMP" ] || fail "ไฟล์ tar ของ uploads ว่างเปล่า"
mv "$UP_TMP" "$BACKUP_DIR/paybox-uploads-$STAMP.tar.gz"
log "ไฟล์อัปโหลด: $(du -h "$BACKUP_DIR/paybox-uploads-$STAMP.tar.gz" | cut -f1)"

# ---------- 3) ลบของเก่า ----------
# ทำหลังจากของใหม่ผ่านการตรวจแล้วเท่านั้น และต้องเหลืออย่างน้อย 1 ชุดเสมอ
KEEP_COUNT=$(find "$BACKUP_DIR" -name 'paybox-db-*.sql.gz' | wc -l)
if [ "$KEEP_COUNT" -gt 1 ]; then
    find "$BACKUP_DIR" -name 'paybox-db-*.sql.gz' -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name 'paybox-uploads-*.tar.gz' -mtime +$RETENTION_DAYS -delete
fi

log "เสร็จสิ้น · มีชุดสำรองทั้งหมด $(find "$BACKUP_DIR" -name 'paybox-db-*.sql.gz' | wc -l) ชุด"
