# Spotlight Launcher · uses WSL GPU + current best ckpt.
# Run from this directory:  .\start_wsl.ps1
$env:NEEDLE_USE_WSL = "1"
$env:NEEDLE_WSL_DISTRO = "Ubuntu-24.04"
$env:NEEDLE_WSL_VENV = "/home/mack/ngpu/bin/activate"
$env:NEEDLE_WSL_BRIDGE = "/mnt/c/D/CLPS/Code/Github/needle-edge-kit/desktop/needle_bridge.py"
$env:NEEDLE_WSL_CHECKPOINT = "/home/mack//home/mack/ngpu-ckpts-v3/needle_finetuned_20260515132605_51988_12_512_best.pkl"

Set-Location $PSScriptRoot
npm start


