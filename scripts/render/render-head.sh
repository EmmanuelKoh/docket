#!/bin/zsh
# Only the head unit's column and the drive's angles (the deck unchanged), both themes, then post and pack (about 20
# min). For changes to the carriage, the printer, the cable or the drive. Same failure rules as render-all.sh; the
# deck's images must already be in this version's folder (copy them over when you bump version.txt).
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BK_EDGE=face
rm -rf layers; mkdir -p out
render() {
  local log=out/log_$1.txt; shift
  env "$@" > $log 2>&1 || { echo "FAILED: Blender exited non-zero, see $log"; exit 1; }
  grep -q "^DONE" $log || { echo "FAILED: no DONE line in $log"; tail -5 $log; exit 1; }
  grep -h "^DONE" $log
}
YS=-370,-245,-120,5,130,255,380,505,630,755,880
for t in light dark; do
  render col_$t LAYERS=$YS HEAD_X=928 $BL -b --factory-startup --python build.py -- $t 128 2 col
  render roll_$t ROLL=48 HEAD_X=928 HEAD_Y=260 $BL -b --factory-startup --python build.py -- $t 96 2 roll
done
python3 post.py light col && python3 post.py dark col && python3 pack.py || { echo "FAILED: post or pack"; exit 1; }
echo ALL DONE
