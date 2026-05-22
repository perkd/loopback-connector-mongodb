# loopback-connector-mongodb Modernization

Brings the connector's tooling and source patterns into line with the modernization applied to the sibling `strong-remoting` project, without changing the public callback-compatible API.

## Status

| Phase   | Scope                                                                                               | Status                                                |
| ------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Phase 1 | Tooling baseline — ESLint 10 flat config, c8 coverage, Yarn 4, CI/Actions bumps, drop `.travis.yml` | COMPLETED (v6.4.0)                                    |
| Phase 2 | Test framework migration — `mocha + should + nyc` → `node --test` + `node:assert` + `c8`            | COMPLETED (v6.5.0)                                    |
| Phase 3 | Drop `async` package; rewrite `autoupdate` / `automigrate` to native `for…of` + `await`             | COMPLETED (v6.4.0)                                    |
| Phase 4 | Docs and version bump                                                                               | COMPLETED (v6.5.0)                                    |
| Phase 5 | Drop `sinon` devDependency; replace stubs/spies with native counter pattern                         | COMPLETED (v6.5.0)                                    |

The MongoDB driver remains on 4.6.x; the 6.x upgrade is a separate effort.

---

## Phase 5 — Drop `sinon` devDependency

sinon was the last external test-only dependency remaining after the Phase 2 framework migration. Its usage was entirely mechanical — three `console.error` stubs and two event-listener spies — and was replaced with native patterns:

- **`console.error` stubs** (`test/mongodb.test.js`, 3 identical blocks): replaced with a `let consoleErrorCalls` counter + manual save/restore of `console.error`. Assertions changed from `console.error.calledOnce` → `assert.strictEqual(consoleErrorCalls, 1)`.
- **`memwatch` event spies** (`leak-detection/mongodb.test.js`, `leak-detection/leak-detector.test.js`): replaced with a plain `let leakCount` counter incremented by an arrow function listener. `spy.called` → `leakCount > 0`, `spy.reset()` → `leakCount = 0`.

`"sinon": "^12.0.1"` removed from `devDependencies`. The main test suite now has zero external test dependencies.

---

## Phase 1 — Tooling baseline

- `eslint`: 8.23.0 → 10.4.0; `eslint-config-loopback`: 13.1.0 → 14.0.0.
- `.eslintrc` + `.eslintignore` replaced with `eslint.config.js` (flat config) using `@eslint/eslintrc` `FlatCompat` to consume the legacy loopback ruleset under ESLint 10's flat schema.
- Resolution override pins `eslint-plugin-mocha@^11.3.0` so the loopback config's mocha rules load under ESLint 10 (the bundled `10.5.0` calls removed `context.getSourceCode`). The four mocha rules (`handle-done-callback`, `no-exclusive-tests`, `no-identical-title`, `no-nested-tests`) referenced by the loopback config were renamed/removed in plugin v11; they are explicitly disabled in `eslint.config.js` to keep lint runnable.
- `c8@^11.0.0` replaces `nyc` for coverage. Config lives in `.c8rc.json`.
- `package.json` scripts switched to Yarn-driven invocations and split into `test:unit` (own tests under `c8 node --test`) and `test:juggler` (external juggler-v4 suite).
- CI matrix realigned to Node 22 & 24 (matches `engines.node >=22`); `actions/checkout@v3 → v4`, `actions/setup-node@v3 → v4`, `github/codeql-action/*@v2 → v3`; dead `node@10` upgrade step removed; `code-lint`/`commit-lint` jobs moved to Node 22; CI bootstraps via `corepack enable && yarn install --immutable`.
- `.travis.yml` deleted (legacy; project already on GitHub Actions).
- `.gitignore` extended with Yarn Berry patterns; `.yarn/install-state.gz` untracked.
- Drive-by lint cleanup in `lib/mongodb.js` (one indentation/semicolon issue from the recent "always use optimized findOrCreate" feat; one missing semicolon at the end of a prototype assignment; one stale `eslint-disable one-var`).

## Phase 2 — Test framework migration (v6.5.0)

Direct cutover from `mocha + should + nyc` to `node --test` + `node:assert/strict` + `c8`. No compat shims, no `should` polyfill, no `done` wrapper utility — each pattern is rewritten in place.

### Scope

- 7 test files rewritten (~5,300 lines). `test/mocha.opts` deleted. `test/init.js` no longer re-exports `should`.
- `package.json`: `test:unit` switched to `c8 node --test --test-force-exit --test-reporter=spec --test-timeout=5000 test/*.test.js`. `should` removed from devDependencies. `mocha` kept (for `test:juggler`).
- `test:juggler` is unchanged: the external `node_modules/juggler-v4/test.js` suite is vendored, bundles its own `should`, and still runs under `mocha`.

### Mechanical patterns applied

