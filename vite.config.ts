import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', display: 'display.html' } } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
