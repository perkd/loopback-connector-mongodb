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
[lib/mongodb.js:327](lib/mongodb.js#L327), which selects a database **once** at
connect time and binds it to the connector instance for its full lifetime.

## What this connector does NOT do

The following are deliberate non-features. Consumers (or the upstream juggler fork)
provide them:

- **No tenant abstraction.** No `tenant`, `multitenant`, `useDb`, or `selectDb` APIs
  anywhere in `lib/`.
- **No per-call database switching.** The `Db` handle is acquired once at
  [lib/mongodb.js:327](lib/mongodb.js#L327) and reused for every operation on that
  `DataSource`. The connector never calls `client.db(otherName)` mid-lifetime.
- **No tenant-keyed connection cache.** Each `DataSource` owns exactly one
  `MongoClient` ([lib/mongodb.js:317](lib/mongodb.js#L317)) and one `Db`. There is
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
   ([lib/mongodb.js:1915](lib/mongodb.js#L1915)) on one `DataSource` has
   no observable effect on any other `DataSource`, even when they share an
   underlying MongoDB server.
3. **Concurrent lazy connect.** With `lazyConnect: true`, N concurrent first-use
   queries across N `DataSource` instances each establish exactly one connection.
   No `DataSource` connects twice; no query is dropped.
4. **Session scoping.** Transactions and sessions are scoped to the `MongoClient`
   that opened them. Session merging in `buildOptions()`
   ([lib/mongodb.js:2389](lib/mongodb.js#L2389)) never leaks a session from
   DataSource A into an operation on DataSource B.
5. **Pool sizing via `maxPoolSize` works end-to-end.** Consumers can set
   `maxPoolSize` / `minPoolSize` and have them honored by the underlying driver.
   The stale `poolSize` entry has been removed from the connector's option
   allow-list ([lib/mongodb.js:235](lib/mongodb.js#L235)) as part of the v7.0.0
   driver upgrade.

## Driver-version upgrade record (v4.6.x → v7.x, completed in v7.0.0)

The following surfaces were identified pre-upgrade and addressed in the v7.0.0 cutover:

| # | Surface | File:Line | Resolution |
|---|---------|-----------|------------|
| 1 | Pool option rename | [lib/mongodb.js:235](lib/mongodb.js#L235) | `poolSize` removed from allow-list; `maxPoolSize`/`minPoolSize` retained. |
| 2 | `MongoClient` / `Db` init | [lib/mongodb.js:317](lib/mongodb.js#L317), [lib/mongodb.js:327](lib/mongodb.js#L327) | Promise-based `connect()`; `client.db()` inherits all options via `Object.assign`; `retryWrites` and peer options added to allow-list. |
| 3 | `disconnect()` | [lib/mongodb.js:1915](lib/mongodb.js#L1915) | `client.close()` now awaited before nulling `db`/`client`; callback invoked after close settles. |
| 4 | Session lifecycle | [lib/mongodb.js:2162](lib/mongodb.js#L2162) | `commit()`/`rollback()` always call `endSession()` even on transaction failure; `endSession()` now takes no arguments (v7 API). |
| 5 | Transactions baseline | [test/transaction.test.js](test/transaction.test.js) | Suite un-skipped behind `TEST_TRANSACTIONS=1`; green baseline established on v4.x before upgrade. |

All five surfaces are resolved. The connector is on `mongodb ^7.2.0`.

## Test coverage map

| Contract item | Covered by | Status |
|---|---|---|
| 1 — Isolation across N concurrent DataSources | [test/multitenant.test.js](test/multitenant.test.js) — `isolation across N concurrent DataSources` | ✅ Covered |
| 2 — Independent lifecycle (`disconnect()` does not affect siblings) | [test/multitenant.test.js](test/multitenant.test.js) — `independent disconnect lifecycle` | ✅ Covered |
| 3 — Concurrent lazy connect | [test/multitenant.test.js](test/multitenant.test.js) — `lazy connect under concurrent first-use` | ✅ Covered |
| 4 — Session scoping across DataSources | [test/multitenant.test.js](test/multitenant.test.js) — `session/transaction scoping across DataSources` + [test/transaction.test.js](test/transaction.test.js) (opt-in via `TEST_TRANSACTIONS=1`, requires a local replica set) | ✅ Covered (full transaction semantics gated on replica-set infra) |
| 5 — `maxPoolSize` flows through to the driver | [test/multitenant.test.js](test/multitenant.test.js) — `pool option compatibility`; [test/mongodb.test.js](test/mongodb.test.js) — `should forward connector settings to MongoClient` | ✅ Covered; stale `poolSize` allow-list entry removed in v7.0.0 |
| Upstream juggler multi-tenant invariants | [deps/juggler-v5/test.js](deps/juggler-v5/test.js) requires `tenant-aware-model-registry.test.js` + `multitenant-datasource-accessor.test.js` | ✅ Wired into `yarn test:juggler:v5` |
| Connection/session leaks under N-DataSource churn | [leak-detection/mongodb.test.js](leak-detection/mongodb.test.js) — `multi-tenant DataSource churn` context | ✅ Covered (run via `make leak-detection`) |
| `commit`/`rollback` session cleanup on error path | [test/mongodb.test.js](test/mongodb.test.js) — `commit and rollback session cleanup` describe block | ✅ Covered (no replica set required; injects failure on session object) |

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
