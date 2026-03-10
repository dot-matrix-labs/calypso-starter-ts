import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: new URL('.', import.meta.url).pathname,
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      name: 'chromium',
    },
    include: ['tests/component/**/*.test.tsx'],
  },
});
