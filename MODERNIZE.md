# loopback-connector-mongodb Modernization

Brings the connector's tooling and source patterns into line with the modernization applied to the sibling `strong-remoting` project, without changing the public callback-compatible API.

## Status

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Tooling baseline — ESLint 10 flat config, c8 coverage, Yarn 4, CI/Actions bumps, drop `.travis.yml` | COMPLETED (v7.0.0-alpha.3) |
| Phase 2 | Test framework migration — `mocha + should + nyc` → `node --test` + `node:assert` + `c8` | DEFERRED — separate effort, see "Phase 2 notes" below |
| Phase 3 | Drop `async` package; rewrite `autoupdate` / `automigrate` to native `for…of` + `await` | COMPLETED (v7.0.0-alpha.3) |
| Phase 4 | Docs and version bump | COMPLETED (v7.0.0-alpha.3) |

The MongoDB driver remains on 4.6.x; the 6.x upgrade is a separate effort.

---

## Phase 1 — Tooling baseline

- `eslint`: 8.23.0 → 10.4.0; `eslint-config-loopback`: 13.1.0 → 14.0.0.
- `.eslintrc` + `.eslintignore` replaced with `eslint.config.js` (flat config) using `@eslint/eslintrc` `FlatCompat` to consume the legacy loopback ruleset under ESLint 10's flat schema.
- Resolution override pins `eslint-plugin-mocha@^11.3.0` so the loopback config's mocha rules load under ESLint 10 (the bundled `10.5.0` calls removed `context.getSourceCode`). The four mocha rules (`handle-done-callback`, `no-exclusive-tests`, `no-identical-title`, `no-nested-tests`) referenced by the loopback config were renamed/removed in plugin v11; they are explicitly disabled in `eslint.config.js` to keep lint runnable.
- `c8@^11.0.0` replaces `nyc` for coverage. Config lives in `.c8rc.json`.
- `package.json` scripts switched to Yarn-driven invocations and split into `test:unit` (own tests under `c8 mocha`) and `test:juggler` (external juggler-v4 suite).
- CI matrix realigned to Node 22 & 24 (matches `engines.node >=22`); `actions/checkout@v3 → v4`, `actions/setup-node@v3 → v4`, `github/codeql-action/*@v2 → v3`; dead `node@10` upgrade step removed; `code-lint`/`commit-lint` jobs moved to Node 22; CI bootstraps via `corepack enable && yarn install --immutable`.
- `.travis.yml` deleted (legacy; project already on GitHub Actions).
- `.gitignore` extended with Yarn Berry patterns; `.yarn/install-state.gz` untracked.
- Drive-by lint cleanup in `lib/mongodb.js` (one indentation/semicolon issue from the recent "always use optimized findOrCreate" feat; one missing semicolon at the end of a prototype assignment; one stale `eslint-disable one-var`).

## Phase 2 — Deferred

Migrating the seven test files (~5 300 lines) from `mocha + should` chained assertions to `node --test` + `node:assert` is a substantial mechanical sweep with real regression risk against 230+ currently-passing tests. It is intentionally **not** part of v7.0.0-alpha.3 and will be tracked separately. The Phase 1 c8/Yarn changes keep the existing mocha-based tests runnable in the meantime; the conversion mapping is documented in the modernization plan.

## Phase 3 — Drop the `async` package

- Removed `const async = require('async')` and the `async` production dependency.
- Three `async.eachSeries` call sites in `lib/mongodb.js` (one in `autoupdate` with a nested inner loop over indexes, one in `automigrate` with a `dropCollection`/`createCollection` body) rewritten as native `async` IIFEs using `for…of` + `await` over the MongoDB 4.x driver's Promise-returning forms.
- Public callback signatures are unchanged: each IIFE chains `.then(() => cb(), err => cb(err))`. Serial ordering and first-error-aborts semantics are preserved (identical to `async.eachSeries`).
- The `ns not found` path on `dropCollection` is handled with a `try { await ... } catch (err) { if (!isNsNotFound(err)) throw err; }` block — same `err.name === 'MongoServerError' && err.ok === 0 && err.errmsg === 'ns not found'` check as the previous callback path.

### Verification

End-to-end smoke test of the rewritten paths against MongoDB 6.0:

| Scenario | Result |
|---|---|
| `automigrate` on a missing collection | OK — `ns not found` swallowed, collection created |
| `automigrate` after inserting a row | OK — collection dropped and recreated, row gone |
| `autoupdate` after inserting a row | OK — data preserved, indexes created (model-level + property-level) |

Unit test suite: **232 passing, 14 pending, 3 failing**. The 3 failures (`updateAll extended operators ...`) exist on master prior to this work — they timeout against MongoDB 6 because the test asserts a specific server error for `$rename` validation that the local Mongo image does not surface.

Juggler-v4 suite: **1033 passing, 117 pending, 8 failing**. The 8 failures are all in `PersistedModel.createAll` (bulk insert) and trace through `lib/mongodb.js:685` — code untouched by Phase 3 — into juggler-v4's own assertion mismatch (`expected Array [ Error ] to equal Error`). Pre-existing.

## Breaking changes

None intended.

- API surface is unchanged: every method that took a callback before still takes a callback and invokes it with the same arguments.
- `async` was a production dependency but was only used internally; consumers of the connector never imported it.

## Files added / removed

**Added**: `eslint.config.js`, `.c8rc.json`, `MODERNIZE.md`.
**Removed**: `.eslintrc`, `.eslintignore`, `.travis.yml`.
**Untracked from git** (still on disk, gitignored): `.yarn/install-state.gz`.
