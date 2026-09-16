// Opt out of deprecated Privacy Sandbox / storage APIs that third-party
// injected scripts (e.g. Cloudflare Analytics beacon) attempt to use.
const PERMISSIONS_POLICY = [
  'interest-cohort=()',
  'join-ad-interest-group=()',
  'run-ad-auction=()',
  'attribution-reporting=()',
  'browsing-topics=()',
  'shared-storage=()',
  'shared-storage-select-url=()',
  'private-state-token-issuance=()',
  'private-state-token-redemption=()',
].join(', ');

// ── Counter Durable Object ────────────────────────────────────────────────────
export class Counter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    // Coerce to a number: guards against legacy/non-numeric stored values that
    // would otherwise turn `value += 1` into string concatenation.
    const stored = await this.state.storage.get('value');
    let value = Number(stored);
    if (!Number.isFinite(value)) value = 0;

    if (action === 'up') {
      value += 1;
      await this.state.storage.put('value', value);
    } else if (action === 'try_up') {
      // Atomic check-and-increment: only increments if value < limit.
      // Returns { value, allowed } so the caller knows whether to proceed.
      const limit = parseInt(params.get('limit') || '0', 10);
      if (value < limit) {
        value += 1;
        await this.state.storage.put('value', value);
        return Response.json({ value, allowed: true });
      }
      return Response.json({ value, allowed: false });
    }

    return Response.json({ value });
  }
}

// ── Rate limit helpers ────────────────────────────────────────────────────────

