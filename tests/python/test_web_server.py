"""
Integration tests for web/server.py using FastAPI TestClient.

We inject a stub generator so tests don't need Needle / JAX / a real .pkl.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make web/ importable
WEB_DIR = Path(__file__).resolve().parents[2] / "web"
sys.path.insert(0, str(WEB_DIR))

from server import create_app  # noqa: E402


# ─── Stub generators ───────────────────────────────────────────────────

def echo_generator(query, tools, constrained, max_len, seed):
    """Returns a single 'echo' tool call wrapping the query."""
    return [{"name": "echo", "arguments": {"q": query, "constrained": constrained, "max_len": max_len, "seed": seed}}]


def empty_generator(*_args, **_kw):
    return []


def boom_generator(*_args, **_kw):
    raise RuntimeError("inference exploded")


# ─── Fixtures ──────────────────────────────────────────────────────────

@pytest.fixture
def tools_dir(tmp_path: Path) -> Path:
    """A temporary tools dir with one toolset file for tests that don't need real ones."""
    d = tmp_path / "tools"
    d.mkdir()
    (d / "test_toolset.json").write_text(
        json.dumps([{"name": "echo", "description": "echo back", "parameters": {}, "required": []}]),
        encoding="utf-8",
    )
    return d


@pytest.fixture
def client(tools_dir: Path) -> TestClient:
    app = create_app(
        generator=echo_generator,
        model_name="test.pkl",
        tools_dir=tools_dir,
        static_dir=Path("/does/not/exist"),  # skip static mount
    )
    return TestClient(app)


# ─── /api/health ───────────────────────────────────────────────────────

class TestHealth:

    def test_returns_200_and_ok(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["model"] == "test.pkl"


# ─── /api/tools/{name} ─────────────────────────────────────────────────

class TestToolsEndpoint:

    def test_returns_known_toolset(self, client):
        r = client.get("/api/tools/test_toolset")
        assert r.status_code == 200
        tools = r.json()
        assert isinstance(tools, list)
        assert tools[0]["name"] == "echo"

    def test_404_on_unknown_toolset(self, client):
        r = client.get("/api/tools/nonexistent")
        assert r.status_code == 404

    def test_rejects_path_traversal_dotdot(self, client):
        r = client.get("/api/tools/..%2Fsecrets")
        # FastAPI may decode the %2F into '/' which would 404 at routing, or
        # decode and our handler rejects it. Either way, never 200.
        assert r.status_code in (400, 404)

    def test_rejects_path_traversal_backslash(self, client):
        r = client.get("/api/tools/foo\\bar")
        # Backslash isn't URL-special so it reaches our handler; should be rejected.
        assert r.status_code == 400

    def test_rejects_hidden_files(self, client):
        r = client.get("/api/tools/.env")
        assert r.status_code == 400


# ─── /api/generate ─────────────────────────────────────────────────────

class TestGenerate:

    def test_happy_path(self, client):
        r = client.post("/api/generate", json={
            "query": "hello world",
            "tools": [{"name": "echo", "description": "x", "parameters": {}, "required": []}],
        })
        assert r.status_code == 200
        body = r.json()
        assert "calls" in body
        assert "latency_ms" in body
        assert body["calls"][0]["name"] == "echo"
        assert body["calls"][0]["arguments"]["q"] == "hello world"
        assert isinstance(body["latency_ms"], int)
        assert body["latency_ms"] >= 0

    def test_empty_query_returns_400(self, client):
        r = client.post("/api/generate", json={"query": "", "tools": []})
        assert r.status_code == 400

    def test_whitespace_only_query_returns_400(self, client):
        r = client.post("/api/generate", json={"query": "   \n\t  ", "tools": []})
        assert r.status_code == 400

    def test_missing_query_returns_422(self, client):
        # pydantic validation
        r = client.post("/api/generate", json={"tools": []})
        assert r.status_code == 422

    def test_missing_tools_returns_422(self, client):
        r = client.post("/api/generate", json={"query": "x"})
        assert r.status_code == 422

    def test_passes_constrained_flag_to_generator(self, client):
        r = client.post("/api/generate", json={
            "query": "x", "tools": [], "constrained": False,
        })
        assert r.status_code == 200
        assert r.json()["calls"][0]["arguments"]["constrained"] is False

    def test_uses_default_max_len_when_omitted(self, tools_dir):
        seen = {}
        def spy_gen(query, tools, constrained, max_len, seed):
            seen["max_len"] = max_len
            return []
        app = create_app(generator=spy_gen, max_len_default=999, tools_dir=tools_dir, static_dir=Path("/x"))
        c = TestClient(app)
        r = c.post("/api/generate", json={"query": "x", "tools": []})
        assert r.status_code == 200
        assert seen["max_len"] == 999

    def test_uses_client_max_len_when_provided(self, tools_dir):
        seen = {}
        def spy_gen(query, tools, constrained, max_len, seed):
            seen["max_len"] = max_len
            return []
        app = create_app(generator=spy_gen, max_len_default=999, tools_dir=tools_dir, static_dir=Path("/x"))
        c = TestClient(app)
        r = c.post("/api/generate", json={"query": "x", "tools": [], "max_len": 42})
        assert r.status_code == 200
        assert seen["max_len"] == 42

    def test_generator_exception_becomes_500(self, tools_dir):
        app = create_app(generator=boom_generator, tools_dir=tools_dir, static_dir=Path("/x"))
        c = TestClient(app)
        r = c.post("/api/generate", json={"query": "x", "tools": []})
        assert r.status_code == 500
        assert "inference exploded" in r.json()["detail"]

    def test_empty_calls_response_is_valid(self, tools_dir):
        app = create_app(generator=empty_generator, tools_dir=tools_dir, static_dir=Path("/x"))
        c = TestClient(app)
        r = c.post("/api/generate", json={"query": "no match", "tools": []})
        assert r.status_code == 200
        assert r.json()["calls"] == []


# ─── CORS / security headers ───────────────────────────────────────────

class TestCORS:

    def test_cors_allows_all_origins_by_default(self, client):
        r = client.options("/api/generate", headers={
            "origin": "https://example.com",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        })
        # FastAPI's CORSMiddleware returns 200 with allow-origin
        assert r.status_code in (200, 204)
        assert r.headers.get("access-control-allow-origin") in ("*", "https://example.com")

    def test_can_restrict_origins(self, tools_dir):
        app = create_app(
            generator=echo_generator,
            allow_origins=["https://allowed.example.com"],
            tools_dir=tools_dir,
            static_dir=Path("/x"),
        )
        c = TestClient(app)
        r = c.options("/api/generate", headers={
            "origin": "https://attacker.example.com",
            "access-control-request-method": "POST",
        })
        # Non-allowed origin must not receive an allow header
        allow = r.headers.get("access-control-allow-origin", "")
        assert allow != "*"
        assert "attacker" not in allow
