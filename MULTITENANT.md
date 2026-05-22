# loopback-connector-mongodb — Multi-Tenancy Posture & Contract

This document defines how `loopback-connector-mongodb` participates in multi-tenant
deployments. It is a **posture and contract** document, not a changelog. Its purpose
is to give upgrade reviewers (notably the pending `mongodb` driver `4.x → 7.x` bump)
a single, factual reference for what the connector does, does not do, and guarantees
under multi-tenant load.

For the upstream multi-tenant mechanism (tenant context, tenant-aware model registry,
DataSource accessor), see `MULTITENANT.md` in the perkd fork of
[`loopback-datasource-juggler`](https://github.com/perkd/loopback-datasource-juggler)
consumed via [`deps/juggler-v5/`](deps/juggler-v5/package.json).

---

## Overview

This connector is **single-database per `DataSource` instance**. Multi-tenant behavior
is the **consumer's** responsibility, achieved by instantiating one `DataSource` per
tenant (typically driven by the tenant-aware `Model.getDataSource()` override in the
perkd juggler fork). This document defines the contract the connector upholds for
that pattern.

The connector itself has no notion of "tenant". A `grep -rni tenant lib/` returns zero
hits, and the codebase has exactly one `client.db(...)` call site at
[lib/mongodb.js:388](lib/mongodb.js#L388), which selects a database **once** at
connect time and binds it to the connector instance for its full lifetime.

## What this connector does NOT do

The following are deliberate non-features. Consumers (or the upstream juggler fork)
provide them:

- **No tenant abstraction.** No `tenant`, `multitenant`, `useDb`, or `selectDb` APIs
  anywhere in `lib/`.
- **No per-call database switching.** The `Db` handle is acquired once at
  [lib/mongodb.js:388](lib/mongodb.js#L388) and reused for every operation on that
  `DataSource`. The connector never calls `client.db(otherName)` mid-lifetime.
- **No tenant-keyed connection cache.** Each `DataSource` owns exactly one
  `MongoClient` ([lib/mongodb.js:355](lib/mongodb.js#L355)) and one `Db`. There is
  no `Map<tenantCode, MongoClient>` and no shared client across DataSources.
- **No tenant context awareness.** The connector does not read
  `@perkd/multitenant-context`, `Context.tenant`, or `global.loopbackContext`. Tenant
  resolution happens entirely in the juggler layer before the call reaches the
  connector.
- **No cross-DataSource transaction coordination.** Sessions are scoped to the
  `MongoClient` that created them; the connector does not bridge sessions across
  DataSources.

## Where multi-tenancy actually lives

Multi-tenancy in deployments using this connector emerges from two layers above it:

1. **The perkd `loopback-datasource-juggler` fork** (`5.2.11`, pulled in via
   [`deps/juggler-v5/`](deps/juggler-v5/package.json)). Relevant pieces:
   - `lib/model-registry.js` — `TenantRegistry` keyed by tenant code; resolves the
     active tenant via `getCurrentTenant()` which reads `Context.tenant` from
     `@perkd/multitenant-context`, with a `global.loopbackContext` fallback.
   - A property descriptor on `model.dataSource` that calls a consumer-provided
     `Model.getDataSource()` override and returns a tenant-specific `DataSource`.
2. **The `@perkd/multitenant-context` package** — runtime contract injected by the
   consumer application (typically AsyncLocalStorage-backed). This connector does
   **not** depend on it; it is a peer contract of the juggler fork.

From the connector's perspective, "multi-tenant" simply means **N concurrent
`DataSource` instances, each owning its own `MongoClient` and `Db`, against the same
MongoDB server.** That is the production shape this connector must remain correct
under.

## The connector contract under multi-tenant load

These properties are what consumers of this connector can rely on. Each is stated as
a testable invariant; the test that proves it is cross-referenced in the *Test
coverage map* below.

1. **Isolation.** N concurrent `DataSource` instances against the same MongoDB
   server are fully isolated: writes via DataSource A never appear in DataSource B's
   `Db`, even when both target the same cluster.
2. **Independent lifecycle.** Calling `disconnect()`
   ([lib/mongodb.js:2033-2055](lib/mongodb.js#L2033-L2055)) on one `DataSource` has
   no observable effect on any other `DataSource`, even when they share an
   underlying MongoDB server.
3. **Concurrent lazy connect.** With `lazyConnect: true`, N concurrent first-use
   queries across N `DataSource` instances each establish exactly one connection.
   No `DataSource` connects twice; no query is dropped.
4. **Session scoping.** Transactions and sessions are scoped to the `MongoClient`
   that opened them. Session merging in `buildOptions()`
   ([lib/mongodb.js:2510](lib/mongodb.js#L2510)) never leaks a session from
   DataSource A into an operation on DataSource B.
5. **Pool option compatibility.** Both `poolSize` (legacy, mongodb 4.x) and
   `maxPoolSize` (mongodb 6.x+) are accepted at
   [lib/mongodb.js:238](lib/mongodb.js#L238). Consumers can write either and get the
   expected pool size regardless of underlying driver version.

## Driver-version risk surface

The pending `mongodb` driver upgrade from `4.6.x` to `7.x` will stress, in order of
impact:

| # | Surface | File:Line | Why 7.x stresses it |
|---|---------|-----------|---------------------|
| 1 | Pool option rename | [lib/mongodb.js:238](lib/mongodb.js#L238) | `poolSize` removed in 6.x; must accept `maxPoolSize` / `minPoolSize`. |
| 2 | `MongoClient` / `Db` init | [lib/mongodb.js:355](lib/mongodb.js#L355), [lib/mongodb.js:388](lib/mongodb.js#L388) | Stricter client lifecycle; some options moved or renamed. |
| 3 | `disconnect()` | [lib/mongodb.js:2033-2055](lib/mongodb.js#L2033-L2055) | Stricter `MongoClient.close()` semantics; in-flight operations behave differently. |
| 4 | Session merging | [lib/mongodb.js:2510](lib/mongodb.js#L2510) | Stricter session/transaction lifecycle; missing `endSession()` is now exhaustively tracked. |
| 5 | Transactions (currently `describe.skip`) | [test/transaction.test.js](test/transaction.test.js) | We have no green baseline on 4.x, so 7.x regressions cannot be diffed. |

None of these surfaces are tenant-specific in code — but all five are exactly the
places that *under* the multi-tenant N-`DataSource` load shape are most likely to
expose regressions that single-`DataSource` tests will miss.

## Test coverage map

Status today is **provisional**. The N-DataSource load shape is not currently
exercised by this repo's test suite, and the perkd juggler fork's 75 multi-tenant
tests live in `node_modules/loopback-datasource-juggler/test/*tenant*.test.js` but
are **not** pulled into our CI by [`deps/juggler-v5/test.js`](deps/juggler-v5/test.js).
The plan to close these gaps is `~/.claude/plans/do-you-have-effective-curried-papert.md`.

| Contract item | Covered by | Status |
|---|---|---|
| 1 — Isolation across N concurrent DataSources | `test/multitenant.test.js` (TODO — step 2) | **NOT YET COVERED** |
| 2 — Independent lifecycle (`disconnect()` does not affect siblings) | `test/multitenant.test.js` (TODO — step 2) | **NOT YET COVERED** |
| 3 — Concurrent lazy connect | `test/multitenant.test.js` (TODO — step 2) | **NOT YET COVERED** |
| 4 — Session scoping across DataSources | `test/multitenant.test.js` (TODO — step 2) + `test/transaction.test.js` (TODO — step 4: un-skip) | **NOT YET COVERED** |
| 5 — Pool option compatibility (`poolSize` and `maxPoolSize`) | `test/multitenant.test.js` (TODO — step 2) | **NOT YET COVERED** |
| Upstream juggler multi-tenant invariants | `deps/juggler-v5/test.js` requiring `tenant-aware-model-registry.test.js` and `multitenant-datasource-accessor.test.js` (TODO — step 1) | **NOT YET WIRED INTO CI** |
| Connection/session leaks under N-DataSource churn | `leak-detection/mongodb.test.js` extension (TODO — step 3) | **NOT YET COVERED** |

Once each step lands, the corresponding row should be updated with the file and case
that proves it.

## Out of scope

The following are explicitly **not** addressed by this document or by the
test-hardening plan that follows from it:

- Integration tests in the consumer application (`/CRM/person/` has no `test/`
  directory; coverage there is a separate effort).
- Changes to the perkd `loopback-datasource-juggler` fork — its own `MULTITENANT.md`
  is the source of truth for tenant-side mechanics.
- The `mongodb` driver `4.x → 7.x` upgrade itself. This document and the
  accompanying test plan exist so that upgrade can be done with a green baseline; the
  upgrade is a separate PR.
