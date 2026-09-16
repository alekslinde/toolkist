Complete checklist to ship a finished feature or fix to production.

## From a feature branch

```bash
git checkout main
git merge feature/<name>
npm run deploy        # astro build + wrangler deploy to Cloudflare
```

Then prepend an entry to `changelog.json` for any user-visible change. The file is ordered newest-first and the header version is read from the first entry, so the new entry goes at the top: `{ "version", "date": "YYYY-MM-DD", "changes": [...] }`.

## From main (bug fix, copy change, small tweak)

```bash
npm run deploy
```

## Checklist before deploying

- [ ] Build completed with no errors
- [ ] All tool pages present in `dist/tools/`
- [ ] Changelog entry added for any user-visible change
- [ ] Tested in browser via `npm run preview` — golden path works, no console errors

## Cloudflare deployment note

`wrangler deploy` publishes `dist/` via the Worker in `worker/counter.js`, which serves the static assets and the endpoints defined in that file. If the deploy succeeds but the live site looks wrong, check that `astro build` ran successfully before deploying.

Runtime secrets are set with `wrangler secret put <NAME>`; the Worker reads them from `env`. See `worker/counter.js` for which are required.
