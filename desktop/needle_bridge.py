"""
Stdio JSON-RPC bridge: Electron <-> Needle.

Protocol (newline-delimited JSON, both directions):

  Request from Electron:
    {"id": 1, "query": "...", "tools": [...]}

  Response from Python:
    {"id": 1, "ok":  [{"name": "...", "arguments": {...}}, ...]}
    or
    {"id": 1, "err": "...error message..."}

Usage:
    python desktop/needle_bridge.py --checkpoint checkpoints/my_best.pkl
"""

import argparse
import json
import os
import sys


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def parse_calls(text):
    """Needle returns a string. Try to parse as JSON list of {name, arguments}.
       Returns [] if not parseable."""
    text = (text or "").strip()
    if not text:
        return []
    # Sometimes leading <tool_call> token text leaks despite generate()'s strip
    if text.startswith("<tool_call>"):
        text = text[len("<tool_call>"):].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return [parsed]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--max-len", type=int, default=256)
    ap.add_argument("--no-constrained", action="store_true")
    args = ap.parse_args()

    # Silence JAX/XLA noise — Electron parses stderr separately
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    os.environ.setdefault("GRPC_VERBOSITY", "ERROR")

    try:
        from needle.model.run import load_checkpoint, generate
        from needle.model.architecture import SimpleAttentionNetwork
        from needle.dataset.dataset import get_tokenizer
    except ImportError as e:
        emit({"id": None, "err": f"needle package not installed: {e}"})
        return

    print("[bridge] loading checkpoint...", file=sys.stderr)
    params, config = load_checkpoint(args.checkpoint)
    model = SimpleAttentionNetwork(config)
    tokenizer = get_tokenizer()
    print(f"[bridge] model + tokenizer ready (config d_model={config.d_model})", file=sys.stderr)
    emit({"id": None, "ready": True, "model": os.path.basename(args.checkpoint)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"id": None, "err": f"bad json: {e}"})
            continue

        rid = req.get("id")
        try:
            tools = req.get("tools", [])
            tools_str = json.dumps(tools, ensure_ascii=False) if isinstance(tools, list) else str(tools)

            text = generate(
                model, params, tokenizer,
                query=req["query"],
                tools=tools_str,
                max_gen_len=req.get("max_len") or args.max_len,
                seed=req.get("seed", 0),
                stream=False,
                constrained=not args.no_constrained,
            )
            calls = parse_calls(text)
            emit({"id": rid, "ok": calls})
        except Exception as e:
            emit({"id": rid, "err": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
