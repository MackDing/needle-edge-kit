#!/bin/bash
# Usage from PowerShell:
#   wsl bash /mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/ask.sh "明天加班半天"

set -e
QUERY="${1:-请年假明天}"

source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

CKPT=/home/mack/ngpu-ckpts/needle_finetuned_20260514182554_29076_12_512_best.pkl
TOOLS_FILE=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/tools/oa_tools.json
TOOLS=$(cat "$TOOLS_FILE")

echo "Q: $QUERY"
echo -n "→ "
needle run --checkpoint "$CKPT" --query "$QUERY" --tools "$TOOLS" 2>/dev/null | tail -1
