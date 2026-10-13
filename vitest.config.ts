import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors the "@/*" path alias in tsconfig.json so a lib module can import
// from src/ the same way under Astro and under test. Defined per-project:
// Vitest 4 projects do not inherit root `resolve` settings.
const srcAlias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: srcAlias,
  },
  test: {
    projects: [
      {
        resolve: {
          alias: srcAlias,
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/lib/a11y/**'],
        },
      },
      {
        resolve: {
          alias: srcAlias,
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/lib/a11y/**/*.test.ts'],
        },
      },
    ],
  },
});
