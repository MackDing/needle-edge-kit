#!/bin/bash
# v2 finetune: 5000 samples × 5 epochs · target call_f1 ≥ 0.80
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1
export XLA_PYTHON_CLIENT_PREALLOCATE=false
export XLA_PYTHON_CLIENT_MEM_FRACTION=0.85
export NEEDLE_EVAL_BATCH=8

LOG=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v2_finetune.log
ERR=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v2_finetune.err.log
CKPTS=/home/mack/ngpu-ckpts-v2

mkdir -p "$CKPTS"
[ -s "$LOG" ] && mv "$LOG" "${LOG}.$(date +%H%M%S).bak"
[ -s "$ERR" ] && mv "$ERR" "${ERR}.$(date +%H%M%S).bak"
echo "v2 finetune launched at $(date)" > "$LOG"

exec needle finetune \
    /mnt/c/D/CLPS/Code/Github/needle-edge-kit/examples/oa_train_v2.jsonl \
    --epochs 5 \
    --batch-size 32 \
    --checkpoint-dir "$CKPTS" \
    --max-enc-len 512 \
    --max-dec-len 128 \
    >> "$LOG" 2>> "$ERR"