async function hashIP(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip || 'unknown'));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Feedback Durable Object ───────────────────────────────────────────────────
// Stores bad-output reports as rows in SQLite. One DO instance ("feedback").
export class FeedbackStore {
  constructor(state) {
    this.state = state;
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        INTEGER NOT NULL,
        ip_hash   TEXT    NOT NULL,
        day       TEXT    NOT NULL,
        content_hash TEXT NOT NULL,
        original  TEXT    NOT NULL,
        compressed TEXT   NOT NULL,
        note      TEXT    NOT NULL DEFAULT ''
      )
    `);
  }

  async fetch(request) {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'submit') {
      const { ipHash, day, contentHash, original, compressed, note } = await request.json();

      // Dedup: same IP + same content hash on the same day → reject
      const dup = this.state.storage.sql
        .exec('SELECT 1 FROM reports WHERE ip_hash=? AND content_hash=? AND day=? LIMIT 1', ipHash, contentHash, day)
        .toArray();
      if (dup.length > 0) return Response.json({ ok: false, reason: 'duplicate' });

      // Per-IP daily cap: max 10 reports/IP/day
      const count = this.state.storage.sql
        .exec('SELECT COUNT(*) as n FROM reports WHERE ip_hash=? AND day=?', ipHash, day)
        .toArray()[0].n;
      if (count >= 10) return Response.json({ ok: false, reason: 'rate_limited' });

      this.state.storage.sql.exec(
        'INSERT INTO reports (ts,ip_hash,day,content_hash,original,compressed,note) VALUES (?,?,?,?,?,?,?)',
        Date.now(), ipHash, day, contentHash, original, compressed, note
      );
      return Response.json({ ok: true });
    }

    if (action === 'list') {
      const rows = this.state.storage.sql
        .exec('SELECT id,ts,original,compressed,note FROM reports ORDER BY id DESC LIMIT 500')
        .toArray();
      return Response.json({ rows });
    }

    return new Response('Bad request', { status: 400 });
  }
}

// ── Counter key registry ──────────────────────────────────────────────────────
// Canonical list of all counter keys in use. Kept as documentation of the valid
// key space; HTML injection now fetches only the current page's h-<slug> counter
// (see below) rather than fanning out across this whole list.

// eslint-disable-next-line no-unused-vars
const COUNTER_KEYS = [
  'font', 'img', 'diff', 'color', 'brand', 'pdf', 'code', 'xd',
  // per-tool helpful counts
  'h-brand-assets', 'h-code-formatter', 'h-code-minifier', 'h-color-extractor',
  'h-color-gradient', 'h-color-namer', 'h-color-palette', 'h-file-diff',
  'h-font-converter', 'h-ico-generator', 'h-image-convert',
  'h-pdf-compress', 'h-pdf-convert', 'h-pdf-organiser', 'h-scss-compiler',
  'h-semantic-html', 'h-svg-validator', 'h-tints-shades', 'h-token-saver',
  'h-wcag-contrast', 'h-xd-to-figma',
  // per-tool page-view counts
  'pv-brand-assets', 'pv-code-formatter', 'pv-code-minifier', 'pv-color-extractor',
  'pv-color-gradient', 'pv-color-namer', 'pv-color-palette', 'pv-file-diff',
  'pv-font-converter', 'pv-ico-generator',
  'pv-image-compress', 'pv-image-convert', 'pv-image-resize', 'pv-pdf-compress',
  'pv-pdf-convert', 'pv-pdf-organiser', 'pv-scss-compiler', 'pv-semantic-html',
  'pv-svg-validator', 'pv-tints-shades', 'pv-token-saver', 'pv-wcag-contrast',
  'pv-xd-to-figma',
];

// ── Main worker ───────────────────────────────────────────────────────────────

// Hosts that must hand traffic to the canonical domain. Kept as an explicit
// list so a request arriving on an unexpected host is served normally rather
// than bounced somewhere it did not ask for.
const CANONICAL_HOST = 'toolkist.app';
const LEGACY_HOSTS = new Set(['lindetoolbox.com', 'www.lindetoolbox.com']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Legacy-domain redirect ────────────────────────────────────────────────
    // Runs before every other handler so a request on the old domain never
    // reaches counter or feedback state. Path, query and hash are preserved so
    // deep links survive the move; 301 lets search engines transfer ranking.
    if (LEGACY_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = 'https:';
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }

    // run_worker_first is "/*" (see wrangler.toml), so every request lands here,
    // including static assets. Anything that is not an API route and not a tool
    // page needs no Worker logic, so hand it to the asset layer immediately
    // rather than falling through the handlers below.
    const API_PATHS = new Set(['/pv', '/feedback', '/u']);
    if (!API_PATHS.has(url.pathname) && !/^\/tools\/[a-z][a-z0-9-]*\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // ── Page-view counter ─────────────────────────────────────────────────────
    if (url.pathname === '/pv' && request.method === 'POST') {
      const slug = url.searchParams.get('s');
      if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
        return new Response('Bad request', { status: 400 });
      }
      const key  = `pv-${slug}`;
      const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
      await stub.fetch(new Request(`https://x/?action=up`, { method: 'GET' }));
      return new Response(null, { status: 204 });
    }

    // ── Feedback ───────────────────────────────────────────────────────────────
    if (url.pathname === '/feedback') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'https://toolkist.app') {
        return new Response('Forbidden', { status: 403 });
      }

      // Admin read — Bearer token required
      if (request.method === 'GET') {
        const auth   = request.headers.get('Authorization') || '';
        const secret = env.FEEDBACK_SECRET;
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response('Unauthorized', { status: 401 });
        }
        const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        return stub.fetch(new Request('https://x/?action=list'));
      }

      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) {
          return new Response('Bad request', { status: 400 });
        }

        const { original, compressed, note = '' } = body;

        // Payload validation
        if (
          typeof original   !== 'string' || original.length   < 10 || original.length   > 2000 ||
          typeof compressed !== 'string' || compressed.length  < 1  || compressed.length > 2000 ||
          typeof note       !== 'string' || note.length > 280
        ) {
          return new Response('Bad request', { status: 400 });
        }

        const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
        const day = new Date().toISOString().slice(0, 10);

        // Hash IP for storage (no PII retained)
        const ipHash = await hashIP(ip);

        // Hash content so we can dedup without storing the IP alongside raw text
        const contentRaw  = original + '\x00' + compressed;
        const contentBuf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contentRaw));
        const contentHash = Array.from(new Uint8Array(contentBuf)).slice(0, 8)
          .map(b => b.toString(16).padStart(2, '0')).join('');

        const stub   = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        const result = await (await stub.fetch(new Request('https://x/?action=submit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ipHash, day, contentHash, original, compressed, note }),
        }))).json();

        if (result.reason === 'duplicate') {
          return Response.json({ ok: false, error: 'Already reported.' }, { status: 409 });
        }
        if (result.reason === 'rate_limited') {
          return Response.json({ ok: false, error: 'Too many reports today.' }, { status: 429 });
        }

        return Response.json({ ok: true });
      }

      return new Response('Method not allowed', { status: 405 });
    }

    // ── Usage counter ──────────────────────────────────────────────────────────
    if (url.pathname === '/u') {
      const key = url.searchParams.get('k');
      if (!key || !/^[a-z][a-z0-9-]*$/.test(key)) {
        return new Response('Bad request', { status: 400 });
      }

      const action = request.method === 'POST' ? 'up' : 'get';
      const doUrl  = new URL(request.url);
      doUrl.searchParams.set('action', action);
      const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
      return stub.fetch(new Request(doUrl, { method: 'GET', headers: request.headers }));
    }

    // ── Static assets + HTML count injection ───────────────────────────────────
    const response = await env.ASSETS.fetch(request);
    const ct = response.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) return response;

    // Only the HelpfulButton reads window.__C__, and only its own h-<slug>
    // counter. So fetch just that one Durable Object for a tool page instead of
    // fanning out to every counter in the catalog on every HTML request.
    const counts = {};
    const toolMatch = url.pathname.match(/^\/tools\/([a-z][a-z0-9-]*)\/?$/);
    if (toolMatch) {
      const key = `h-${toolMatch[1]}`;
      try {
        const doUrl = new URL(url.href);
        doUrl.searchParams.set('action', 'get');
        const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
        const r    = await stub.fetch(new Request(doUrl, { method: 'GET' }));
        const { value } = await r.json();
        counts[key] = value ?? 0;
      } catch (_) {}
    }

    const html     = await response.text();
    const script   = `<script>window.__C__=${JSON.stringify(counts)}</script>`;
    const injected = html.replace('</head>', script + '</head>');

    const headers = new Headers(response.headers);
    headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    return new Response(injected, { status: response.status, headers });
  },
};
