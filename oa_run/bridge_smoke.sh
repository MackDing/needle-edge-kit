#!/bin/bash
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1
CKPT=/home/mack/ngpu-ckpts/needle_finetuned_20260514182554_29076_12_512_best.pkl
TOOLS=$(cat /mnt/c/D/CLPS/Code/Github/needle-edge-kit/tools/oa_tools.json | python -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")
REQ=$(python -c "import json; print(json.dumps({'id':1,'query':'明天请年假','tools':$TOOLS}))")
echo "$REQ" | timeout 60 python -u /mnt/c/D/CLPS/Code/Github/needle-edge-kit/desktop/needle_bridge.py --checkpoint "$CKPT" 2>&1
