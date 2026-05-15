# End-to-end OA v2: merge scenarios → gen 5000 → finetune 5 epochs → eval.
# Goal: call_f1 ≥ 0.80
#
# Prerequisites:
#   - GEMINI_API_KEY set in env  (DO NOT paste into chat — set in this shell only)
#   - WSL Ubuntu 24.04 + /home/mack/ngpu venv (already set up)
#
# Usage:
#   $env:GEMINI_API_KEY = "your_new_key"
#   .\scripts\run_oa_v2.ps1

param(
    [int]$NumSamples = 5000,
    [int]$Epochs = 5,
    [int]$BatchSize = 32,
    [int]$Workers = 6
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

if (-not $env:GEMINI_API_KEY) {
    Write-Error "Set `$env:GEMINI_API_KEY first (don't paste keys into chat)."
    exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$NEEDLE_PY = "C:\D\CLPS\Code\Github\needle\.venv\Scripts\python.exe"
$MERGED = "scenarios\oa_scenarios_v2.json"
$TRAIN_DATA = "examples\oa_train_v2.jsonl"

# ─── 1) Merge v1 + v2-patch scenarios ─────────────────────────────────
Write-Host "→ [1/4] Merging scenarios"
& $NEEDLE_PY scripts\merge_scenarios.py `
    scenarios\oa_scenarios.json `
    scenarios\oa_scenarios_v2_patch.json `
    --output $MERGED

# ─── 2) Generate 5000 samples via Gemini ──────────────────────────────
Write-Host "→ [2/4] Synthesizing $NumSamples samples with $Workers workers (~15-30 min)"
$t0 = Get-Date
& $NEEDLE_PY scripts\02_gen_data.py `
    --scenarios $MERGED `
    --tools tools\oa_tools.json `
    --num-samples $NumSamples `
    --batch-size 25 `
    --workers $Workers `
    --output $TRAIN_DATA
Write-Host "  elapsed: $([math]::Round(((Get-Date)-$t0).TotalMinutes,1)) min"

# ─── 3) Finetune on WSL GPU (5 epochs, batch=32) ──────────────────────
Write-Host "→ [3/4] Finetuning on WSL GPU ($Epochs epochs, batch=$BatchSize, ~30-60 min)"

# Write a WSL launch script with the v2 args
$wslScript = @"
#!/bin/bash
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1
export XLA_PYTHON_CLIENT_PREALLOCATE=false
export XLA_PYTHON_CLIENT_MEM_FRACTION=0.85
export NEEDLE_EVAL_BATCH=8
CKPTS=/home/mack/ngpu-ckpts-v2
mkdir -p `$CKPTS
needle finetune \\
    /mnt/c/D/CLPS/Code/Github/needle-edge-kit/$TRAIN_DATA \\
    --epochs $Epochs --batch-size $BatchSize \\
    --checkpoint-dir `$CKPTS \\
    --max-enc-len 512 --max-dec-len 128 \\
    2>&1 | tee /mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v2_finetune.log
"@
$wslScript | Set-Content -Path "oa_run\v2_finetune.sh" -Encoding utf8 -NoNewline
wsl -d Ubuntu-24.04 -e bash /mnt/c/D/CLPS/Code/Github/needle-edge-kit/oa_run/v2_finetune.sh

# ─── 4) Report final metrics ──────────────────────────────────────────
Write-Host "→ [4/4] Final eval result:"
Get-Content "oa_run\v2_finetune.log" | Select-String "FINETUNED_EVAL" | Select-Object -Last 1

Write-Host ""
Write-Host "Best ckpt:"
wsl -d Ubuntu-24.04 -e bash -c "ls -lh /home/mack/ngpu-ckpts-v2/*_best.pkl"
