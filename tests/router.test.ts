/**
 * Tests for mobile/src/router.ts — whitelist, validation, debounce, danger gate.
 *
 * The router imports handlers.ts (which imports react-native), so we mock that
 * via vitest config alias. The mocked NativeModules returns spy functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Re-import router fresh in each test to reset the module-level RECENT debounce map
async function freshRouter() {
  vi.resetModules();
  return await import('../mobile/src/router');
}

describe('routeToolCalls', () => {

  it('rejects unknown tool', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([{ name: 'nope_does_not_exist', arguments: {} }]);
    expect(out).toHaveLength(1);
    expect(out[0].error).toBe('unknown_tool');
  });

  it('rejects invalid args via schema validator', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([
      { name: 'set_light_brightness', arguments: { room: 'mars', level: 50 } },
    ]);
    expect(out[0].error).toMatch(/invalid_args/);
  });

  it('dispatches valid calls and returns the handler result', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([
      { name: 'set_light_brightness', arguments: { room: 'living_room', level: 40 } },
    ]);
    // Our react-native mock returns { called, args }
    expect(out[0].error).toBeUndefined();
    expect(out[0].ok).toBeDefined();
  });

  it('debounces identical calls within 1.5s', async () => {
    const { routeToolCalls } = await freshRouter();
    const call = { name: 'set_light_brightness', arguments: { room: 'living_room', level: 40 } };
    const a = await routeToolCalls([call]);
    const b = await routeToolCalls([call]);
    expect(a[0].ok).toBeDefined();
    expect(b[0].error).toBe('debounced');
  });

  it('does not debounce different args', async () => {
    const { routeToolCalls } = await freshRouter();
    const a = await routeToolCalls([
      { name: 'set_light_brightness', arguments: { room: 'living_room', level: 40 } },
    ]);
    const b = await routeToolCalls([
      { name: 'set_light_brightness', arguments: { room: 'bedroom', level: 40 } },
    ]);
    expect(a[0].ok).toBeDefined();
    expect(b[0].ok).toBeDefined();
  });

  it('blocks dangerous tool when no confirm provided', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([
      { name: 'lock_door', arguments: { door: 'front', locked: false } },
    ]);
    expect(out[0].error).toBe('user_rejected');
  });

  it('proceeds with dangerous tool when confirm returns true', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls(
      [{ name: 'lock_door', arguments: { door: 'front', locked: false } }],
      { confirm: async () => true },
    );
    expect(out[0].error).toBeUndefined();
    expect(out[0].ok).toBeDefined();
  });

  // (handler-exception capture is covered by host_functions.test.ts where we
  // can inject a throwing impl without polluting other tests' module cache.)

  it('processes a batch of calls in order', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([
      { name: 'set_light_brightness', arguments: { room: 'living_room', level: 10 } },
      { name: 'play_music',           arguments: { genre: 'jazz' } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].ok).toBeDefined();
    expect(out[1].ok).toBeDefined();
  });

  it('returns empty array for empty input', async () => {
    const { routeToolCalls } = await freshRouter();
    const out = await routeToolCalls([]);
    expect(out).toEqual([]);
  });
});
