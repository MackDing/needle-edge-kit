"""Merge multiple scenarios JSON files into one. Used to combine v1 + v2 patch."""
import argparse, json, sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("inputs", nargs="+", help="scenarios JSON files to merge")
ap.add_argument("--output", required=True)
ap.add_argument("--dedupe", action="store_true", default=True)
args = ap.parse_args()

all_scenarios = []
domains = []
for p in args.inputs:
    doc = json.loads(Path(p).read_text(encoding="utf-8"))
    domains.append(doc.get("domain", "unknown"))
    all_scenarios.extend(doc.get("scenarios", []))

if args.dedupe:
    seen = set()
    deduped = []
    for s in all_scenarios:
        k = s.strip().lower()
        if k in seen:
            continue
        seen.add(k)
        deduped.append(s)
    print(f"deduped {len(all_scenarios)} → {len(deduped)}", file=sys.stderr)
    all_scenarios = deduped

merged = {
    "domain": "+".join(domains),
    "description": f"Merged from: {', '.join(args.inputs)}",
    "scenarios": all_scenarios,
}
Path(args.output).write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {len(all_scenarios)} scenarios to {args.output}", file=sys.stderr)
