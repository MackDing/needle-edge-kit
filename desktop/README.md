# Desktop (Electron) — works today, fully offline

This is the **fastest path to a working demo**. No model conversion needed —
Electron just spawns a Python subprocess that runs Needle directly.

## Run in dev

```bash
cd desktop
npm install

# Point at your finetuned ckpt:
$env:NEEDLE_CHECKPOINT = "C:\path\to\my_best.pkl"

# Point at the python that has `needle` installed:
$env:NEEDLE_PYTHON = "C:\path\to\needle\.venv\Scripts\python.exe"

npm start
```

A window opens, model loads (~ 2-5s), you can chat.

## Package for distribution

```bash
# 1. Bundle a Python runtime into ./python/
#    Easiest: python-build-standalone (https://github.com/indygreg/python-build-standalone)
#    Extract their portable distribution into desktop/python/
#    Then pip install needle into it:
./python/python.exe -m pip install -e ../../needle

# 2. Copy your checkpoint
cp /path/to/my_best.pkl ./assets/my_best.pkl

# 3. Build .exe / .dmg
npm run build
```

Output:
- Windows: `dist/Needle Edge Kit Setup 0.1.0.exe` (~ 250 MB)
- Mac:     `dist/Needle Edge Kit-0.1.0.dmg`
- Linux:   `dist/Needle Edge Kit-0.1.0.AppImage`

## Size optimization

| Item | Default | Optimized |
|---|---|---|
| Python runtime | ~ 80 MB | ~ 30 MB (strip stdlib) |
| JAX (CPU) | ~ 200 MB | ~ 60 MB (CPU-only wheel) |
| Model (bf16) | ~ 100 MB | ~ 25 MB (INT4 export) |
| Electron | ~ 80 MB | (unchanged) |
| **Total** | ~ 460 MB | **~ 195 MB** |

INT4 export uses Needle's `quantize._quantize_params` + `model.export.export_submodel`.
