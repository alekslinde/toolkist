import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Two projects rather than one global environment: the a11y DOM engine needs
// DOMParser (jsdom), every other suite runs faster under node.
// `environmentMatchGlobs` did the same job before Vitest 4 removed it.
export default defineConfig({
  // Mirrors the "@/*" path alias in tsconfig.json so a lib module can import
  // from src/ the same way under Astro and under test.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/lib/a11y/**'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/lib/a11y/**/*.test.ts'],
        },
      },
    ],
  },
});
