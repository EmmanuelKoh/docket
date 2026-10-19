#!/bin/zsh
# Every layer the Slips feed module uses, both themes, then post and pack into public/hardware/feed (about 45 min on a
# 10-core Mac, CPU). The head unit's column at 11 window heights, the rod and way strip, the two supports, the drive's
# 48 angles. Edges in each part's own material (BK_EDGE=face). BLENDER overrides the app's path.
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BK_EDGE=face
mkdir -p out
YS=-370,-245,-120,5,130,255,380,505,630,755,880
for t in light dark; do
  LAYERS=$YS HEAD_X=928 $BL -b --factory-startup --python build.py -- $t 128 2 col > out/log_col_$t.txt 2>&1
  HIDE_HEAD=1 HIDE_SUP=1 PAPER=0 HEAD_X=928 HEAD_Y=260 MECH_TOP=-400 MECH_H=2400 CROP=898,-40,430,1680 \
    $BL -b --factory-startup --python build.py -- $t 128 2 strip > out/log_strip_$t.txt 2>&1
  HIDE_HEAD=1 ROD_HOLD=1 PAPER=0 HEAD_X=928 HEAD_Y=357.5 MECH_TOP=237 CROP=898,120,430,320 \
    $BL -b --factory-startup --python build.py -- $t 128 2 supa > out/log_supa_$t.txt 2>&1
  HIDE_HEAD=1 ROD_HOLD=1 PAPER=0 HEAD_X=928 HEAD_Y=260 MECH_TOP=-457.6 CROP=898,600,430,320 \
    $BL -b --factory-startup --python build.py -- $t 128 2 supb > out/log_supb_$t.txt 2>&1
  ROLL=48 HEAD_X=928 HEAD_Y=260 $BL -b --factory-startup --python build.py -- $t 96 2 roll > out/log_roll_$t.txt 2>&1
  grep -hE "DONE|Traceback" out/log_col_$t.txt out/log_strip_$t.txt out/log_supa_$t.txt out/log_supb_$t.txt out/log_roll_$t.txt
done
python3 post.py light col && python3 post.py dark col && python3 deckpost.py strip supa supb && python3 deck.py && python3 pack.py
echo ALL DONE
