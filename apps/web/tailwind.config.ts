import { join } from 'path';

const dir = import.meta.dirname ?? __dirname;

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(dir, 'index.html'), join(dir, 'src/**/*.{js,ts,jsx,tsx}')],
  theme: {
    extend: {},
  },
  plugins: [],
};
