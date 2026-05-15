"""
Tests for scripts/gen_parsers.py — the Gemini-output parser and prompt builder.

These functions are pure (no I/O, no API). They are the most failure-prone
part of the data pipeline because Gemini's output format drifts a lot
(code fences, pretty-printing, leading commentary, trailing commas, etc.).
"""

from __future__ import annotations

import json
import pytest

from gen_parsers import build_prompt, parse_jsonl_response, SYSTEM_PROMPT


# ──────────────────────────────────────────────────────────────────────
# build_prompt
# ──────────────────────────────────────────────────────────────────────

class TestBuildPrompt:

    def test_includes_every_scenario_in_order(self):
        tools = [{"name": "t1", "description": "d", "parameters": {}, "required": []}]
        scenarios = ["one", "two", "three"]
        prompt = build_prompt(tools, scenarios)
        for i, s in enumerate(scenarios, 1):
            assert f"SCENARIO {i}: {s}" in prompt
        # 'two' must appear after 'one' in the text
        assert prompt.index("SCENARIO 1") < prompt.index("SCENARIO 2") < prompt.index("SCENARIO 3")

    def test_serializes_tool_schema(self):
        tools = [{"name": "set_volume", "description": "Adjust", "parameters": {"level": {"type": "integer"}}, "required": ["level"]}]
        prompt = build_prompt(tools, ["hello"])
        assert '"set_volume"' in prompt
        assert '"level"' in prompt
        assert '"integer"' in prompt

    def test_includes_count_instruction(self):
        # The prompt must tell Gemini exactly how many JSON lines to emit.
        # We don't pin the exact phrasing so prompt wording can evolve.
        prompt = build_prompt([], ["a", "b", "c", "d", "e"])
        assert "5 lines" in prompt or "5 objects" in prompt

    def test_preserves_unicode_in_scenarios(self):
        prompt = build_prompt([], ["把灯关掉", "音量调小"])
        assert "把灯关掉" in prompt
        assert "音量调小" in prompt

    def test_preserves_unicode_in_tool_descriptions(self):
        tools = [{"name": "t", "description": "把灯关掉", "parameters": {}, "required": []}]
        prompt = build_prompt(tools, [])
        # ensure_ascii=False must keep Chinese readable, not '\u'-escaped
        assert "把灯关掉" in prompt

    def test_empty_scenarios_still_produces_valid_string(self):
        prompt = build_prompt([], [])
        assert "0 lines" in prompt or "0 objects" in prompt


# ──────────────────────────────────────────────────────────────────────
# parse_jsonl_response — happy paths
# ──────────────────────────────────────────────────────────────────────

class TestParseJsonlHappyPath:

    def test_plain_jsonl(self):
        text = '{"query": "a", "answer": []}\n{"query": "b", "answer": []}'
        out = parse_jsonl_response(text)
        assert len(out) == 2
        assert out[0]["query"] == "a"
        assert out[1]["query"] == "b"

    def test_blank_lines_ignored(self):
        text = '{"query": "a", "answer": []}\n\n\n{"query": "b", "answer": []}\n'
        out = parse_jsonl_response(text)
        assert len(out) == 2

    def test_single_object_no_trailing_newline(self):
        out = parse_jsonl_response('{"query": "a", "answer": []}')
        assert len(out) == 1
        assert out[0]["query"] == "a"


# ──────────────────────────────────────────────────────────────────────
# parse_jsonl_response — code fences
# ──────────────────────────────────────────────────────────────────────

class TestParseJsonlCodeFences:

    def test_strips_json_code_fence(self):
        text = '```json\n{"query": "a", "answer": []}\n{"query": "b", "answer": []}\n```'
        out = parse_jsonl_response(text)
        assert len(out) == 2
        assert out[0]["query"] == "a"

    def test_strips_plain_code_fence(self):
        text = '```\n{"query": "a", "answer": []}\n```'
        out = parse_jsonl_response(text)
        assert len(out) == 1
        assert out[0]["query"] == "a"

    def test_strips_trailing_fence_when_present(self):
        # Gemini sometimes emits ```json\n...\n``` with content all in middle
        text = '```json\n{"query": "x", "answer": []}\n```'
        out = parse_jsonl_response(text)
        assert len(out) == 1
        assert out[0]["query"] == "x"


