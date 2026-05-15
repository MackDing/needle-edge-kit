#!/bin/bash
set -e
cd /home/mack
rm -rf ngpu
python3 -m venv ngpu
source ngpu/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -e /mnt/c/D/CLPS/Code/Github/needle 'jax[cuda12]'
python - <<'PY'
import jax
print("jax", jax.__version__)
print("devices:", jax.devices())
print("backend:", jax.default_backend())
PY
