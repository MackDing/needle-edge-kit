// Test-only stub of the react-native module surface that mobile/src/* uses.
// Each NativeModule returns vi.fn() so tests can assert call shapes.

import { vi } from 'vitest';

const makeNativeModule = () =>
  new Proxy({}, {
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return undefined;
      return vi.fn(async (...args: unknown[]) => ({ called: prop, args }));
    },
  });

export const NativeModules = new Proxy({}, {
  get: () => makeNativeModule(),
});

export const Platform = { OS: 'ios', Version: '17.0' };
