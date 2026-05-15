# Step 1 — clone Needle (sibling dir), set up venv, launch playground.
# Run from the needle-edge-kit root.

param(
    [string]$NeedleDir = "..\needle",
    [string]$Extras = "gpu",
    [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $NeedleDir)) {
    Write-Host "→ cloning Cactus-Compute/needle into $NeedleDir"
    git clone https://github.com/cactus-compute/needle.git $NeedleDir
} else {
    Write-Host "✓ $NeedleDir already exists"
}

Set-Location $NeedleDir

if (-not (Test-Path ".venv")) {
    Write-Host "→ creating .venv (python 3.11+)"
    python -m venv .venv
}

. .\.venv\Scripts\Activate.ps1

$pkg = if ($CpuOnly) { "-e ." } else { "-e .[$Extras]" }
Write-Host "→ pip install $pkg"
Invoke-Expression "pip install $pkg"

Write-Host "→ launching needle playground at http://127.0.0.1:7860"
needle playground
