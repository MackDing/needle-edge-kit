import json, random
rows = [json.loads(l) for l in open('examples/oa_train.jsonl', encoding='utf-8')]
print(f'Total rows: {len(rows)}')
print(f'Empty answers: {sum(1 for r in rows if json.loads(r["answers"]) == [])}')
print(f'Multi-call:   {sum(1 for r in rows if len(json.loads(r["answers"])) > 1)}')

# Tool distribution
from collections import Counter
tools_used = Counter()
for r in rows:
    for a in json.loads(r['answers']):
        tools_used[a.get('name', '?')] += 1
print(f'\nTool distribution:')
for name, n in tools_used.most_common():
    print(f'  {n:>4}  {name}')

print(f'\n5 random samples:')
for r in random.Random(42).sample(rows, 5):
    answers = json.loads(r['answers'])
    print(f'  Q: {r["query"]}')
    for a in answers:
        print(f'  → {a["name"]}({a["arguments"]})')
    if not answers:
        print(f'  → (no tool)')
    print()
