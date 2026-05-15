"""
Wrapper around `needle generate-data` that swaps in your own domain
scenarios + tool schema instead of Needle's built-in 33-tool pool.

Usage:
    python scripts/02_gen_data.py \
        --scenarios scenarios/my_domain.json \
        --tools tools/my_tools.json \
        --num-samples 2000 \
        --output examples/train.jsonl

Requires:
    - GEMINI_API_KEY in environment (.env supported)
    - needle package installed (pip install -e ".[gpu]" in needle repo)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Pure parsers live in gen_parsers.py so they can be unit tested without
# the heavy genai / dotenv deps.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_parsers import (  # noqa: E402
    SYSTEM_PROMPT, build_prompt, parse_jsonl_response, normalize_row,
)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from google import genai
except ImportError:
    print("ERROR: install google-genai:  pip install google-genai", file=sys.stderr)
    sys.exit(1)


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def call_gemini(client, model: str, prompt: str, retries: int = 3) -> str:
    delay = 1.5
    last = None
    for _ in range(retries):
        try:
            resp = client.models.generate_content(model=model, contents=prompt)
            return resp.text or ""
        except Exception as e:
            last = e
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"Gemini failed after {retries} retries: {last}")


def generate_batch(client, model, tools, scenarios_batch):
    prompt = build_prompt(tools, scenarios_batch)
    text = call_gemini(client, model, prompt)
    parsed = parse_jsonl_response(text)
    # Normalize Gemini's drift (tool_name/tool_input → name/arguments).
    normalized = [normalize_row(p) for p in parsed]
    normalized = [n for n in normalized if n is not None]
    # Needle's training pipeline expects `tools` and `answers` as JSON STRINGS,
    # not parsed lists. See needle/dataset/dataset.py _compact_json.
    tools_str = json.dumps(tools, ensure_ascii=False, separators=(",", ":"))
    return [
        {
            "query":   n["query"],
            "tools":   tools_str,
            "answers": json.dumps(n["answers"], ensure_ascii=False, separators=(",", ":")),
        }
        for n in normalized
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True, help="Path to scenarios JSON")
    ap.add_argument("--tools", required=True, help="Path to tools JSON")
    ap.add_argument("--num-samples", type=int, default=2000)
    ap.add_argument("--batch-size", type=int, default=25, help="Scenarios per Gemini call")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--model", default=os.getenv("GEMINI_MODEL", "gemini-2.0-flash-exp"))
    ap.add_argument("--output", required=True)
    ap.add_argument("--output-jsonl", default=None, help="Also save raw Gemini outputs")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: set GEMINI_API_KEY (in env or .env)", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    tools = load_json(Path(args.tools))
    scen_doc = load_json(Path(args.scenarios))
    scenarios = scen_doc["scenarios"] if isinstance(scen_doc, dict) else scen_doc

    rng = random.Random(args.seed)
    # Sample with replacement to reach num_samples; ensures diversity even if scenarios is small
    sampled = [rng.choice(scenarios) for _ in range(args.num_samples)]
    batches = [sampled[i:i + args.batch_size] for i in range(0, len(sampled), args.batch_size)]

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    f_out = open(out_path, "w", encoding="utf-8")
    n_ok, n_fail = 0, 0

    print(f"→ {len(batches)} Gemini calls, {args.workers} workers, model={args.model}")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(generate_batch, client, args.model, tools, b) for b in batches]
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                rows = fut.result()
                for r in rows:
                    f_out.write(json.dumps(r, ensure_ascii=False) + "\n")
                n_ok += len(rows)
            except Exception as e:
                n_fail += 1
                print(f"  batch failed: {e}", file=sys.stderr)
            if i % 5 == 0 or i == len(batches):
                rate = n_ok / max(time.time() - t0, 1)
                print(f"  [{i}/{len(batches)}] ok={n_ok}  fail_batches={n_fail}  {rate:.1f}/s")

    f_out.close()
    print(f"✓ wrote {n_ok} samples to {out_path}  ({n_fail} batches failed)")
    if n_ok < args.num_samples * 0.7:
        print("⚠  acceptance rate is low — check API quota or tool/scenario quality", file=sys.stderr)


if __name__ == "__main__":
    main()
