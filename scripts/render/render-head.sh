#!/bin/zsh
# Only the head unit's column and the drive's angles (the deck unchanged), both themes, then post and pack (about 30
# min). For changes to the carriage, the printer, the cable or the drive.
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BK_EDGE=face
mkdir -p out
YS=-370,-245,-120,5,130,255,380,505,630,755,880
for t in light dark; do
  LAYERS=$YS HEAD_X=928 $BL -b --factory-startup --python build.py -- $t 128 2 col > out/log_col_$t.txt 2>&1
  ROLL=48 HEAD_X=928 HEAD_Y=260 $BL -b --factory-startup --python build.py -- $t 96 2 roll > out/log_roll_$t.txt 2>&1
  grep -hE "DONE|Traceback" out/log_col_$t.txt out/log_roll_$t.txt
done
python3 post.py light col && python3 post.py dark col && python3 pack.py
echo ALL DONE
