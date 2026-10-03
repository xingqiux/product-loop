#!/bin/bash
# 把样页都重新生成一遍，再替人把所有场景走一遍。用法：scripts/use/walk-all.sh <样页所在的文件夹> <输出目录>
# 有一个场景没走通就以失败退出，给 land.py 的 red / green 用
set -eo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"; F="$1"; OUT="$2"; mkdir -p "$OUT"
# 样页自己带队列数据就用它；没带就用仓库里那份空的，干净克隆也跑得起来
Q="$F/队列.json"; [ -f "$Q" ] || Q="$HERE/templates/队列.json"
for n in fixture fixture-spec fixture-scenes fixture-land; do python3 "$HERE/scripts/build-report.py" "$F/$n.json" "$OUT/$n.html" "$Q" >/dev/null 2>&1 || { echo "生成不出来：$n"; exit 1; }; done
node "$HERE/scripts/use/walk-report.mjs" "$OUT/fixture.html" "$OUT/walk" "$F/fixture-use.html" "$OUT/fixture-scenes.html" "$OUT/fixture-spec.html" "$OUT/fixture-land.html" | tee "$OUT/walk.txt"
[ -s "$OUT/walk.txt" ] || { echo "走查脚本没有留下任何结果"; exit 1; }
! grep -qv "^走通" "$OUT/walk.txt"
