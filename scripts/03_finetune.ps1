# Step 3 — run needle finetune with sensible defaults for ~2k-sample domain data.

param(
    [Parameter(Mandatory)][string]$Jsonl,
    [int]$Epochs = 3,
    [int]$BatchSize = 32,
    [string]$Name = "my_domain",
    [string]$CheckpointDir = "checkpoints",
    [string]$Checkpoint = $null,
    [int]$MaxEncLen = 1024,
    [int]$MaxDecLen = 256
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command needle -ErrorAction SilentlyContinue)) {
    Write-Error "needle CLI not found. Activate the venv from Step 1 first."
    exit 1
}

$args = @(
    "finetune", $Jsonl,
    "--epochs", $Epochs,
    "--batch-size", $BatchSize,
    "--checkpoint-dir", $CheckpointDir,
    "--max-enc-len", $MaxEncLen,
    "--max-dec-len", $MaxDecLen
)
if ($Checkpoint) { $args += @("--checkpoint", $Checkpoint) }

Write-Host "→ needle $($args -join ' ')"
& needle @args

Write-Host "`n→ best checkpoint:"
Get-ChildItem $CheckpointDir -Filter "*_best.pkl" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | Format-Table Name, Length, LastWriteTime
