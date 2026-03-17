import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    // Studio API tests disabled — resume in a later phase
    exclude: ['tests/integration/studio-api.test.ts'],
  },
});
