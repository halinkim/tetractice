import { defineConfig } from 'vite';

export default defineConfig({
  base: '/tetractice/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
