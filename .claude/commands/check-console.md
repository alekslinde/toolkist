Check for browser console errors and fix all of them before continuing.

## Step 1 — run a clean build

```bash
npm run build
```

The build must complete with no errors. If it fails, fix the root cause — do not skip or suppress.

## Step 3 — start the preview server

```bash
npm run preview:worker
```

Use `preview:worker`, not `preview`. `astro preview` serves `dist/` as static
files with no Worker, so `/pv`, `/feedback` and `/u` return 404 on every page
and the console fills with errors that do not exist in production. Those false
positives train you to ignore real ones.

Wrangler needs ~10s to boot; wait for `Ready on http://localhost:<port>` before
starting the browser, and point the checks at that port.

## Step 4 — check for runtime console errors with a headless browser

```bash
npx puppeteer browsers install chrome 2>/dev/null; node -e "
const p = require('puppeteer');
// Port that wrangler dev reported in step 3 — never assume 3000, which is a
// common default for unrelated projects that may be running on this machine.
const BASE = process.env.BASE || 'http://localhost:8787';
(async () => {
  const browser = await p.launch({ args: ['--no-sandbox'] });
  const pages = [
    '/',
    '/tools/image-compress/',
    '/tools/image-resize/',
    '/tools/image-convert/',
    '/tools/ico-generator/',
    '/tools/pdf-compress/',
    '/tools/file-diff/',
    '/tools/font-converter/',
    '/tools/font-inspector/',
    '/tools/font-pairs/',
    '/tools/wcag-contrast/',
    '/tools/color-palette/',
    '/tools/color-gradient/',
    '/tools/tints-shades/',
    '/tools/code-formatter/',
    '/tools/code-minifier/',
    '/tools/scss-compiler/',
    '/tools/semantic-html/',
    '/tools/brand-assets/',
    '/tools/xd-to-figma/',
  ];
  let clean = true;
  for (const url of pages) {
    const pg = await browser.newPage();
    const errors = [];
    pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    pg.on('pageerror', e => errors.push(e.message));
    // Failed requests count too: a 404 is a successful response, so a bare
    // .catch() in page code hides it from 'console' but not from here.
    pg.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
    await pg.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 15000 });
    if (errors.length) {
      console.error('ERRORS on ' + url + ':');
      errors.forEach(e => console.error('  ' + e));
      clean = false;
    } else {
      console.log('OK: ' + url);
    }
    await pg.close();
  }
  await browser.close();
  process.exit(clean ? 0 : 1);
})();
"
```

If puppeteer is not available, fall back to checking each page manually in a browser and noting any red entries in the Console tab.

## Step 5 — fix every error found

For each error:
1. Identify the source file and line from the stack trace.
2. Fix the root cause — do not silence errors with `try/catch` unless the error is genuinely recoverable.
3. Re-run steps 1–4 after fixing to confirm clean.

## Pass criteria

All 20 pages (home + 19 tool pages) must load with zero console errors and zero uncaught exceptions before continuing to the next action.
