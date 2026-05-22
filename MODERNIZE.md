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
| Phase 6 | Replace `memwatch-next` (broken on Node 22+) with native `v8`/`--expose-gc` heap-growth detector; add multi-tenant leak scenario | COMPLETED (v6.6.0)                                    |
| Phase 7 | MongoDB driver upgrade `^4.6.0` → `^7.2.0`; direct cutover of all callback API sites; restore compound-operation atomicity | COMPLETED (v7.0.0)                                    |

The MongoDB driver is now on `^7.2.0`. The pre-upgrade test-hardening contract is documented in [MULTITENANT.md](MULTITENANT.md).

---

## Phase 5 — Drop `sinon` devDependency

sinon was the last external test-only dependency remaining after the Phase 2 framework migration. Its usage was entirely mechanical — three `console.error` stubs and two event-listener spies — and was replaced with native patterns:

- **`console.error` stubs** (`test/mongodb.test.js`, 3 identical blocks): replaced with a `let consoleErrorCalls` counter + manual save/restore of `console.error`. Assertions changed from `console.error.calledOnce` → `assert.strictEqual(consoleErrorCalls, 1)`.
- **`memwatch` event spies** (`leak-detection/mongodb.test.js`, `leak-detection/leak-detector.test.js`): replaced with a plain `let leakCount` counter incremented by an arrow function listener. `spy.called` → `leakCount > 0`, `spy.reset()` → `leakCount = 0`.

`"sinon": "^12.0.1"` removed from `devDependencies`. The main test suite now has zero external test dependencies.

## Phase 6 — Replace `memwatch-next` with native heap-growth detector

`memwatch-next` and `@airbnb/node-memwatch` are native (`node-gyp`) modules that stopped building on Node 22+. The entire leak-detection harness was broken as a result.

Replaced with [`leak-detection/heap-leak.js`](leak-detection/heap-leak.js) — a zero-dependency detector built on `v8.getHeapStatistics()` + `global.gc()` (exposed via `--expose-gc`). Detection logic: take a heap snapshot after a forced GC at each iteration; if the median of the later half of samples exceeds the median of the earlier half by more than 2 MB, report a leak. Rolling window of 20 samples; minimum 10 before judging.

Changes:
- `leak-detection/heap-leak.js` — new detector module (`createDetector()`)
- `leak-detection/mongodb.test.js` — `require('memwatch-next')` → `require('./heap-leak')`, `leakCount` counter pattern → `detector.start()` / `detector.sample()` / `detector.leaked()`; also added `multi-tenant DataSource churn` context (step 3 of multi-tenant hardening)
- `leak-detection/leak-detector.test.js` — same replacement; self-test still verifies the detector catches a real allocation leak
- `Makefile` — dropped `npm i @airbnb/node-memwatch --no-save || npm i memwatch-next --no-save` install step; added `--node-option=expose-gc` to mocha invocation

The leak-detection suite now runs cleanly on Node 22+ with no native module installation. Tradeoff vs `memwatch-next`: the heap-growth detector is coarser — it catches sustained multi-megabyte growth across iterations but not small per-call leaks. Increase `ITERATIONS` for higher confidence (`ITERATIONS=500 make leak-detection`).

### Verification

`ITERATIONS=30 make leak-detection` (Node 22, macOS):

| Test | Result |
|---|---|
| `leak detector › should detect a basic leak` | ✔ passing |
| `mongodb › find › should not leak when retrieving a specific item` | ✔ passing |
| `mongodb › find › should not leak when retrieving all items` | ✔ passing |
| `mongodb › create › should not leak when creating an item` | ✔ passing |
| `mongodb › create › should not leak when creating multiple items` | ✔ passing |
| `mongodb › multi-tenant DataSource churn › should not leak when DataSources are created and disconnected in a loop` | ✔ passing |

6 passing, 0 failing.

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
- Juggler-v4 suite under `mocha`: **1041 passing / 117 pending / 0 failing** (improvement over the 1033/117/8 baseline from v6.4.0, due to the upstream juggler-v4 fork picking up bug fixes during install).

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

Juggler-v4 suite (observed locally against MongoDB 6.0 on Node 24): **1041 passing, 117 pending, 0 failing**. The `scope.js:144` `_.isEmpty(ObjectId)` failure previously noted is resolved — `lodash` is deduplicated to the root `node_modules/` copy so the monkey-patch in `deps/juggler-v4/test.js` propagates correctly. Juggler-v5 suite (perkd fork): **1041 passing, 117 pending, 0 failing** — identical result, confirming the fork is behaviourally consistent with v4 for all test paths the connector exercises.

## Breaking changes

None intended.

- API surface is unchanged: every method that took a callback before still takes a callback and invokes it with the same arguments.
- `async` was a production dependency but was only used internally; consumers of the connector never imported it.

## Files added / removed

**Added**: `eslint.config.js`, `.c8rc.json`, `MODERNIZE.md`.
**Removed**: `.eslintrc`, `.eslintignore`, `.travis.yml`.
**Untracked from git** (still on disk, gitignored): `.yarn/install-state.gz`.

## Phase 7 — MongoDB driver `^4.6.0` → `^7.2.0` (v7.0.0)

