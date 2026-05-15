"""
Pure parsers extracted from 02_gen_data.py for unit testing.

These have no third-party imports (no google-genai, no dotenv) so they can be
imported and tested without Gemini credentials or heavy deps.
"""

from __future__ import annotations

import json


SYSTEM_PROMPT = """\
You are generating training data for a small on-device function-calling model.

Given:
  - a list of TOOLS (each with name, description, parameters schema)
  - a SCENARIO (a sentence a real user might say)

Output EXACTLY this JSON shape, ONE OBJECT PER LINE:
  {"query": "<the user sentence>", "answers": [{"name": "TOOL_NAME", "arguments": {"k": v}}]}

CRITICAL FIELD NAMES — do not substitute synonyms:
  - "name"      for tool name (NOT tool_name, function, function_name, tool)
  - "arguments" for tool args (NOT tool_input, parameters, params, args, input)
  - "answers"   for the list (NOT answer, calls, tool_calls)

EXAMPLES:
  scenario: 明天请一天年假
  → {"query": "明天请一天年假", "answers": [{"name": "submit_leave_request", "arguments": {"type": "annual", "start_date": "tomorrow", "end_date": "tomorrow"}}]}

  scenario: 报销 50 块出租车 然后查一下年假余额
  → {"query": "报销 50 块出租车 然后查一下年假余额", "answers": [{"name": "submit_reimbursement", "arguments": {"category": "transport", "amount": 50}}, {"name": "query_leave_balance", "arguments": {"type": "annual"}}]}

  scenario: what's the weather tomorrow
  → {"query": "what's the weather tomorrow", "answers": []}

Rules:
  - Only use tool names present in TOOLS. Never invent.
  - If the scenario can't be handled by any tool, return "answers": []
  - Use the EXACT parameter keys from the schema.
  - For enum parameters, pick a value from the enum.
  - Multi-step utterances → multiple objects in "answers", in order.
  - Keep queries natural (typos, slang, partial sentences are fine).
  - Output ONE JSON object per line. No markdown, no commentary, no array brackets.
"""


def build_prompt(tools: list, scenarios_batch: list[str]) -> str:
    """Build the user-side prompt for a single Gemini call covering N scenarios."""
    tools_json = json.dumps(tools, ensure_ascii=False, indent=2)
    blocks = []
    for i, s in enumerate(scenarios_batch, 1):
        blocks.append(f"SCENARIO {i}: {s}")
    return (
        f"{SYSTEM_PROMPT}\n"
        f"TOOLS:\n{tools_json}\n\n"
        + "\n".join(blocks)
        + f"\n\nNow produce exactly {len(scenarios_batch)} lines, one JSON object per scenario "
          f"in order. Field names MUST be \"name\" and \"arguments\" (not tool_name / tool_input).\n"
    )


# ─── Output normalization ──────────────────────────────────────────────

# Gemini drifts between conventions despite explicit instructions.
# These tolerant lookups map every common alias back to Needle's schema.
_NAME_KEYS = ("name", "tool_name", "function", "function_name", "tool")
_ARGS_KEYS = ("arguments", "tool_input", "parameters", "params", "args", "input")
_ANSWERS_KEYS = ("answers", "answer", "calls", "tool_calls")


def _first_value(d: dict, keys: tuple) -> object:
    for k in keys:
        if k in d:
            return d[k]
    return None


def normalize_tool_call(call: dict) -> dict | None:
    """Coerce {tool_name, tool_input} → {name, arguments}. Returns None if invalid."""
    if not isinstance(call, dict):
        return None
    name = _first_value(call, _NAME_KEYS)
    args = _first_value(call, _ARGS_KEYS)
    if not isinstance(name, str) or not name:
        return None
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return None
    return {"name": name, "arguments": args}


def normalize_row(obj: dict) -> dict | None:
    """Normalize one Gemini-emitted row to {query, answers: [...canonical...]}.
       Returns None if the row lacks a usable query."""
    if not isinstance(obj, dict):
        return None
    q = obj.get("query")
    if not isinstance(q, str) or not q.strip():
        return None
    raw_answers = _first_value(obj, _ANSWERS_KEYS)
    if raw_answers is None:
        raw_answers = []
    if not isinstance(raw_answers, list):
        return None
    normalized = []
    for c in raw_answers:
        nc = normalize_tool_call(c)
        if nc is not None:
            normalized.append(nc)
    return {"query": q, "answers": normalized}


def parse_jsonl_response(text: str) -> list[dict]:
    """Tolerant parser for Gemini's JSONL output.

    Handles:
      - Plain JSONL (one object per line)
      - Code fences (```json ... ``` or ``` ... ```)
      - JSON array form ([ {...}, {...} ]) — array brackets on their own lines
      - Trailing commas on lines
      - Surrounding chatter (non-JSON lines silently skipped)
      - Blank lines

    Does NOT handle:
      - Pretty-printed multi-line objects (each object must be on ONE line).
        The system prompt asks Gemini for one-per-line; if Gemini ignores that
        we lose those objects (returned count < expected — caller can detect).
    """
    text = text.strip()

    if text.startswith("```"):
        # ```json\n...\n``` or ```\n...\n```
        parts = text.split("```", 2)
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            elif text.startswith("\n"):
                pass
            text = text.strip()
            # If the remaining text still has a trailing ```, strip it.
            if text.endswith("```"):
                text = text[:-3].strip()

    out: list[dict] = []
    for line in text.splitlines():
        line = line.strip().rstrip(",")
        if not line or line in ("[", "]"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out
