#!/bin/sh
# ทดสอบว่าไฟล์สำรองล่าสุดกู้คืนได้จริง
#
# backup ที่ไม่เคยลองกู้ ไม่นับว่าเป็น backup — วิธีเดียวที่จะรู้ว่าใช้ได้คือกู้มันจริงๆ
# สคริปต์นี้กู้ลงฐานข้อมูลชั่วคราวแยกต่างหาก แล้วเทียบจำนวนแถวกับของจริง
# ไม่แตะฐานข้อมูล production ไม่ว่ากรณีใด
set -eu

BACKUP_DIR=/opt/paybox/backups
ENV_FILE=/opt/paybox/paybox-backend/.env
TEST_DB=paybox_restore_test

MYSQL_PW=$(grep '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
LATEST=$(ls -1t "$BACKUP_DIR"/paybox-db-*.sql.gz 2>/dev/null | head -1)
[ -n "$LATEST" ] || { echo "!! ไม่พบไฟล์สำรอง"; exit 1; }

echo "ไฟล์ที่ทดสอบ: $(basename "$LATEST")  ($(du -h "$LATEST" | cut -f1))"
echo

mysql_exec() {
    docker exec -i paybox-mysql mysql -uroot -p"$MYSQL_PW" "$@" 2>/dev/null
}

echo "== กู้คืนลงฐานข้อมูลชั่วคราว $TEST_DB =="
mysql_exec -e "DROP DATABASE IF EXISTS $TEST_DB; CREATE DATABASE $TEST_DB CHARACTER SET utf8mb4;"
gunzip -c "$LATEST" | docker exec -i paybox-mysql mysql -uroot -p"$MYSQL_PW" "$TEST_DB" 2>/dev/null
echo "   กู้คืนสำเร็จ"
echo

echo "== เทียบจำนวนแถวกับฐานข้อมูลจริง =="
printf '   %-20s %10s %10s   %s\n' "ตาราง" "production" "ที่กู้มา" "ผล"
STATUS=0
for t in transactions customers devices settlements admins audit_log device_commands firmware_releases; do
    A=$(mysql_exec -N -e "SELECT COUNT(*) FROM paybox.$t;" || echo "?")
    B=$(mysql_exec -N -e "SELECT COUNT(*) FROM $TEST_DB.$t;" || echo "?")
    if [ "$A" = "$B" ]; then R="ตรงกัน"; else R="<<< ไม่ตรง"; STATUS=1; fi
    printf '   %-20s %10s %10s   %s\n' "$t" "$A" "$B" "$R"
done
echo

echo "== ตรวจว่าข้อมูลการเงินอ่านออกจริง ไม่ใช่แค่จำนวนแถวตรง =="
mysql_exec -e "SELECT
  COUNT(*) AS succeeded,
  ROUND(SUM(amount),2) AS gross,
  ROUND(SUM(net_amount),2) AS net
FROM $TEST_DB.transactions WHERE status='succeeded';" | sed 's/^/   /'
echo "   (ต้องตรงกับ production ด้านล่าง)"
mysql_exec -e "SELECT
  COUNT(*) AS succeeded,
  ROUND(SUM(amount),2) AS gross,
  ROUND(SUM(net_amount),2) AS net
FROM paybox.transactions WHERE status='succeeded';" | sed 's/^/   /'
echo

echo "== ตรวจภาษาไทยไม่เพี้ยนหลังกู้ =="
mysql_exec -N -e "SELECT CONCAT('   ชื่อลูกค้าที่กู้มา: ', name) FROM $TEST_DB.customers LIMIT 3;"
echo

echo "== ลบฐานข้อมูลทดสอบทิ้ง =="
mysql_exec -e "DROP DATABASE $TEST_DB;"
echo "   ลบแล้ว"
echo
[ "$STATUS" -eq 0 ] && echo "ผลรวม: กู้คืนได้ ครบถ้วน" || echo "ผลรวม: !! มีตารางที่จำนวนแถวไม่ตรง"
exit $STATUS
