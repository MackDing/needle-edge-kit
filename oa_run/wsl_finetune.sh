#!/bin/bash
# Run from WSL Ubuntu 24.04. Uses GPU venv at /home/mack/ngpu.
# Logs go to /mnt/c/... so they're visible from Windows.

source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1
export XLA_PYTHON_CLIENT_PREALLOCATE=false
export XLA_PYTHON_CLIENT_MEM_FRACTION=0.85    # cap JAX at 85% (leave 1.2GB headroom)
export NEEDLE_EVAL_BATCH=8                    # smaller seq → more eval headroom

LOG=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/gpu_finetune.log
ERR=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/gpu_finetune.err.log

# Checkpoints stay on Linux fs (faster IO than /mnt/c).
# Keep prior runs — only roll the log so it doesn't grow unbounded.
CKPTS=/home/mack/ngpu-ckpts
mkdir -p "$CKPTS"
[ -s "$LOG" ] && mv "$LOG" "${LOG}.$(date +%H%M%S).bak" || true
[ -s "$ERR" ] && mv "$ERR" "${ERR}.$(date +%H%M%S).bak" || true
echo "GPU finetune launched at $(date)" > "$LOG"

exec needle finetune \
    /mnt/c/D/CLPS/Code/Github/needle-edge-kit/examples/oa_train.jsonl \
    --epochs 3 \
    --batch-size 32 \
    --checkpoint-dir "$CKPTS" \
    --max-enc-len 512 \
    --max-dec-len 128 \
    >> "$LOG" 2>> "$ERR"
