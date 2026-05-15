#!/bin/bash
# v3 finetune: 5000 samples × 5 epochs with ~30% no-tool ratio
# Target: FP-rate ≤ 10% on OOD queries
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1
export XLA_PYTHON_CLIENT_PREALLOCATE=false
export XLA_PYTHON_CLIENT_MEM_FRACTION=0.85
export NEEDLE_EVAL_BATCH=8

LOG=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v3_finetune.log
ERR=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v3_finetune.err.log
CKPTS=/home/mack/ngpu-ckpts-v3

mkdir -p "$CKPTS"
[ -s "$LOG" ] && mv "$LOG" "${LOG}.$(date +%H%M%S).bak"
[ -s "$ERR" ] && mv "$ERR" "${ERR}.$(date +%H%M%S).bak"
echo "v3 finetune launched at $(date)" > "$LOG"

exec needle finetune \
    /mnt/c/D/CLPS/Code/Github/needle-edge-kit/examples/oa_train_v3.jsonl \
    --epochs 5 \
    --batch-size 32 \
    --checkpoint-dir "$CKPTS" \
    --max-enc-len 512 \
    --max-dec-len 128 \
    >> "$LOG" 2>> "$ERR"
