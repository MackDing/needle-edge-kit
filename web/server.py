"""
Web playground server — Needle inference over HTTP.

POSITIONING:
  This is the FUNNEL ENTRY, not the product. It exists so anyone can:
    1. Try your tuned model in 30 seconds (no install)
    2. See it work on their own browser-side tools (clipboard, notification, timer)
    3. Click "Download desktop app" for the full feature set

  Do NOT expose dangerous tools here (no shell, no file ops). The browser
  is sandboxed and the server cannot reach the user's machine.

Run:
    pip install fastapi uvicorn
    python web/server.py --checkpoint checkpoints/my_best.pkl
    # → http://127.0.0.1:8000

For tests, do NOT call main(). Build the app via create_app(generator=...)
with a stub generator — see tests/python/test_web_server.py.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from threading import Lock
from typing import Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel


# ─── Request / response schema ─────────────────────────────────────────

class GenerateReq(BaseModel):
    query: str
    tools: list[dict]
    max_len: int | None = None
    seed: int | None = 0
    constrained: bool = True


class GenerateRes(BaseModel):
    calls: list[dict]
    latency_ms: int


# Generator contract: (query, tools, constrained, max_len, seed) -> list[dict]
Generator = Callable[[str, list[dict], bool, int, int], list[dict]]


# ─── App factory ───────────────────────────────────────────────────────

STATIC_DIR = Path(__file__).parent / "static"
TOOLS_DIR  = Path(__file__).parent / "tools"


def create_app(
    *,
    generator: Generator,
    model_name: str = "unknown",
    max_len_default: int = 256,
    allow_origins: list[str] | tuple[str, ...] = ("*",),
    static_dir: Path = STATIC_DIR,
    tools_dir: Path = TOOLS_DIR,
) -> FastAPI:
    """Build a FastAPI app around any generator callable."""
    app = FastAPI(title="Needle Web")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allow_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    lock = Lock()  # JAX generate isn't thread-safe; serialize

    @app.post("/api/generate", response_model=GenerateRes)
    def api_generate(req: GenerateReq):
        if not req.query.strip():
            raise HTTPException(400, "empty query")
        t0 = time.time()
        with lock:
            try:
                calls = generator(
                    req.query,
                    req.tools,
                    req.constrained,
                    req.max_len or max_len_default,
                    req.seed or 0,
                )
            except Exception as e:
                raise HTTPException(500, f"{type(e).__name__}: {e}")
        return GenerateRes(calls=calls, latency_ms=int((time.time() - t0) * 1000))

    @app.get("/api/health")
    def api_health():
        return {"ok": True, "model": model_name}

    @app.get("/api/tools/{name}")
    def api_tools(name: str):
        # Reject path traversal — only flat name allowed
        if "/" in name or "\\" in name or ".." in name or name.startswith("."):
            raise HTTPException(400, "invalid toolset name")
        p = tools_dir / f"{name}.json"
        if not p.exists():
            raise HTTPException(404, "no such toolset")
        return json.loads(p.read_text(encoding="utf-8"))

    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

        @app.get("/")
        def index():
            return FileResponse(str(static_dir / "index.html"))

    return app


# ─── Entry point (production) ──────────────────────────────────────────

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--max-len", type=int, default=256)
    ap.add_argument("--allow-origins", nargs="*", default=["*"])
    args = ap.parse_args()

    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    os.environ.setdefault("GRPC_VERBOSITY", "ERROR")

    print(f"loading {args.checkpoint} …", flush=True)
    from needle.model.run import load_checkpoint, generate as needle_generate

    state, config, tokenizer = load_checkpoint(args.checkpoint)
    print("✓ ready", flush=True)

    def real_generator(query, tools, constrained, max_len, seed):
        return needle_generate(
            state, config, tokenizer,
            query=query, tools=tools,
            constrained=constrained, max_len=max_len, seed=seed,
        )

    app = create_app(
        generator=real_generator,
        model_name=Path(args.checkpoint).name,
        max_len_default=args.max_len,
        allow_origins=args.allow_origins,
    )

    import uvicorn
    print(f"→ http://{args.host}:{args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
