# Contributing to Toolkist

Thanks for considering a contribution. Toolkist is a collection of free, privacy-first developer tools that run entirely in the browser — no uploads, no backend processing, no accounts. Keeping that true is the main constraint on any change.

## Before you start

- Read [CLAUDE.md](CLAUDE.md) for project structure, code reuse conventions, and the "Off limits" list (things that are intentionally not changeable — e.g. no backend, JWT decoder never verifies signatures, regex backtracking screen must stay).
- For a new tool, check [README.md](README.md) and `src/data/tools.ts` to see if something similar already exists.
- Open an issue first for anything beyond a small fix, so we can agree on direction before you put in the work.

## Setup

```bash
npm install
npm run dev        # astro dev server
```

## Making changes

- **New shared UI** goes in `src/components/`; check there first before building new markup.
- **New shared logic** goes in `src/lib/` with a colocated `*.test.ts` file.
- **New tools** go in `src/pages/tools/<slug>.astro` and must be registered in `src/data/tools.ts`. Follow the structure of an existing tool page of a similar kind.
- Extract logic used in 2+ places into `src/lib/` rather than duplicating it.
- Match the existing Tailwind utility patterns (see the "Design system" section in [CLAUDE.md](CLAUDE.md)) rather than introducing new ones.
- All tool logic must run client-side. No new backend, no new server-side processing of user files.

## Before opening a PR

```bash
npm test            # vitest — must pass
npm run build        # astro build — must succeed
```

Check the browser console for errors on any page you touched (`npm run preview:worker` serves the build the way production does, including the usage-counter endpoint).

## Commit conventions

```
<type>(<scope>): <description>
```

- **Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- **Scopes:** `ui` (components/layouts/pages), `tools` (tool logic), `lib` (shared utilities), `data` (tools.ts/nav.ts), `worker` (counter.js), `config` (build/wrangler/deps)
- Keep the summary line under 50 characters.
- No AI-attribution trailers (e.g. "Co-Authored-By") in commits or PR descriptions.

## Pull requests

- Branch from `main`: `git checkout -b <type>/<short-description>`.
- Keep PRs focused — one tool, fix, or refactor per PR.
- Describe what changed and why; link the issue if there is one.
- CI (`npm run build`) must pass before merge.

## Reporting bugs / requesting tools

Use the issue templates. For security issues, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