# ──────────────────────────────────────────────────────────────────────
# parse_jsonl_response — tolerant noise handling
# ──────────────────────────────────────────────────────────────────────

class TestParseJsonlNoise:

    def test_trailing_commas_tolerated(self):
        text = '{"query": "a", "answer": []},\n{"query": "b", "answer": []},'
        out = parse_jsonl_response(text)
        assert len(out) == 2

    def test_array_brackets_ignored(self):
        # Gemini might wrap in [ ... ]
        text = '[\n{"query": "a", "answer": []},\n{"query": "b", "answer": []}\n]'
        out = parse_jsonl_response(text)
        assert len(out) == 2

    def test_garbage_lines_skipped(self):
        text = (
            'Sure! Here are the samples:\n'
            '{"query": "a", "answer": []}\n'
            'Hope that helps!\n'
            '{"query": "b", "answer": []}'
        )
        out = parse_jsonl_response(text)
        assert len(out) == 2
        assert out[0]["query"] == "a"
        assert out[1]["query"] == "b"

    def test_completely_unparseable_returns_empty(self):
        assert parse_jsonl_response("just some prose, no JSON here") == []

    def test_empty_string_returns_empty(self):
        assert parse_jsonl_response("") == []

    def test_only_whitespace_returns_empty(self):
        assert parse_jsonl_response("   \n\n\t  ") == []

    def test_rejects_non_dict_top_level(self):
        # A bare string or list per line shouldn't pollute results
        text = '"just a string"\n42\n["x"]\n{"query": "real", "answer": []}'
        out = parse_jsonl_response(text)
        assert len(out) == 1
        assert out[0]["query"] == "real"


# ──────────────────────────────────────────────────────────────────────
# parse_jsonl_response — known limitations (documented)
# ──────────────────────────────────────────────────────────────────────

class TestParseJsonlKnownLimitations:

    def test_pretty_printed_multiline_objects_are_dropped(self):
        """Gemini *should* honor 'one per line', but if it pretty-prints,
        we lose those objects. The system prompt is responsible for
        preventing this; this test documents the contract."""
        text = (
            '{\n'
            '  "query": "a",\n'
            '  "answer": []\n'
            '}\n'
            '{"query": "b", "answer": []}\n'
        )
        out = parse_jsonl_response(text)
        # Only the one-liner survives.
        assert len(out) == 1
        assert out[0]["query"] == "b"


# ──────────────────────────────────────────────────────────────────────
# Integration: end-to-end on a realistic Gemini response
# ──────────────────────────────────────────────────────────────────────

class TestRealisticGeminiResponse:

    # The system prompt instructs Gemini to emit "answers" (plural) to match
    # Needle upstream's expected dataset schema (needle/dataset/dataset.py
    # reads ex["answers"]). These integration tests assert that contract.

    def test_realistic_smart_home_response(self):
        gemini_output = (
            "```json\n"
            '{"query": "turn off the kitchen light", "answers": [{"name": "set_light_brightness", "arguments": {"room": "kitchen", "level": 0}}]}\n'
            '{"query": "play jazz", "answers": [{"name": "play_music", "arguments": {"genre": "jazz"}}]}\n'
            '{"query": "cancel my flight", "answers": []}\n'
            "```"
        )
        out = parse_jsonl_response(gemini_output)
        assert len(out) == 3

        assert out[0]["query"] == "turn off the kitchen light"
        assert out[0]["answers"][0]["name"] == "set_light_brightness"
        assert out[0]["answers"][0]["arguments"]["level"] == 0

        assert out[1]["answers"][0]["arguments"]["genre"] == "jazz"

        # "Can't do" scenarios produce empty answers list
        assert out[2]["answers"] == []

    def test_realistic_chinese_response(self):
        gemini_output = '{"query": "把客厅灯关掉", "answers": [{"name": "set_light_brightness", "arguments": {"room": "living_room", "level": 0}}]}'
        out = parse_jsonl_response(gemini_output)
        assert len(out) == 1
        assert out[0]["query"] == "把客厅灯关掉"
