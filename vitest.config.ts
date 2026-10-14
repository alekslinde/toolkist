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
          exclude: ['src/lib/a11y/**', 'src/lib/file-dropzone.test.ts'],
        },
      },
      {
        resolve: {
          alias: srcAlias,
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          // file-dropzone.test.ts wires real DOM (paste / focus). The rest of
          // src stays on node.
          include: ['src/lib/a11y/**/*.test.ts', 'src/lib/file-dropzone.test.ts'],
        },
      },
    ],
  },
});
