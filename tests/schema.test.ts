/**
 * Tests for mobile/src/schema.ts — the argument validator used by the router.
 * These are pure-logic tests; no react-native imports.
 */

import { describe, it, expect } from 'vitest';
import { validateArgs } from '../mobile/src/schema';

describe('validateArgs', () => {
  it('accepts valid args for a known tool', () => {
    const err = validateArgs('set_light_brightness', { room: 'living_room', level: 30 });
    expect(err).toBeNull();
  });

  it('rejects missing required field', () => {
    const err = validateArgs('set_light_brightness', { level: 30 });
    expect(err).toMatch(/missing required/);
    expect(err).toMatch(/room/);
  });

  it('rejects unknown argument', () => {
    const err = validateArgs('set_light_brightness', { room: 'bedroom', level: 30, mystery: 'x' });
    expect(err).toMatch(/unknown arg/);
    expect(err).toMatch(/mystery/);
  });

  it('rejects wrong type — integer expected, string given', () => {
    const err = validateArgs('set_light_brightness', { room: 'bedroom', level: 'thirty' });
    expect(err).toMatch(/level must be integer/);
  });

  it('rejects enum mismatch', () => {
    const err = validateArgs('set_light_brightness', { room: 'attic', level: 50 });
    expect(err).toMatch(/must be one of/);
  });

  it('rejects unknown tool name', () => {
    const err = validateArgs('summon_dragon', {});
    expect(err).toMatch(/no schema/);
  });

  it('accepts boolean parameter', () => {
    const err = validateArgs('lock_door', { door: 'front', locked: true });
    expect(err).toBeNull();
  });

  it('rejects boolean parameter given string', () => {
    const err = validateArgs('lock_door', { door: 'front', locked: 'yes' });
    expect(err).toMatch(/locked must be boolean/);
  });

  it('tolerates optional parameters being absent', () => {
    // play_music has all optional params
    const err = validateArgs('play_music', {});
    expect(err).toBeNull();
  });

  it('accepts partial optionals', () => {
    const err = validateArgs('play_music', { genre: 'jazz' });
    expect(err).toBeNull();
  });
});
