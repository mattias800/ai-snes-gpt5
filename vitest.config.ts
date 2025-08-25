import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    environment: 'node',
    reporters: ['dot'],
    include: ['tests/**/*.test.ts'],
    globals: true,
    logHeapUsage: true,
    silent: false,
    testTimeout: 2000,
    hookTimeout: 2000
  }
});

