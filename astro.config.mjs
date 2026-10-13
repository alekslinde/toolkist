import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// wawoff2's compress_binding.js and decompress_binding.js only set
// module.exports inside an ENVIRONMENT_IS_NODE guard. In browser builds that
// guard is false, so the CJS wrapper gets an empty {} instead of the Emscripten
// Module object. The result: compress.js's runtimeInit Promise resolves against
// the wrong object and never fires (compress()/decompress() hang forever).
// Fix: append an unconditional module.exports assignment so the bundler always
// gets the correct Module regardless of environment.
//
// This patch has to run in TWO places, because a bare `vite.plugins` transform
// does NOT reach Vite's dep-optimizer pre-bundling pass:
//   1. As a regular Vite plugin  → covers the production Rollup build.
//   2. As an optimizeDeps.rolldownOptions plugin → covers dev-time
//      optimizeDeps pre-bundling. Without this, the pre-bundled wawoff2 in
//      node_modules/.vite/deps lacks the fix and compress()/decompress() hang
//      forever waiting on onRuntimeInitialized. (Vite 8 optimizes deps with
//      Rolldown, so the older optimizeDeps.esbuildOptions hook is ignored.)
const WAWOFF2_BINDING_RE = /wawoff2[\\/]build[\\/](compress|decompress)_binding\.js$/;
const wawoff2BindingFix = {
  name: 'wawoff2-binding-exports-fix',
  enforce: 'pre',
  transform(code, id) {
    if (WAWOFF2_BINDING_RE.test(id)) {
      // The Emscripten shell lazily requires fs/path on Node-only paths
      // (ENVIRONMENT_IS_NODE branch, readBinary/readAsync) that never execute
      // in the browser — every use is environment-guarded. Stubbing the calls
      // keeps Rolldown from externalizing Node builtins (and warning about it)
      // without touching the runtime behaviour of any live path.
      code = code
        .replace(/require\("fs"\)/g, 'undefined')
        .replace(/require\("path"\)/g, 'undefined');
      return { code: code + '\nif(typeof module!=="undefined"){module["exports"]=Module;}', map: null };
    }
  },
};

// Dev-only maintainer pages. These benchmark internal library performance
// (pdf-lib, wawoff2, canvas encoders) on synthetic fixtures — no user value —
// so they must never ship to production. They stay reachable in `npm run dev`
// but this integration deletes their emitted output from dist/ after the
// static build, so e.g. toolkist.app/tools/benchmark 404s in production.
const DEV_ONLY_ROUTES = ['tools/benchmark'];
const excludeDevOnlyPages = {
  name: 'exclude-dev-only-pages',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      for (const route of DEV_ONLY_ROUTES) {
        const target = fileURLToPath(new URL(`${route}/`, dir));
        await rm(target, { recursive: true, force: true });
        logger.info(`Excluded dev-only route from build: /${route}`);
      }
    },
  },
};

export default defineConfig({
  site: 'https://toolkist.app',
  redirects: {
    '/tools/token-defluffer': '/',
  },
  integrations: [
    // Emits sitemap-index.xml + sitemap-0.xml at build from all static routes.
    // Excludes only the dev-only /tools/benchmark page (deleted post-build by
    // excludeDevOnlyPages, so it would 404). Every registry tool now has a
    // dedicated page, so the [slug] fallback renders nothing.
    sitemap({
      filter: (page) => !page.includes('/tools/benchmark'),
    }),
    excludeDevOnlyPages,
  ],
  vite: {
    plugins: [tailwindcss(), wawoff2BindingFix],
    // The overweight chunks are deliberate, route-scoped codec payloads —
    // wawoff2 compress (~930 kB) and svgo (~560 kB) — each loaded only by the
    // single tool page that needs it. That weight is inherent to vendored
    // WASM/codecs, not accidental bloat, so the limit is raised to match the
    // largest legitimate chunk rather than worked around with lazy-loading
    // that would only delay a dependency the tool cannot run without.
    build: {
      chunkSizeWarningLimit: 1000,
    },
    optimizeDeps: {
      include: ['alpinejs', 'wawoff2/decompress', 'wawoff2/compress', 'upng-js', 'pdf-lib', 'opentype.js'],
      // Merged with Vite's dep-optimizer plugins so the wawoff2 binding fix
      // also applies during dev pre-bundling (see wawoff2BindingFix above).
      rolldownOptions: {
        plugins: [wawoff2BindingFix],
      },
    },
  },
});
