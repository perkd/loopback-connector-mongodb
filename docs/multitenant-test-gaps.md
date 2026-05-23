# Multitenant Test Coverage — Gap Analysis

## Executive Summary

Tenant routing in production (CRM services: `business`, `sales`, `membership`, etc.) is implemented by a **per-app `Multitenant` mixin** that overrides `Model.getDataSource` to read `Context.tenant` from `@perkd/multitenant-context` and dispatch to a per-tenant connection pool owned by `app.connectionManager` (from `@crm/loopback`). The juggler's contribution is two-part: (a) its DAO layer calls `Model.getDataSource()` on every operation ([`dao.js:134-146`](../../loopback-datasource-juggler/lib/dao.js#L134-L146)) and passes the result into `stillConnecting()` ([`dao.js:740-770`](../../loopback-datasource-juggler/lib/dao.js#L740-L770)) for connection-readiness handling; (b) the `model.dataSource` property descriptor on [`datasource.js:61-88`](../../loopback-datasource-juggler/lib/datasource.js#L61-L88) routes through `getDataSource()` for any caller that reads the property directly. CRM relies primarily on (a) because the `Multitenant` mixin overrides `Model.getDataSource` directly. The mongodb connector's contribution is that N independent `DataSource` instances against the same server stay isolated and lifecycle-independent.

`ModelRegistry` / `getCurrentTenant` / `getEffectiveTenant` in [`model-registry.js`](../../loopback-datasource-juggler/lib/model-registry.js) is a **separate mechanism** that handles model-fingerprint reuse and anonymous-model leak prevention. It does **not** route DAO operations to tenant DataSources in CRM and is not on the hot path. Earlier drafts of this doc conflated the two.

**Status: gaps closed.** The original three gaps and their resolutions:

1. **DAO-level resolution contract** — now pinned in [`loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js`](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js) (`DAO Resolution` describe block). One test per DAO entry point (`create`, `find`, `count`), each asserts the second-call delta is `>= 3` `getDataSource()` calls — the threshold catches wholesale memoization without coupling to exact internal call counts.
2. **`ReconnectingProxy` + `stillConnecting()/ready()` cold-pool path** — pinned in the same file (`ReconnectingProxy contract` describe block). Test proves `ready()` is called on a non-DataSource proxy returned by `getDataSource()`, the DAO call is **actually blocked** (sentinel race) until `connected` emits, and the call replays correctly.
3. **Tenant-aware dispatch contract** — pinned in [`loopback/test/multitenant-dispatch.test.js`](../../loopback/test/multitenant-dispatch.test.js) with fixture templates under [`loopback/test/fixtures/multitenant/`](../../loopback/test/fixtures/multitenant/). Four tests cover concurrent tenant resolution, per-call context read, and trap/service fallback.
4. The connector's own multi-DataSource contract remains well covered in [`test/multitenant.test.js`](../test/multitenant.test.js).

The body below preserves the gap analysis as historical record. See **Implementation Status** at the bottom for the test locations and coverage details.

---

## How Production Actually Wires Multitenancy

```
HTTP request
  → middleware sets Context.tenant via AsyncLocalStorage    (@perkd/multitenant-context)
  → multitenant-ds middleware awaits connectionManager.ensureConnection(tenant)
  → DAO call: Item.find(...)
    → invokeConnectorMethod calls Model.getDataSource()     (juggler dao.js:135)
      → Multitenant mixin override reads Context.tenant     (Multitenant.js:749)
        → app.connectionManager.getExistingConnection(tenant)
          → returns per-tenant pool DataSource, OR
          → returns ReconnectingProxy (cold pool / idle-evicted)
            → stillConnecting() calls ready(obj, args)      (juggler dao.js:740-770)
              → queues until 'connected'                     (Multitenant.js:70-118)
              → re-fires the DAO method
```

Key files:

