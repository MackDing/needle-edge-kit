/**
 * Contract tests — every tool name in JSON must have a matching native handler,
 * and every handler must have a matching tool definition. No orphans, no gaps.
 *
 * This catches the most common cause of tool-call failures: silent typos and
 * forgotten tools when adding a new domain.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

function readJSON<T = unknown>(p: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8')) as T;
}

function readText(p: string): string {
  return fs.readFileSync(path.join(ROOT, p), 'utf-8');
}

/** Extract handler keys from a JS module that exports `module.exports = { name: fn, ... }`. */
function extractHandlerKeys(jsText: string): string[] {
  // Match top-level keys inside `module.exports = { ... };`
  // We do this by parsing the export block and listing identifier-style keys.
  const match = jsText.match(/module\.exports\s*=\s*\{([\s\S]*)\};?\s*$/m);
  if (!match) return [];
  const body = match[1];
  // Strip block comments and line comments to avoid false positives.
  const clean = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // Find identifier-like keys that look like  word: ([{async]
  const keys = new Set<string>();
  const re = /^\s*([a-z_][a-zA-Z0-9_]*)\s*:\s*async\s*\(/gm;
  let m;
  while ((m = re.exec(clean)) !== null) keys.add(m[1]);
  return [...keys];
}

/** Extract handler keys from `mobile/src/handlers.ts` (TS object literal).
 *  Note: the type annotation contains '=' from '=>' arrows, so we can't use
 *  `[^=]*` to skip past it. Instead, skip everything up to the first '{'. */
function extractTSHandlerKeys(tsText: string): string[] {
  const match = tsText.match(/const\s+handlers\b[^{]*\{([\s\S]*?)\n\};/m);
  if (!match) return [];
  const body = match[1];
  const keys = new Set<string>();
  const re = /^\s*([a-z_][a-zA-Z0-9_]*)\s*:\s*\(/gm;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return [...keys];
}

/** Extract handler keys from `web/static/app.js` (object literal). */
function extractWebHandlerKeys(jsText: string): string[] {
  const match = jsText.match(/const browserHandlers\s*=\s*\{([\s\S]*?)\n\};/m);
  if (!match) return [];
  const body = match[1];
  const keys = new Set<string>();
  const re = /^\s*([a-z_][a-zA-Z0-9_]*)\s*:\s*async\s*\(/gm;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return [...keys];
}

// ──────────────────────────────────────────────────────────────────────

describe('tool schema JSON files', () => {
  const files = [
    'tools/example_tools.json',
    'desktop/tools/desktop_tools.json',
    'web/tools/web_tools.json',
  ];

  for (const f of files) {
    it(`${f} is valid and well-formed`, () => {
      const tools = readJSON<any[]>(f);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      for (const tool of tools) {
        expect(tool, JSON.stringify(tool)).toHaveProperty('name');
        expect(typeof tool.name).toBe('string');
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);  // snake_case
        expect(tool).toHaveProperty('description');
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(10);   // not a one-word stub
        expect(tool).toHaveProperty('parameters');
        expect(tool).toHaveProperty('required');
        expect(Array.isArray(tool.required)).toBe(true);

        // Every `required` must exist in `parameters`
        for (const req of tool.required) {
          expect(tool.parameters, `${tool.name}.${req}`).toHaveProperty(req);
        }
      }
    });
  }

  it('no duplicate tool names within a file', () => {
    for (const f of files) {
      const tools = readJSON<any[]>(f);
      const names = tools.map(t => t.name);
      expect(new Set(names).size, `${f} has duplicates`).toBe(names.length);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────

describe('scenario JSON files', () => {
  const files = [
    'scenarios/example_smart_home.json',
    'desktop/scenarios/desktop_actions.json',
  ];

  for (const f of files) {
    it(`${f} is valid and has enough scenarios`, () => {
      const doc = readJSON<{ scenarios: string[]; domain?: string }>(f);
      expect(doc).toHaveProperty('scenarios');
      expect(Array.isArray(doc.scenarios)).toBe(true);
      // We want ≥ 50 for the smallest viable training set (paired with Gemini augmentation)
      expect(doc.scenarios.length, `${f} has only ${doc.scenarios.length}`).toBeGreaterThanOrEqual(50);

      for (const s of doc.scenarios) {
        expect(typeof s).toBe('string');
        expect(s.length).toBeGreaterThan(0);
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────────────

describe('handler ↔ tool contract', () => {

  it('desktop windows.js exports a handler for every desktop_tools.json entry', () => {
    const tools = readJSON<any[]>('desktop/tools/desktop_tools.json').map(t => t.name);
    const handlers = extractHandlerKeys(readText('desktop/host_functions/windows.js'));

    const missing = tools.filter(t => !handlers.includes(t));
    const orphan  = handlers.filter(h => !tools.includes(h));
    expect(missing, `tools without windows.js handler: ${missing.join(', ')}`).toEqual([]);
    expect(orphan,  `windows.js handlers without tool: ${orphan.join(', ')}`).toEqual([]);
  });

  it('desktop darwin.js exports a handler for every desktop_tools.json entry', () => {
    const tools = readJSON<any[]>('desktop/tools/desktop_tools.json').map(t => t.name);
    const handlers = extractHandlerKeys(readText('desktop/host_functions/darwin.js'));

    const missing = tools.filter(t => !handlers.includes(t));
    const orphan  = handlers.filter(h => !tools.includes(h));
    expect(missing, `tools without darwin.js handler: ${missing.join(', ')}`).toEqual([]);
    expect(orphan,  `darwin.js handlers without tool: ${orphan.join(', ')}`).toEqual([]);
  });

  it('windows.js and darwin.js expose identical handler key sets', () => {
    const win = new Set(extractHandlerKeys(readText('desktop/host_functions/windows.js')));
    const mac = new Set(extractHandlerKeys(readText('desktop/host_functions/darwin.js')));
    const onlyWin = [...win].filter(k => !mac.has(k));
    const onlyMac = [...mac].filter(k => !win.has(k));
    expect(onlyWin, `only in windows.js: ${onlyWin.join(', ')}`).toEqual([]);
    expect(onlyMac, `only in darwin.js: ${onlyMac.join(', ')}`).toEqual([]);
  });

  it('mobile handlers.ts covers every example_tools.json entry', () => {
    const tools = readJSON<any[]>('tools/example_tools.json').map(t => t.name);
    const handlers = extractTSHandlerKeys(readText('mobile/src/handlers.ts'));

    const missing = tools.filter(t => !handlers.includes(t));
    const orphan  = handlers.filter(h => !tools.includes(h));
    expect(missing, `tools without mobile handler: ${missing.join(', ')}`).toEqual([]);
    expect(orphan,  `mobile handlers without tool: ${orphan.join(', ')}`).toEqual([]);
  });

  it('web app.js browserHandlers covers every web_tools.json entry', () => {
    const tools = readJSON<any[]>('web/tools/web_tools.json').map(t => t.name);
    const handlers = extractWebHandlerKeys(readText('web/static/app.js'));

    const missing = tools.filter(t => !handlers.includes(t));
    const orphan  = handlers.filter(h => !tools.includes(h));
    expect(missing, `tools without web handler: ${missing.join(', ')}`).toEqual([]);
    expect(orphan,  `web handlers without tool: ${orphan.join(', ')}`).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────

describe('platform router safety', () => {
  it('PLATFORM_FILES only lists platforms whose impl exists on disk', () => {
    // Scan ONLY the PLATFORM_FILES object literal, not comments or unrelated
    // strings elsewhere in the file.
    const src = readText('desktop/host_functions/index.js');
    const mapMatch = src.match(/PLATFORM_FILES\s*=\s*\{([\s\S]*?)\};/m);
    expect(mapMatch, 'PLATFORM_FILES object not found in index.js').toBeTruthy();
    const re = /['"](\.\/[a-z_][a-z0-9_]*)['"]/g;
    let m;
    while ((m = re.exec(mapMatch![1])) !== null) {
      const rel = m[1];
      const full = path.join(ROOT, 'desktop/host_functions', rel + '.js');
      expect(fs.existsSync(full), `PLATFORM_FILES maps to ${rel} but ${rel}.js is missing`).toBe(true);
    }
  });
});
