# Remove `ModelRegistry` Multitenant Routing — Analysis & Workplan

## Executive Summary

The juggler currently contains **two different multitenancy-looking mechanisms**:

1. **The production CRM dispatch path**: request context -> `Model.getDataSource()` override -> `ConnectionManager` -> tenant `DataSource`
2. **The juggler-internal `ModelRegistry` tenant path**: `getCurrentTenant()` -> `getEffectiveTenant()` -> tenant-scoped model registry

For CRM, only the first path is on the hot path. The second path is not part of request-time tenant routing and appears to exist for model-fingerprint reuse, anonymous-model isolation, and cleanup behavior inside the juggler.

Strategically, this is a problem even if the second path is harmless. It creates a false mental model, increases maintenance surface, and makes it harder to explain or verify how tenant routing actually works. Unless a real supported consumer of `ModelRegistry`-driven tenant routing can be named, the bias should be to **remove the routing aspects of that path** and keep only the owner-identity / registry-management behavior that is actually needed.

This document does **not** recommend deleting `ModelRegistry` entirely. It recommends deciding whether to remove the **context-driven tenant-routing behavior** inside `model-registry.js`.

---

## What Exists Today

### Production CRM path

In CRM services, multitenancy is implemented by overriding `Model.getDataSource()` in the `Multitenant` mixin. Juggler DAO methods resolve through `getDataSource()` per operation:

```js
HTTP request
  -> middleware sets Context.tenant
  -> Multitenant mixin overrides Model.getDataSource()
  -> DAO method calls Model.getDataSource()
  -> ConnectionManager returns the tenant pool DataSource
```

This is the path CRM depends on.

### Juggler-internal registry path

`loopback-datasource-juggler/lib/model-registry.js` also contains context-driven logic:

- `getCurrentTenant()` attempts to read tenant identity from `@perkd/multitenant-context`
- falls back to `global.loopbackContext`
- returns `null` if neither is available
- `registerModel()` calls `getCurrentTenant()`
- `getEffectiveTenant()` mixes owner identity (`model.dataSource`, `model.app`) with current-context fallback for models without owners

Relevant code:

```js
function getCurrentTenant() {
  try {
    const Context = require('@perkd/multitenant-context').Context;
    return Context.tenant;
  } catch (e) {
    try {
      if (global.loopbackContext && typeof global.loopbackContext.getCurrentContext === 'function') {
        const ctx = global.loopbackContext.getCurrentContext();
        if (ctx && ctx.get && typeof ctx.get === 'function') {
          const tenant = ctx.get('tenant');
          if (tenant) return tenant;
        }
      }
    } catch (innerErr) {
      debug('Alternative context mechanism not available', innerErr);
    }
    return null;
  }
}
```

```js
function getEffectiveTenant(model, currentTenant) {
  if (model && model.dataSource) {
    const dsId = model.dataSource._dsId ||
      (model.dataSource._dsId = generateDataSourceId(model.dataSource));
    return `ds_${dsId}`;
  }

  if (model && model.app) {
    const appId = model.app._appId || (model.app._appId = generateAppId(model.app));
    return `app_${appId}`;
  }

  if (currentTenant) {
    return currentTenant;
  }

  return 'global';
}
```

The key observation is that this registry path is **not the CRM dispatch path**. It is separate infrastructure inside the juggler.

---

## Why This Is Strategically Bad

### 1. It creates a false story about how multitenancy works

When two different mechanisms both look like "tenant routing," engineers naturally conflate them. That has already happened in analysis and review: it is easy to assume `ModelRegistry` participates in request-time DataSource selection when CRM actually routes via `Model.getDataSource()`.

That confusion costs:

- slower code reviews
- slower incident response
- worse onboarding
- incorrect tests targeting the wrong seam

### 2. It increases maintenance surface without helping the real path

Unused routing logic is not free. It needs:

- tests
- compatibility decisions
- dependency decisions
- documentation
- reasoning during refactors

