#!/bin/zsh
# Every layer the Slips feed module uses, both themes, then post and pack into public/hardware/feed/<version.txt>
# (about 32 min on a 10-core Mac, CPU). The head unit's column at 11 window heights, the rod and way strip, the two
# supports, the drive's 48 angles. Edges in each part's own material (BK_EDGE=face). BLENDER overrides the app's path.
# Stops at the first failed render or step; prints ALL DONE only when everything worked.
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BK_EDGE=face
rm -rf layers deck; mkdir -p out
render() {   # render <log name> <env and args...>: run Blender, fail unless its log ends with a DONE line
  local log=out/log_$1.txt; shift
  env "$@" > $log 2>&1 || { echo "FAILED: Blender exited non-zero, see $log"; exit 1; }
  grep -q "^DONE" $log || { echo "FAILED: no DONE line in $log"; tail -5 $log; exit 1; }
  grep -h "^DONE" $log
}
YS=-370,-245,-120,5,130,255,380,505,630,755,880
for t in light dark; do
  render col_$t LAYERS=$YS HEAD_X=928 $BL -b --factory-startup --python build.py -- $t 128 2 col
  render strip_$t HIDE_HEAD=1 HIDE_SUP=1 PAPER=0 HEAD_X=928 HEAD_Y=260 MECH_TOP=-400 MECH_H=2400 CROP=898,-40,430,1680 \
    $BL -b --factory-startup --python build.py -- $t 128 2 strip
  render supa_$t HIDE_HEAD=1 ROD_HOLD=1 PAPER=0 HEAD_X=928 HEAD_Y=357.5 MECH_TOP=237 CROP=898,120,430,320 \
    $BL -b --factory-startup --python build.py -- $t 128 2 supa
  render supb_$t HIDE_HEAD=1 ROD_HOLD=1 PAPER=0 HEAD_X=928 HEAD_Y=260 MECH_TOP=-457.6 CROP=898,600,430,320 \
    $BL -b --factory-startup --python build.py -- $t 128 2 supb
  render roll_$t ROLL=48 HEAD_X=928 HEAD_Y=260 $BL -b --factory-startup --python build.py -- $t 96 2 roll
done
python3 post.py light col && python3 post.py dark col && python3 deckpost.py strip supa supb && python3 deck.py \
  && python3 pack.py || { echo "FAILED: post or pack"; exit 1; }
echo ALL DONE
