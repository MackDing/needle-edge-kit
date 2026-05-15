"""
Interactive sampler to spot-check Gemini-generated training data.

Usage:
    python scripts/02b_review.py --input examples/train.jsonl --sample 50
"""

import argparse
import json
import random
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--sample", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--report", default=None, help="Optional path to save markdown report")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(args.input, "r", encoding="utf-8")]
    rng = random.Random(args.seed)
    picks = rng.sample(rows, min(args.sample, len(rows)))

    accepted, rejected, edited = 0, 0, 0
    failure_modes: dict[str, int] = {}
    notes = []

    print(f"\nReviewing {len(picks)} samples. Keys: [a]ccept  [r]eject  [e]dit  [q]uit\n")
    for i, row in enumerate(picks, 1):
        print(f"─── {i}/{len(picks)} ───")
        print(f"QUERY : {row['query']}")
        print(f"ANSWER: {json.dumps(row['answer'], ensure_ascii=False)}")
        sys.stdout.write("a/r/e/q ? ")
        sys.stdout.flush()
        c = sys.stdin.readline().strip().lower()
        if c == "q":
            break
        elif c == "a":
            accepted += 1
        elif c == "e":
            edited += 1
            sys.stdout.write("  reason (one word): ")
            sys.stdout.flush()
            reason = sys.stdin.readline().strip() or "edit"
            failure_modes[reason] = failure_modes.get(reason, 0) + 1
            notes.append((row, reason))
        else:
            rejected += 1
            sys.stdout.write("  reason (one word): ")
            sys.stdout.flush()
            reason = sys.stdin.readline().strip() or "reject"
            failure_modes[reason] = failure_modes.get(reason, 0) + 1
            notes.append((row, reason))

    total = accepted + rejected + edited
    rate = accepted / max(total, 1)
    print(f"\n========================================")
    print(f"accepted: {accepted}/{total}  ({rate*100:.0f}%)")
    print(f"rejected: {rejected}  edited: {edited}")
    if failure_modes:
        print("top failure modes:")
        for k, v in sorted(failure_modes.items(), key=lambda x: -x[1]):
            print(f"  {k:20s} {v}")
    print(f"\n{'✓ data quality OK' if rate >= 0.8 else '⚠  acceptance < 80% — go back to Step 2 and improve scenarios/tools'}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(f"# Data Review Report\n\n")
            f.write(f"- accepted: {accepted}/{total} ({rate*100:.0f}%)\n")
            f.write(f"- failure modes:\n")
            for k, v in failure_modes.items():
                f.write(f"  - **{k}**: {v}\n")
            f.write(f"\n## Failed Samples\n\n")
            for row, reason in notes:
                f.write(f"### {reason}\n```json\n{json.dumps(row, ensure_ascii=False, indent=2)}\n```\n\n")
        print(f"→ report saved to {args.report}")


if __name__ == "__main__":
    main()
