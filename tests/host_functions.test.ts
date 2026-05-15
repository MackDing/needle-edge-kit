/**
 * Tests for desktop/host_functions/index.js — the platform dispatcher,
 * danger gate, and debounce.
 *
 * Uses createRouter(impl) dependency-injection seam so we never have to mock
 * electron or sharp. Each test gets a freshly imported module to reset the
 * RECENT debounce map.
 */

import { describe, it, expect, vi } from 'vitest';

const HF_PATH = '../desktop/host_functions/index.js';

async function freshHF() {
  vi.resetModules();
  return await import(HF_PATH);
}

function makeImpl(overrides: Record<string, (...a: any[]) => any> = {}) {
  return {
    noop:      async () => ({ ran: 'noop' }),
    run_shell: async (args: any) => ({ stdout: `ran: ${args.command}` }),
    explodes:  async () => { throw new Error('boom'); },
    echo:      async (args: any) => ({ got: args }),
    ...overrides,
  };
}

describe('host_functions createRouter', () => {

  it('exports route() and createRouter() and DANGEROUS', async () => {
    const hf = await freshHF();
    expect(typeof hf.route).toBe('function');
    expect(typeof hf.createRouter).toBe('function');
    expect(hf.DANGEROUS).toBeInstanceOf(Set);
  });

  it('returns unknown_tool for a name not in impl', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route({ name: 'no_such_tool', arguments: {} }, {});
    expect(r).toEqual({ name: 'no_such_tool', error: 'unknown_tool' });
  });

  it('dispatches and returns the handler result as ok', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route({ name: 'noop', arguments: {} }, {});
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({ ran: 'noop' });
  });

  it('forwards arguments to the handler', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route({ name: 'echo', arguments: { x: 1, y: 'hi' } }, {});
    expect(r.ok).toEqual({ got: { x: 1, y: 'hi' } });
  });

  it('captures thrown handler errors as error strings', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route({ name: 'explodes', arguments: {} }, {});
    expect(r.error).toBe('boom');
    expect(r.ok).toBeUndefined();
  });

  it('blocks DANGEROUS tools without confirm', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route(
      { name: 'run_shell', arguments: { command: 'echo hi', shell: 'bash' } },
      {},
    );
    expect(r.error).toBe('user_rejected');
  });

  it('blocks DANGEROUS tools when confirm returns false', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route(
      { name: 'run_shell', arguments: { command: 'rm -rf /', shell: 'bash' } },
      { confirm: async () => false },
    );
    expect(r.error).toBe('user_rejected');
  });

  it('proceeds with DANGEROUS tools when confirm returns true', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const r = await router.route(
      { name: 'run_shell', arguments: { command: 'echo hi', shell: 'bash' } },
      { confirm: async () => true },
    );
    expect(r.error).toBeUndefined();
    expect(r.ok.stdout).toBe('ran: echo hi');
  });

  it('debounces identical calls within 1.5s', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const a = await router.route({ name: 'noop', arguments: {} }, {});
    const b = await router.route({ name: 'noop', arguments: {} }, {});
    expect(a.ok).toBeDefined();
    expect(b.error).toBe('debounced');
  });

  it('does not debounce different arguments to same tool', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const a = await router.route({ name: 'echo', arguments: { v: 1 } }, {});
    const b = await router.route({ name: 'echo', arguments: { v: 2 } }, {});
    expect(a.ok).toBeDefined();
    expect(b.ok).toBeDefined();
  });

  it('confirm callback receives the full call object', async () => {
    const hf = await freshHF();
    const router = hf.createRouter(makeImpl());
    const seen: any[] = [];
    await router.route(
      { name: 'run_shell', arguments: { command: 'ls', shell: 'bash' } },
      { confirm: async (c) => { seen.push(c); return true; } },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('run_shell');
    expect(seen[0].arguments.command).toBe('ls');
  });
});

describe('host_functions platform support', () => {

  it('throws a clear error when run on an unsupported platform', async () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const hf = await freshHF();
      expect(() => hf._getDefaultImpl()).toThrow(/unsupported platform/i);
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('does not eagerly require missing platform files at import time', async () => {
    // The whole point: importing the module on Linux should NOT crash —
    // it crashes only when someone calls route() / _getDefaultImpl().
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const hf = await freshHF();
      // Importing succeeded. createRouter with a custom impl still works.
      const router = hf.createRouter({ ping: async () => ({ pong: true }) });
      const r = await router.route({ name: 'ping', arguments: {} }, {});
      expect(r.ok).toEqual({ pong: true });
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('PLATFORM_FILES only lists platforms whose impl file exists', async () => {
    // Sanity check that we never re-introduce the eager-require-of-missing-file bug.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../desktop/host_functions/index.js'), 'utf-8');
    const mapMatch = src.match(/PLATFORM_FILES\s*=\s*\{([\s\S]*?)\};/m);
    expect(mapMatch).toBeTruthy();
    const re = /['"](\.\/[a-z_][a-z0-9_]*)['"]/g;
    let m;
    while ((m = re.exec(mapMatch![1])) !== null) {
      const rel = m[1];
      const full = path.resolve(__dirname, '../desktop/host_functions', rel + '.js');
      expect(fs.existsSync(full), `PLATFORM_FILES maps to ${rel} but ${rel}.js is missing`).toBe(true);
    }
  });
});