| Layer | File | Role |
|---|---|---|
| Context source | `@perkd/multitenant-context` (external) | `AsyncLocalStorage`-backed `Context.tenant` |
| Dispatch | [`CRM/business/server/lib/common/mixins/Multitenant.js:749`](../../../CRM/business/server/lib/common/mixins/Multitenant.js#L749) | `Model.getDataSource = () => connectionManager.getExistingConnection(Context.tenant)` |
| Cold-pool proxy | [`CRM/business/server/lib/common/mixins/Multitenant.js:40-119`](../../../CRM/business/server/lib/common/mixins/Multitenant.js#L40-L119) | `ReconnectingProxy.ready()` mirrors `DataSource#ready()` so loopback queues DAO calls until the pool emits `connected` |
| Pool ownership | `@crm/loopback` `ConnectionManager` | Per-tenant `MongoClient` pool, idle eviction, single-flight creation |
| Juggler DAO | [`loopback-datasource-juggler/lib/dao.js:134-146`](../../loopback-datasource-juggler/lib/dao.js#L134-L146), [`dao.js:740-770`](../../loopback-datasource-juggler/lib/dao.js#L740-L770) | `invokeConnectorMethod` calls `Model.getDataSource()` per op; `stillConnecting()` calls `ready(obj, args)` to queue cold-pool calls |
| Juggler accessor | [`loopback-datasource-juggler/lib/datasource.js:61-88`](../../loopback-datasource-juggler/lib/datasource.js#L61-L88) | Property descriptor on `model.dataSource` that calls `getDataSource()` on every read; only relevant for callers that read the property directly |
| Connector contract | [`test/multitenant.test.js`](../test/multitenant.test.js) | N DataSources against same server stay isolated; sessions, pools, lazy connect |

`getCurrentTenant()` and `ModelRegistry` are NOT in this chain. They are used by the juggler internally for model-fingerprint reuse — a separate concern.

---

## What Is Covered Today

### Connector — `loopback-connector-mongodb` ✅

[`test/multitenant.test.js`](../test/multitenant.test.js) covers the entire contract the CRM dispatch relies on at the connector layer:

- N concurrent DataSources against the same server, fully isolated writes
- Independent `MongoClient` lifecycle (disconnect on one ≠ disconnect on others)
- Concurrent lazy-connect: exactly one connection per DataSource, no dropped query
- Session scoped to its `MongoClient`
- `maxPoolSize` flows through to the driver

Plus heap-leak detection under DataSource churn ([`leak-detection/mongodb.test.js`](../leak-detection/mongodb.test.js)), session commit/rollback cleanup ([`test/mongodb.test.js`](../test/mongodb.test.js)), and full transaction semantics behind `TEST_TRANSACTIONS=1` ([`test/transaction.test.js`](../test/transaction.test.js)).

**Verdict: complete for this repo.** No additions recommended on the connector side.

### Juggler — `loopback-datasource-juggler`

| File | Covers | Does NOT cover |
|---|---|---|
| [`test/multitenant-datasource-accessor.test.js`](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js) | Property descriptor calls `getDataSource()` when defined; falls back on error; guards circular calls; **repeated reads do not cache** ([lines 189-225](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js#L189-L225)) | DAO-level resolution — that `invokeConnectorMethod` itself re-resolves through `getDataSource()` on every operation |
| [`test/tenant-aware-model-registry.test.js`](../../loopback-datasource-juggler/test/tenant-aware-model-registry.test.js) | `ModelRegistry` tenant isolation, cleanup, stats, ref-counting | N/A — this is a different mechanism, not part of the CRM dispatch path |

---

## Gaps

### Gap 1 — DAO-level repeated resolution not pinned (High)

CRM's `Multitenant.js:5-8` documents the contract verbatim: *"Tenant isolation is ensured by loopback-datasource-juggler v5.2.8+ which properly calls getDataSource() for all database operations instead of using model.dataSource directly."*

The **accessor-level** half of this contract is already tested: [`multitenant-datasource-accessor.test.js:189-225`](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js#L189-L225) has both a repeated-read counter test (3 reads → 3 calls) and a different-return-values test. That covers `model.dataSource` reads.

The **DAO-level** half is not pinned. [`invokeConnectorMethod`](../../loopback-datasource-juggler/lib/dao.js#L134-L146) calls `Model.getDataSource()` directly — not `model.dataSource` — so the property descriptor test does not prove the DAO itself re-resolves on every operation. A refactor that memoized the resolved DataSource inside the DAO (or hoisted it out of a hot path) would silently break tenant dispatch while leaving the accessor test green.

**Risk:** High — the failure mode is silent: queries route to the original (TRAP) DataSource with no error and no log; data leaks across tenants.

### Gap 2 — `ReconnectingProxy` cold-pool path is unique to CRM and untested in either repo (Medium)

`ReconnectingProxy.ready()` ([`Multitenant.js:70-118`](../../../CRM/business/server/lib/common/mixins/Multitenant.js#L70-L118)) is a hand-rolled mirror of juggler's `DataSource#ready()`. It depends on loopback's `stillConnecting()` calling `ready(obj, args)` on whatever `getDataSource()` returns, then re-invoking `args.callee` with the same `obj` and arguments once the proxy emits `connected`.

This is the only thing that makes first-request-per-tenant work without an explicit `ensureConnection()` at every call site. A juggler change to:

- the `stillConnecting()` → `ready()` calling convention,
- whether `getDataSource()`'s return value is the thing `ready()` is called on, or
- the `args.callee` re-invoke pattern (legitimately deprecated in strict mode)

…would silently break cold-pool requests in production: the DAO call would time out or fail rather than queue.

**Where this test belongs:** the juggler, as a contract test on `stillConnecting()` + arbitrary `getDataSource()` return objects implementing `ready(obj, args)`. CRM can — and partially does — cover the behavior end-to-end through its existing multitenant test tree, but only the juggler can pin it as a **supported contract** for non-DataSource return objects. Without that, the contract lives only in CRM's `ReconnectingProxy` comment and could be broken by an upstream refactor with no juggler test failing.

**Risk:** Medium. The behavior is stable today and the `args.callee` pattern is unlikely to change without notice, but the contract is undocumented in the juggler and held together by one comment in the CRM mixin.

### Gap 3 — `model-registry.js` fallback paths not exercised (Low)

[`getCurrentTenant()`](../../loopback-datasource-juggler/lib/model-registry.js#L17-L41) has three paths: `@perkd/multitenant-context`, `global.loopbackContext`, and `null`. CRM uses none of them — it reads `Context.tenant` directly in the mixin. The juggler unit tests patch `Module.prototype.require` so the real module is never loaded, and the `global.loopbackContext` fallback has no test at all.

**Risk:** Low for CRM (this code path is not on the production hot path). Real but bounded for any non-CRM consumer that relies on `ModelRegistry`-driven dispatch — and there is no evidence any such consumer exists.

If this fallback is intended to be supported, it should be tested. If it is legacy that no current consumer uses, it should be removed and `getCurrentTenant()` simplified.

### Gap 4 — No contract test in loopback for tenant-aware dispatch (Low)

The dispatch contract — "`Model.getDataSource()` override + `app.connectionManager` + external tenant context resolves to per-tenant pools" — is owned by loopback (it provides `Model`, `app`, the model-attachment lifecycle). Yet loopback's test suite has no test pinning it. CRM's `tests/**/*.test.js` tree has many context-propagation and fix-verification tests, but a service is not the right home for a *contract* test: a service test pays for service config, boot wiring, and dependency noise that have nothing to do with the contract under test.

The gap is canonicalness and isolation, not absence of any test. The right test is small, lives in loopback, and depends on neither `@crm/loopback` nor `@perkd/multitenant-context` (both are out-of-tree).

**Note on packaging:** this gap exists in part because the production `Multitenant` mixin lives in a git submodule (`submodule-common`) that is not a real npm package. If it were, both the mixin and its tests would naturally live with it. The fixture-template approach in Rec 3 is the right pragmatic move; the underlying packaging shortcut is worth flagging separately.

**Risk:** Low — but the absence is why no one currently has a small file to point at when asked "how do we know loopback supports tenant-aware dispatch?"

### Gap 5 — No integrated real-Mongo end-to-end test of the dispatch path (Medium)

Today's coverage matrix has a hole:

| Test | Real Mongo? | Dispatch chain? |
|---|---|---|
| [`loopback-connector-mongodb/test/multitenant.test.js`](../test/multitenant.test.js) | ✓ | ✗ (5 hand-wired DataSources, no Context/CM) |
| [`loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js`](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js) | ✗ (memory) | partial (descriptor + DAO + ready/queue) |
| [`loopback/test/multitenant-dispatch.test.js`](../../loopback/test/multitenant-dispatch.test.js) | ✗ (memory + fakes) | ✓ (full, with fake CM + fake Context) |
| CRM `tests/**` | ✗ mostly mocks | partial |

Nothing currently tests **real MongoDB + real `@perkd/multitenant-context` + real DAO + real dispatch** as a single integrated path. Each existing test pins one face of the cube; none pins the corner where they meet.

**Risk:** Medium. The individual pieces are well-tested, but integration bugs at the corner (e.g. a Mongo driver quirk that interacts badly with the `getDataSource`-per-DAO-call pattern, or an AsyncLocalStorage propagation edge case that only manifests with real I/O latency) would not be caught by any current test.

---

## What This Doc Does NOT Recommend

These were in earlier drafts and have been removed because they don't reflect production reality:

- **Adding `@perkd/multitenant-context` to juggler `devDependencies`.** The juggler-internal `getCurrentTenant()` is not on the CRM production path. The module is a hard dependency of every CRM service that uses multitenancy and is already declared there. Adding it to the juggler would only matter if the juggler's `ModelRegistry`-driven dispatch is intended to be a supported path — see Gap 3.
- **A juggler-side "round-trip" integration test that wires `Context` → `ModelRegistry` → accessor → DataSource.** No production code takes that path. CRM's dispatch bypasses `ModelRegistry` entirely.

---

## Recommendations

### Rec 1 — Pin DAO-level resolution in the juggler (closes Gap 1)

**Repo:** `loopback-datasource-juggler`
**File:** `test/multitenant-datasource-accessor.test.js` — new `describe` block (the accessor-level repeated-read test at [lines 189-225](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js#L189-L225) already exists; do not duplicate it).

```js
it('DAO resolves through getDataSource() on every operation', async function() {
  const ds = new DataSource('memory');
  const Model = ds.define('M', {name: String});
  let calls = 0;
  Model.getDataSource = function() { calls++; return ds; };

  await Model.create({name: 'a'});
  await Model.find();
  await Model.count();

  assert.ok(calls >= 3, `getDataSource() should be called per DAO op, got ${calls}`);
});
```

This pins the contract at the layer CRM actually depends on. Catches any future refactor that memoizes the resolved DataSource inside `invokeConnectorMethod` or its callers.

### Rec 2 — Document and pin the `ReconnectingProxy` contract in the juggler (closes Gap 2)

**Repo:** `loopback-datasource-juggler`
**File:** `test/multitenant-datasource-accessor.test.js` — new `describe` block.

Test that when `Model.getDataSource()` returns an object with `ready(obj, args) → true`, a DAO call:

1. has `ready()` invoked on the returned object (not `_originalDataSource`),
2. is queued (not executed) until the object emits `connected`,
3. re-executes with the original `this` and arguments when `connected` fires.

This is the contract CRM's `ReconnectingProxy` relies on. Pinning it in the juggler prevents accidental regression and serves as inline documentation for the only currently-known consumer of this pattern.

### Rec 3 — Add a contract test in loopback for tenant-aware dispatch (closes Gap 4)

**Repo:** `loopback`
**Files:**
- `test/multitenant-dispatch.test.js` (new) — the contract test (~100 lines)
- `test/fixtures/multitenant/dispatch-mixin.js` — template mirroring the production mixin's `Model.getDataSource` override
- `test/fixtures/multitenant/fake-context.js` — minimal `AsyncLocalStorage` stub with `runAsTenant`
- `test/fixtures/multitenant/fake-connection-manager.js` — minimal in-memory pool registry

Why loopback and not CRM:

- The contract — "loopback supports tenant-aware Model dispatch via `Model.getDataSource` override + `app.connectionManager`" — is owned by loopback. The test belongs with the contract.
- Loopback's test runtime is clean: no service config, no boot magic, no context-package initialization noise. CRM services flood test output with trap-context fallback warnings; the loopback runtime does not.
- The fixtures depend only on `loopback`, `loopback-datasource-juggler`, and Node's `async_hooks`. No `@crm/loopback`, no `@perkd/multitenant-context`, no MongoDB. The fixture templates encode the *shape* of the production contract; they are not live mounts of the submodule code.

Drift discipline: each fixture file carries a header comment naming the upstream production file and the contract it mirrors. If the production mixin changes the dispatch surface, the fixture must mirror it. If CRM drifts the contract without updating the fixture, that's a CRM problem; if loopback breaks the contract, this test catches it before any CRM service upgrades.

Test shape:

```js
const [dsA, dsB] = await Promise.all([
  Context.runAsTenant('tenant-a', async () => {
    await app.connectionManager.ensureConnection('tenant-a');
    return TenantModel.getDataSource();
  }),
  Context.runAsTenant('tenant-b', async () => {
    await app.connectionManager.ensureConnection('tenant-b');
    return TenantModel.getDataSource();
  }),
]);
assert.notStrictEqual(dsA, dsB);
```

### Rec 4 — Decide the fate of `ModelRegistry`-driven dispatch (resolves Gap 3)

**Repo:** `loopback-datasource-juggler`

`getCurrentTenant()` + `getEffectiveTenant()` describe a tenant-routing mechanism that is not used by the only known production consumer. Two options:

- **Keep and test it** as a supported alternative path: add `@perkd/multitenant-context` to `devDependencies`, write the round-trip test, document who it's for.
- **Remove it** as unused indirection: drop `getCurrentTenant`, simplify `getEffectiveTenant` to owner-identity only, remove the `global.loopbackContext` fallback.

This is a product/architecture call, not a test-coverage one. Flagging it here because the current state — unused code paths with no tests and a confusing relationship to the mixin-based dispatch — invites exactly the kind of misunderstanding that produced the earlier drafts of this doc.

### Rec 5 — Add a real-Mongo dispatch test in the connector repo (closes Gap 5)

**Repo:** `loopback-connector-mongodb`
**File:** `test/multitenant-dispatch.test.js` (new) + `test/fixtures/dispatch-mixin.js` (new fixture) + `test/fixtures/fake-connection-manager.js` (new fixture)

Why here and not elsewhere:

- This repo already runs real MongoDB on every `npm test` ([`test/init.js`](../test/init.js), [`test/multitenant.test.js`](../test/multitenant.test.js)). The infrastructure for real-Mongo testing is already in place; no other repo has it set up out of the box.
- This is a fork (`github:perkd/loopback-connector-mongodb`) maintained for CRM, not an upstream-shippable generic component. CRM-shaped tests already live here. The "keep the connector generic" objection is theatre.
- Loopback, juggler, and `@crm/loopback` would each have to invent the real-Mongo wiring from scratch to host this test. The cost of putting it elsewhere is higher than the cost of one new devDep here.

Shape:

```js
// test/multitenant-dispatch.test.js
const {Context} = require('@perkd/multitenant-context');
const {FakeConnectionManager} = require('./fixtures/fake-connection-manager');
const applyDispatchMixin = require('./fixtures/dispatch-mixin');

describe('multi-tenant dispatch end-to-end (real Mongo)', function() {
  // Two real Mongo DataSources behind a FakeConnectionManager.
  // Two concurrent Context.runAsTenant() calls do real DAO writes.
  // Assert each write landed in the right Mongo database.
});
```

Implementation notes:

- **Add `@perkd/multitenant-context` to `devDependencies`.** One line, mirrors the source spec CRM uses.
- **Do NOT add `@crm/loopback`.** Use a 10–20 line `FakeConnectionManager` fixture — same shape as [`loopback/test/fixtures/multitenant/fake-connection-manager.js`](../../loopback/test/fixtures/multitenant/fake-connection-manager.js). The real `ConnectionManager` from `@crm/loopback` is tested in its own repo (`Packages/crm-loopback/tests/connection-manager.test.ts`); we don't need to re-test it here.
- **Copy the `Model.getDataSource` override as a fixture** (`test/fixtures/dispatch-mixin.js`) with the same header-comment drift discipline used in loopback. Do NOT depend on the production mixin source (it lives in `submodule-common`, not in any installable package).
- Use the existing `makeDataSource()` factory pattern from [`test/multitenant.test.js`](../test/multitenant.test.js) for the per-tenant Mongo pools.

This closes the matrix: real-Mongo + real-Context + real-DAO + real-dispatch, in one test, no `@crm/loopback` dependency.

---

## Implementation Status

Recs 1, 2, 3, and 5 are implemented. Rec 4 (architecture decision) remains open.

| Rec | Repo | File | Tests | Verify | Status |
|---|---|---|---|---|---|
| Rec 1 — DAO resolution | `loopback-datasource-juggler` | [`test/multitenant-datasource-accessor.test.js`](../../loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js) — `DAO Resolution` block | 3 (create/find/count, each second-call delta >= 3) | `node --require ./test/init.js --test test/multitenant-datasource-accessor.test.js` | ✓ |
| Rec 2 — ReconnectingProxy contract | `loopback-datasource-juggler` | same file — `ReconnectingProxy contract` block | 1 (queue + sentinel race + replay) | same | ✓ |
| Rec 3 — Dispatch contract | `loopback` | [`test/multitenant-dispatch.test.js`](../../loopback/test/multitenant-dispatch.test.js) + [`test/fixtures/multitenant/`](../../loopback/test/fixtures/multitenant/) | 4 (concurrent / per-call / no-tenant / service fallback) | `./node_modules/.bin/mocha test/multitenant-dispatch.test.js` | ✓ |
| Rec 5 — Real-Mongo dispatch | `loopback-connector-mongodb` | [`test/multitenant-dispatch.test.js`](../test/multitenant-dispatch.test.js) + [`test/fixtures/`](../test/fixtures/) | 3 (concurrent real-Mongo writes / per-call / trap fallback) | `node --test test/multitenant-dispatch.test.js` (needs `MONGODB_HOST` running) | ✓ |
| Connector — N-DataSource isolation | `loopback-connector-mongodb` | [`test/multitenant.test.js`](../test/multitenant.test.js) | 5 (pre-existing) | `npm test` | ✓ |

Fixtures (`dispatch-mixin.js` in this repo and in loopback, `fake-context.js` and `fake-connection-manager.js` in both) are frozen templates of the production surfaces — header comments name the upstream files they mirror. If the production mixin changes the dispatch surface, the fixture must mirror it.

**Pre-existing flake unrelated to this work:** `yarn test:unit` reports 13 cancelled tests in `decimal.test.js` and `multitenant.test.js`. Verified by running `yarn test:unit` on a clean `master` (before any of the new tests): same 13 cancellations, same `EXIT=1`. Owned by whoever maintains those files.

Together these three suites cover the full production path with no overlap and no test in the wrong repo.