Direct cutover. No `mongodb-legacy`, no adapter classes, no global compat shims. Every
site rewritten in place. Public callback API is unchanged — the established Phase 3
pattern (`.then(() => cb(), cb)`) terminates every Promise chain at the LoopBack
boundary.

### Principles applied

Same direct-cutover philosophy as Phase 2: *"No compat shims, no polyfill, no wrapper
utility — each pattern is rewritten in place."* The only targeted flag added is
`includeResultMetadata: true` at the three compound-operation sites that need
`isNewInstance`/`created` — this is the documented v7 API for compound operations, not
a shim.

### Breaking changes in the driver (and how each is addressed)

| Change | Driver version | Fix in `lib/mongodb.js` |
|---|---|---|
| Callbacks removed across all collection/cursor/session methods | v5.0.0 | All 9 callback sites converted to Promise chains |
| `result.ops` removed from insert result | v5.0.0 | `save()`: `result.ops[0]` → `data` (already in scope) |
| `findOneAndUpdate/Replace/Delete` returns document directly (no `{value, lastErrorObject}`) | v6.0.0 | `updateOrCreate`, `findOrCreate`, `upsertWithWhere`: add `includeResultMetadata: true`; `updateAttributes`: receives document directly, no change needed |
| Private import `mongodb/lib/connection_string` removed | v5.0.0 | Replaced with `new URL(url).pathname.replace(/^\//, '')` |
| `db.topology.isDestroyed()` private API removed | v5.0.0 | `execute()` reconnect guard replaced with `if (self.db)` truthiness check |
| Stale option names rejected (`poolSize`, `autoReconnect`, etc.) | v5.0.0 | Removed from `validOptionNames`; added `retryWrites`, `retryReads`, `checkKeys`, `fieldsAsRaw`, `bsonRegExp` |
| `endSession()` takes no arguments | v7.0.0 | `commit()`/`rollback()`: `endSession(null, cb)` → `endSession()` in Promise chain |

### Atomicity restorations

The initial migration split compound operations into `updateOne` + `findOne`, which
introduced a race window under concurrent writers. All three sites were restored to
single atomic `findOneAndUpdate` calls:

- **`updateOrCreate`** ([lib/mongodb.js:876](lib/mongodb.js#L876)): single
  `findOneAndUpdate({upsert:true, returnDocument:'after', includeResultMetadata:true})`.
  `isNewInstance` derived from `lastErrorObject.updatedExisting`.
- **`findOrCreate`** ([lib/mongodb.js:1535](lib/mongodb.js#L1535)): single
  `findOneAndUpdate({$setOnInsert, upsert:true, returnDocument:'after', sort, includeResultMetadata:true})`.
  `created` derived from `lastErrorObject.updatedExisting`. `filter.order` sort is now
  correctly applied (was computed but discarded in the split-operation version).
- **`upsertWithWhere`** ([lib/mongodb.js:1896](lib/mongodb.js#L1896)): single
  `findOneAndUpdate({upsert:true, returnDocument:'after', sort:{_id:1}, includeResultMetadata:true})`.
  Restores the atomic sort + update semantics of the original.

### Session cleanup fix

`commit()` and `rollback()` ([lib/mongodb.js:2162](lib/mongodb.js#L2162)) now use a
capture-then-always-end pattern: the transaction error is captured in a local variable,
`endSession()` is called unconditionally, then the original error (if any) is forwarded
to `cb`. The previous chained `.then` structure skipped `endSession()` on the failure
path.

### Test gaps closed (new in v7.0.0)

Five gaps identified by code review that no existing test covered:

| Gap | Test added |
|---|---|
| `findOrCreate` ignores `filter.order` with multiple matches | `findOrCreate should honour filter.order when multiple documents match` |
| `isNewInstance`/`created` never asserted on update/create paths | `updateOrCreate should report isNewInstance=false/true via after save hook` |
| `upsertWithWhere` non-deterministic target with multiple matches | `upsertWithWhere should update the first matching instance (lowest _id)` |
| `connect()` options not verified to reach `MongoClient` | `should forward connector settings to MongoClient (retryWrites, writeConcern)` |
| `commit`/`rollback` session leak on error path | `commit/rollback session cleanup` describe block (no replica set required) |

### Verification

| Suite | Passing | Pending | Failing |
|---|---|---|---|
| `test:unit` | 250 | 0 | 0 |
| `test:juggler` (v4) | 1045 | 113 | 0 |
| `test:juggler:v5` (perkd v5) | 1088 | 113 | 0 |

---

## Phase N — juggler-v5 mirror suite + v4 freeze documentation

- Added `deps/juggler-v5/` — a file-protocol workspace package mirroring `deps/juggler-v4/`, pointing at the perkd fork (`github:perkd/loopback-datasource-juggler#semver:^5.2.11`). Runs the same four upstream test files as the v4 suite.
- Added `test:juggler:v5` script; chained into `test` aggregate after `test:juggler`.
- Added `deps/juggler-v4/README.md` documenting the freeze posture: do not upgrade, add new coverage to `deps/juggler-v5/` or `test/*.test.js` instead.

### Verification

| Suite | Passing | Pending | Failing |
|---|---|---|---|
| `test:unit` | 235 | 0 | 0 |
| `test:juggler` (v4) | 1041 | 117 | 0 |
| `test:juggler:v5` (perkd v5) | 1041 | 117 | 0 |
