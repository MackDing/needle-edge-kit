// Vitest setup — global test utilities and platform pinning.
import { afterEach } from 'vitest';

// Force a deterministic platform for host_functions/index.js tests.
// Individual tests can override via Object.defineProperty.
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

afterEach(() => {
  // Reset debounce/window state between tests by reloading time
});
