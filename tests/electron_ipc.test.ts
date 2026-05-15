/**
 * Electron IPC contract — static analysis of main.js / preload.js / launcher.html.
 *
 * Catches the most common Electron bug: name mismatch between
 *   - main.js   :  ipcMain.handle('channel', ...)
 *   - preload.js:  ipcRenderer.invoke('channel', ...)
 *   - renderer  :  window.needle.fooName(...)
 *
 * These three must agree. There's no runtime checking — a typo just fails
 * silently. Doing this with playwright-electron would need a real .pkl and
 * 200MB of browser binaries; static parsing is fast and free.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DESKTOP = path.resolve(__dirname, '../desktop');

function read(rel: string): string {
  return fs.readFileSync(path.join(DESKTOP, rel), 'utf-8');
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Every channel name passed to ipcMain.handle('X', ...) in main.js */
function extractMainHandlers(): Set<string> {
  const src = stripComments(read('main.js'));
  const re = /ipcMain\.handle\s*\(\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

/** Every channel name passed to ipcRenderer.invoke('X', ...) in preload.js */
function extractPreloadInvokes(): Set<string> {
  const src = stripComments(read('preload.js'));
  const re = /ipcRenderer\.invoke\s*\(\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

/** Every channel name passed to ipcRenderer.on('X', ...) in preload.js (push events) */
function extractPreloadListens(): Set<string> {
  const src = stripComments(read('preload.js'));
  const re = /ipcRenderer\.on\s*\(\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

/** Every webContents.send('X', ...) in main.js (the producer side of the above) */
function extractMainSends(): Set<string> {
  const src = stripComments(read('main.js'));
  const re = /webContents\.send\s*\(\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

/** Key names inside contextBridge.exposeInMainWorld('needle', { ... }).
 *  Uses brace-balanced extraction so default values like `opts = {}` inside
 *  the API definitions don't terminate the match prematurely. */
function extractPreloadAPI(): Set<string> {
  const src = stripComments(read('preload.js'));
  const anchor = src.search(/exposeInMainWorld\s*\(\s*['"]needle['"]\s*,\s*\{/);
  if (anchor < 0) return new Set();
  const openIdx = src.indexOf('{', anchor);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx < 0) return new Set();
  const body = src.slice(openIdx + 1, closeIdx);

  // Only count top-level keys (depth === 0 again at column-start).
  // Top-level keys appear at depth 0 within the captured body.
  const keys = new Set<string>();
  let d = 0;
  let lineStart = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{' || body[i] === '(') d++;
    else if (body[i] === '}' || body[i] === ')') d--;
    if (body[i] === '\n') lineStart = i + 1;
  }
  // Simpler: scan line-by-line, recognise lines that start with `name:` at top level.
  const lines = body.split('\n');
  let braceDepth = 0;
  for (const line of lines) {
    if (braceDepth === 0) {
      const m = line.match(/^\s*([a-zA-Z_$][\w$]*)\s*:/);
      if (m) keys.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(') braceDepth++;
      else if (ch === '}' || ch === ')') braceDepth--;
    }
  }
  return keys;
}

/** All window.needle.X references in renderer HTML/JS. */
function extractRendererUsage(): Set<string> {
  const out = new Set<string>();
  for (const f of ['renderer/launcher.html', 'renderer/index.html']) {
    const full = path.join(DESKTOP, f);
    if (!fs.existsSync(full)) continue;
    const src = stripComments(fs.readFileSync(full, 'utf-8'));
    const re = /window\.needle\.([a-zA-Z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────

describe('Electron files parse cleanly (node --check)', () => {

  for (const f of ['main.js', 'preload.js', 'host_functions/index.js',
                   'host_functions/windows.js', 'host_functions/darwin.js']) {
    it(`${f} has valid JS syntax`, () => {
      const full = path.join(DESKTOP, f);
      // Use spawnSync with array args (no shell) so this works regardless of
      // process.platform — execSync(string) routes through the platform's
      // shell, which trips when setup.ts pins process.platform='win32' on
      // a Linux CI runner.
      const r = spawnSync(process.execPath, ['--check', full], { stdio: 'pipe' });
      if (r.status !== 0) {
        throw new Error(`${f}: ${r.stderr?.toString() ?? r.error?.message ?? 'unknown'}`);
      }
    });
  }
});

describe('IPC channel contract — main ↔ preload', () => {

  it('every preload invoke() has a matching main handle()', () => {
    const handlers = extractMainHandlers();
    const invokes  = extractPreloadInvokes();
    const orphans  = [...invokes].filter(c => !handlers.has(c));
    expect(
      orphans,
      `preload invokes channels with no handler in main.js: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('every main handle() is consumed by a preload invoke()', () => {
    const handlers = extractMainHandlers();
    const invokes  = extractPreloadInvokes();
    const unused   = [...handlers].filter(c => !invokes.has(c));
    expect(
      unused,
      `main.js handles channels nothing in preload calls: ${unused.join(', ')}`,
    ).toEqual([]);
  });

  it('every preload listener has a matching main webContents.send()', () => {
    const sends    = extractMainSends();
    const listens  = extractPreloadListens();
    const orphans  = [...listens].filter(c => !sends.has(c));
    expect(
      orphans,
      `preload listens for channels that main never sends: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('every main webContents.send() has a matching preload listener', () => {
    const sends    = extractMainSends();
    const listens  = extractPreloadListens();
    const orphans  = [...sends].filter(c => !listens.has(c));
    expect(
      orphans,
      `main.js sends on channels preload doesn't listen for: ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});

describe('renderer API contract — preload ↔ renderer', () => {

  it('every window.needle.X used in renderer is exposed in preload', () => {
    const api = extractPreloadAPI();
    const used = extractRendererUsage();
    const missing = [...used].filter(k => !api.has(k));
    expect(
      missing,
      `renderer uses window.needle.X but preload doesn't expose it: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('preload exposes a non-trivial API surface (≥ 3 keys)', () => {
    const api = extractPreloadAPI();
    expect(api.size).toBeGreaterThanOrEqual(3);
  });
});
