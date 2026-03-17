import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config';

export function getApiPort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.STUDIO_API_PORT ?? env.PORT ?? '31415';
  const value = Number(rawPort);
  return Number.isFinite(value) ? value : 31415;
}

export function createProxy(env: NodeJS.ProcessEnv = process.env) {
  const target = `http://localhost:${getApiPort(env)}`;
  return {
    '/api': {
      target,
      changeOrigin: true,
    },
    '/studio': {
      target,
      changeOrigin: true,
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['tests/component/**'],
  },
  server: {
    proxy: createProxy(),
  },
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
});
