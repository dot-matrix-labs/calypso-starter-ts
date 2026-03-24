import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config';

export function getApiPort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.PORT ?? '31415';
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
  build: {
    rollupOptions: {
      // Compile the service worker as a separate top-level entry so it lands
      // at dist/sw.js and is registered from the root scope (/sw.js).
      // The SW must not be bundled with the main React chunk — it needs its
      // own global scope and cannot use ES module imports at runtime.
      input: {
        main: 'index.html',
        sw: 'src/sw.ts',
      },
      output: {
        // Keep the service worker at the root of dist/ with a stable filename
        // (no content hash) so the registration URL never changes between builds.
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') return 'sw.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