If the only known production consumer does not use it, then this is maintenance spent on a path with no demonstrated product value.

### 3. It weakens architectural clarity in a security-sensitive area

Multitenant routing is a security boundary. Those areas should be boring, explicit, and easy to explain. Extra hidden routing mechanisms make the system feel more capable than it is and can lead to dangerous assumptions like:

- "the juggler handles tenant routing for us"
- "adding `@perkd/multitenant-context` to juggler is necessary for CRM"
- "registry tests prove end-to-end tenant isolation"

All three are misleading in the CRM architecture.

### 4. It preserves legacy fallback behavior with unclear ownership

`getCurrentTenant()` currently supports:

- `@perkd/multitenant-context`
- `global.loopbackContext`
- null/global fallback

That is a compatibility matrix. If nobody owns it as a supported feature, it should not remain as silent background behavior.

---

## Why Removal Is Not Automatic

There are still plausible reasons not to remove it immediately.

### 1. It may have a real non-CRM consumer

`ModelRegistry` could be used by:

- another internal service not yet examined
- a historical LB3 integration using `ModelBuilder` directly
- tests or tooling that rely on context-driven anonymous-model separation

If such a consumer exists and is supported, removal becomes a product change, not just cleanup.

### 2. Parts of the code may still be useful without the routing behavior

The following are independently valuable:

- model fingerprint reuse
- anonymous-model leak prevention
- owner-identity isolation by `DataSource` / `app`
- cleanup and ref-counting

Those should not be thrown away just because the context-driven part is unused.

### 3. Removing it changes behavior for owner-less models

Today, models without `dataSource` or `app` can still be partitioned by `currentTenant`:

```js
if (currentTenant) {
  return currentTenant;
}
```

If that branch is removed, those models collapse into the global bucket unless another ownership mechanism replaces it. That may be fine, but it is a behavior change and should be treated as one.

---

## Recommendation

**Yes: put removal in the plan, but as a decision-backed simplification step.**

The default stance should be:

> If no supported consumer of `ModelRegistry`-driven tenant routing can be identified, remove the context-driven routing behavior from `model-registry.js` and keep only owner-based registry behavior.

That is the strategically cleanest outcome.

---

## Decision Criteria

Proceed with removal if all of the following are true:

1. No production service can be shown to rely on `getCurrentTenant()` for DataSource routing.
2. No supported non-CRM consumer can be shown to rely on owner-less model partitioning by tenant context.
3. The remaining `ModelRegistry` responsibilities still make sense when reduced to owner-based bookkeeping and cleanup.
4. Tests are added for the actual supported CRM dispatch path so this cleanup does not reduce confidence.

Do **not** remove yet if any of the following are true:

1. A supported consumer exists and depends on `currentTenant -> registry` behavior.
2. Existing tests reveal owner-less models that must remain tenant-separated.
3. The code is too entangled to simplify safely in the same change window as other multitenancy fixes.

---

## Proposed Workplan

### Phase 1 — Confirm there is no supported consumer

Goal: turn "probably unused" into "known unused" or "known supported."

Tasks:

1. Search internal repos for actual behavioral dependency on:
   - `getCurrentTenant()`
   - `global.loopbackContext`
   - owner-less models being partitioned by tenant context
2. Search for docs or tests that describe `ModelRegistry` as tenant routing.
3. Ask service owners directly whether any service depends on juggler-driven tenant registry behavior.
4. Record results in a short decision note: `keep` or `remove`.

Deliverable:

- a one-page decision record naming real consumers, or explicitly stating none were found

### Phase 2 — Freeze the supported architecture in docs

Goal: remove ambiguity before code changes.

Tasks:

1. Document the supported CRM multitenant path as:
   - `Context`
   - `Model.getDataSource()`
   - `ConnectionManager`
   - tenant `DataSource`
2. Explicitly state that `ModelRegistry` is not part of CRM request-time routing.
3. Mark context-driven `ModelRegistry` behavior as legacy / pending removal if Phase 1 finds no consumer.

