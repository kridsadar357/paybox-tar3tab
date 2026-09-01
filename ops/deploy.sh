#!/bin/sh
# ปล่อยของขึ้น production จาก git
#
# ใช้: deploy.sh          ดึงโค้ดล่าสุดแล้ว build ใหม่
#      FORCE=1 deploy.sh  ทิ้งการแก้ไขที่ค้างอยู่บนเซิร์ฟเวอร์ด้วย
#
# มีขึ้นแทนการ scp ไฟล์ขึ้นมาทีละไฟล์ ซึ่งเมื่อ 28 ส.ค. 2569 ทำให้บรรทัด STRIPE_WEBHOOK_SECRET
# ใน docker-compose.yml หายไปเงียบๆ เพราะไฟล์ที่ส่งขึ้นมาเก่ากว่าของบนเครื่อง — git ทำให้ความต่าง
# แบบนั้นกลายเป็นสิ่งที่มองเห็นได้ แทนที่จะเป็นสิ่งที่หายไปโดยไม่มีใครรู้
set -eu

# URL สาธารณะของระบบ ตั้งทับด้วย environment variable ได้ เพื่อให้สคริปต์ใช้กับโดเมนอื่นได้
PAYBOX_URL=${PAYBOX_URL:-https://orca-paybox.com}

ROOT=/opt/paybox/platform

[ -d "$ROOT/.git" ] || { echo "!! $ROOT ไม่ใช่ git clone"; exit 1; }

# ถ้ามีใครแก้ไฟล์คาไว้บนเซิร์ฟเวอร์ ต้องหยุดให้เห็นก่อน ไม่ใช่ทับทิ้งเงียบๆ
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "!! มีไฟล์ที่ถูกแก้บนเซิร์ฟเวอร์แต่ยังไม่ได้ commit:"
    git -C "$ROOT" status --short | sed 's/^/     /'
    if [ "${FORCE:-0}" != "1" ]; then
        echo "   ถ้าตั้งใจจะทิ้งของพวกนี้ ให้รัน FORCE=1 deploy.sh"
        exit 1
    fi
    echo "   FORCE=1 — ทิ้งตามที่สั่ง"
fi

echo "== ดึงโค้ด =="
git -C "$ROOT" fetch --quiet origin
OLD=$(git -C "$ROOT" rev-parse --short HEAD)
git -C "$ROOT" reset --hard --quiet origin/main
NEW=$(git -C "$ROOT" rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ]; then
    echo "   ไม่มีอะไรใหม่ ($NEW)"
else
    echo "   $OLD -> $NEW"
    git -C "$ROOT" --no-pager log --oneline "$OLD..$NEW" | sed 's/^/     /'
fi

echo "== build =="
cd "$ROOT"
docker compose build backend
docker compose up -d backend

echo "== ตรวจว่ากลับมาแล้ว =="
i=0
while [ "$i" -lt 20 ]; do
    if curl -fsS --max-time 5 "$PAYBOX_URL" 2>/dev/null | grep -q '"ok":true'; then
        echo "   เว็บตอบปกติ ($NEW)"
        exit 0
    fi
    i=$((i + 1))
    sleep 2
done

# ไม่ย้อน image อัตโนมัติ เพราะการย้อนโค้ดโดยยังไม่รู้สาเหตุอาจทำให้สถานะฐานข้อมูลกับโค้ด
# ไม่ตรงกัน ซึ่งแก้ยากกว่าปัญหาเดิม — บอกให้คนตัดสินใจดีกว่า
echo "!! เว็บยังไม่ตอบหลังรอ 40 วินาที"
echo "   ดู log:    docker logs --tail 50 paybox-backend"
echo "   ย้อนกลับ:  git -C $ROOT reset --hard $OLD && $ROOT/ops/deploy.sh"
exit 1