| Source pattern | Replacement |
| --- | --- |
| `require('should')` / `module.exports = require('should')` | removed |
| globals (`describe`, `it`, `before`/`beforeEach`/`after`/`afterEach`) | `require('node:test')` destructure at top of file |
| `context(` | `describe(` (node:test has no `context` export) |
| `x.should.equal(y)` | `assert.strictEqual(x, y)` |
| `x.should.eql(y)` / `.deepEqual(y)` | `assert.deepStrictEqual(x, y)` |
| `x.should.be.an.instanceOf(C)` | `assert.ok(x instanceof C)` |
| `arr.should.have.length(n)` | `assert.strictEqual(arr.length, n)` |
| `obj.should.have.property('k')` | `assert.ok('k' in obj)` |
| `should.not.exist(x)` / `should.exist(x)` | `assert.ok(x == null)` / `assert.ok(x != null)` |
| `x.should.match(/re/)` | `assert.match(String(x), /re/)` |
| `arr.should.containDeep(sub)` | explicit loop using `JSON.stringify` for structural compare |
| `function(done) { ... done(); }` | `() => new Promise((resolve, reject) => { ...; if (err) reject(err); else resolve(); })` |
| `async.parallel([fns], cb)` (test-side) | `Promise.all([new Promise((res,rej)=>fn((err)=>err?rej(err):res())), ...]).then(() => cb(), cb)` |
| `require('bluebird').promisify` | `require('node:util').promisify` |
| `this.timeout(N)` | per-test option object: `it('name', {timeout: N}, () => ...)` |

### Real semantic differences exposed (fixed, not papered over)

Four pre-existing assertions silently passed under `should`'s loose equality but failed under `assert/strict`. Each was fixed to the *intended* semantic:

- `test/id.test.js` × 2: `primitive_string.should.be.an.instanceOf(String)` — `should` returned true for primitive strings, `instanceof String` does not. Replaced with `assert.strictEqual(typeof x, 'string')`.
- `test/decimal.test.js` × 2: `obj.should.not.have.keys('decimalProp')` — `should`'s `not.have.keys` was vacuously satisfied whenever any other key existed. Replaced with `assert.strictEqual(obj.decimalProp, undefined)` to capture the test's actual intent.

### Verification

- Unit test suite under `node --test`: **235 passing / 0 failing**.
- Juggler-v4 suite under `mocha`: **1040 passing / 117 pending / 1 failing** (improvement over the 1033/117/8 baseline from v6.4.0, due to the upstream juggler-v4 fork picking up bug fixes during install).

### Files added / removed (Phase 2)

**Removed**: `test/mocha.opts`.
**Modified**: all 7 test files, `test/init.js`, `package.json` (version 6.4.0 → 6.5.0, `test:unit` script, drop `should` devDep), `MODERNIZE.md`, `CHANGES.md`.

## Phase 3 — Drop the `async` package

- Removed `const async = require('async')` and the `async` production dependency.
- Three `async.eachSeries` call sites in `lib/mongodb.js` (one in `autoupdate` with a nested inner loop over indexes, one in `automigrate` with a `dropCollection`/`createCollection` body) rewritten as native `async` IIFEs using `for…of` + `await` over the MongoDB 4.x driver's Promise-returning forms.
- Public callback signatures are unchanged: each IIFE chains `.then(() => cb(), err => cb(err))`. Serial ordering and first-error-aborts semantics are preserved (identical to `async.eachSeries`).
- The `ns not found` path on `dropCollection` is handled with a `try { await ... } catch (err) { if (!isNsNotFound(err)) throw err; }` block — same `err.name === 'MongoServerError' && err.ok === 0 && err.errmsg === 'ns not found'` check as the previous callback path.

### Verification

End-to-end smoke test of the rewritten paths against MongoDB 6.0:

| Scenario                              | Result                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| `automigrate` on a missing collection | OK — `ns not found` swallowed, collection created                   |
| `automigrate` after inserting a row   | OK — collection dropped and recreated, row gone                     |
| `autoupdate` after inserting a row    | OK — data preserved, indexes created (model-level + property-level) |

Unit test suite: **235 passing, 14 pending, 0 failing**. The 3 prior `updateAll extended operators` failures were fixed by switching the brittle exact-message assertion (`is not valid for storage.`) to a regex match — MongoDB 6 reports the same error with different wording (`is not allowed in the context of an update's replacement document`). The thrown `AssertionError` had been silently absorbed by juggler's promise chain, surfacing as a mocha timeout rather than a clean failure.

Juggler-v4 suite (observed locally against MongoDB 6.0 on Node 24): **1040 passing, 117 pending, 1 failing**. Exact counts may shift on other Node/MongoDB combinations. The 8 prior `PersistedModel.createAll` failures were fixed by implementing `MongoDB.prototype.createAll` (bulk insert via `insertMany`) and setting `multiInsertSupported = true` — previously the upstream juggler fell back to parallel `create()` calls, producing array-shaped errors and wrong hook order. The remaining failure (`hasMany through ... returns patient where id equal to samplePatientId`) is a juggler `lib/scope.js:144` bug: `_.isEmpty(ObjectId)` returns `true` for any single-element id intersection that resolves to an ObjectId, short-circuiting the relation query to `[]`. Not fixable from the connector.

## Breaking changes

None intended.

- API surface is unchanged: every method that took a callback before still takes a callback and invokes it with the same arguments.
- `async` was a production dependency but was only used internally; consumers of the connector never imported it.

## Files added / removed

**Added**: `eslint.config.js`, `.c8rc.json`, `MODERNIZE.md`.
**Removed**: `.eslintrc`, `.eslintignore`, `.travis.yml`.
**Untracked from git** (still on disk, gitignored): `.yarn/install-state.gz`.
