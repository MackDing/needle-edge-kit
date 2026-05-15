import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    setupFiles: ['./setup.ts'],
    alias: {
      // Mock react-native so we can import mobile/src/* in Node tests
      'react-native': path.resolve(__dirname, './__mocks__/react-native.ts'),
    },
  },
});