Deliverable:

- updated architecture docs that eliminate the "two routing stories" problem

### Phase 3 — Strengthen tests for the real path first

Goal: reduce risk before deleting anything.

Tasks:

1. Add a juggler test pinning DAO-level repeated `getDataSource()` resolution.
2. Add a juggler contract test for `stillConnecting()` with a non-`DataSource` object implementing `ready(obj, args)`.
3. Add one small canonical CRM end-to-end dispatch test using the real `Multitenant` mixin and real pool resolution.

Why first:

- removal is safer when the actual supported contract is well pinned
- reviewers can see that the cleanup is not reducing real coverage

Deliverable:

- test coverage around the supported architecture, not the legacy-looking one

### Phase 4 — Remove context-driven routing from `ModelRegistry`

Goal: simplify `model-registry.js` to owner-based behavior only.

Proposed code changes:

1. Remove `getCurrentTenant()`.
2. Remove `global.loopbackContext` fallback logic.
3. Simplify `getEffectiveTenant()`:
   - keep `model.dataSource -> ds_<id>`
   - keep `model.app -> app_<id>`
   - replace owner-less models with a single explicit fallback bucket, likely `global`
4. Update comments and docs to stop describing this as tenant routing.

Likely resulting shape:

```js
function getEffectiveTenant(model) {
  if (model && model.dataSource) return `ds_${...}`;
  if (model && model.app) return `app_${...}`;
  return 'global';
}
```

Deliverable:

- a simplified `ModelRegistry` that no longer implies request-time context routing

### Phase 5 — Cleanup and deprecation follow-through

Goal: make the simplification stick.

Tasks:

1. Remove obsolete tests for legacy fallback paths if the feature is intentionally removed.
2. Add a changelog note if downstream users could observe changed behavior.
3. Remove stale comments, docs, or proposals that mention registry-driven tenant routing as a supported path.
4. Add a short architecture note explaining why the removal happened.

Deliverable:

- one coherent story across code, tests, and docs

---

## Risks

### Risk 1 — Hidden consumer exists

Impact:

- behavior regression in a non-CRM service or obscure integration

Mitigation:

- do not skip Phase 1
- land removal only after explicit consumer check
- make removal a dedicated PR, not part of a broad refactor

### Risk 2 — Owner-less model behavior changes unexpectedly

Impact:

- anonymous/dynamic models that were previously tenant-separated may now share a global bucket

Mitigation:

- search for `ModelBuilder` / anonymous model patterns
- add focused tests around owner-less model behavior before and after change

### Risk 3 — Reviewers assume this is a no-op cleanup

Impact:

- under-reviewed behavior change

Mitigation:

- frame the PR as a behavior simplification with explicit before/after semantics
- include a decision record in the PR description

---

## Rollback Strategy

If removal causes unexpected behavior:

1. Revert the focused removal PR.
2. Restore the previous `getCurrentTenant()` path.
3. Keep the new documentation clarifying that CRM does not use it.
4. Re-open the decision as "supported but under-documented" rather than "dead code."

This is another reason the removal should be isolated from unrelated multitenancy changes.

---

## Proposed PR Strategy

Do **not** combine everything into one PR.

Recommended order:

1. **PR 1:** add tests for the real supported path
2. **PR 2:** document supported architecture and mark `ModelRegistry` routing as pending decision
3. **PR 3:** remove context-driven `ModelRegistry` routing if no consumer is found

This sequence makes review easier and reduces the chance of accidental regressions.

---

## Bottom Line

`ModelRegistry`-driven context routing should not stay in the system just because it already exists. If CRM does not use it, and no other supported consumer can be named, then leaving it in place is strategically worse than removing it:

- it confuses the architecture
- it adds maintenance
- it muddies a security-sensitive boundary

The right plan is:

1. confirm whether any real consumer exists,
2. pin tests for the actual supported path,
3. remove the unused routing behavior if no consumer is found.

That gives the system one clear multitenant story instead of two competing ones.
