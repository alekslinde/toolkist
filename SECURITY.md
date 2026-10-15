# Security Policy

## How Toolkist handles your data

Every tool in Toolkist runs entirely in your browser. There is no backend file processing — images, PDFs, fonts, JWTs, and any other input you give a tool never leave your device. The only server-side components are:

- A Cloudflare Worker that serves static assets and a `/u` usage-counter endpoint (Durable Objects) — this stores anonymous hit counts, not tool input or output.
- The Brand Assets Extractor, which fetches a URL you supply through a third-party CORS proxy (`api.allorigins.win` / `api.codetabs.com`) so it can read that site's markup from the browser. Only the URL you enter is sent; file uploads are never involved.

If you find a tool sending data somewhere it shouldn't, that's a security bug — please report it (see below).

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Instead:

1. Open a GitHub issue titled something generic (e.g. "Security contact needed") without details, **or**
2. Use GitHub's [private vulnerability reporting](https://github.com/alekslinde/toolkist/security/advisories/new) for this repository, if enabled.

Include:

- The affected tool/page and URL.
- Steps to reproduce.
- What you'd expect vs. what actually happens (e.g. "input data was sent to X when it should stay local").

We'll acknowledge reports as soon as possible and aim to ship a fix promptly given this is a small, single-maintainer project — response times are best-effort, not SLA-backed.

## Scope

In scope:
- Any client-side tool sending user input/output somewhere other than the user's own browser without clear disclosure.
- XSS, injection, or other vulnerabilities in the site itself.
- Issues with the Cloudflare Worker (`worker/counter.js`).

Out of scope:
- The JWT decoder not verifying signatures — this is intentional (decode-only, documented on the page).
- Third-party CORS proxy behavior for Brand Assets Extractor (report upstream to the proxy operator).
