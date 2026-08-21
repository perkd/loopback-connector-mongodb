// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// End-to-end multitenant dispatch test against real MongoDB.
//
// Closes the coverage corner: real Mongo + real @perkd/multitenant-context
// + real DAO + real dispatch, in one test.
//
// Other faces of the contract:
//   - N-DataSource isolation (no dispatch chain) — test/multitenant.test.js
//   - Dispatch contract (no real Mongo) — loopback/test/multitenant-dispatch.test.js
//   - Accessor + DAO + ReconnectingProxy (no real Mongo) —
//     loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js

require('./init.js');

const {describe, it, before, after} = require('node:test');
const assert = require('node:assert/strict');
const juggler = require('loopback-datasource-juggler');
const connector = require('../');
const {Context} = require('@perkd/multitenant-context');
const {FakeConnectionManager} = require('./fixtures/fake-connection-manager');
const applyDispatchMixin = require('./fixtures/dispatch-mixin');

// Mongo database names are limited to 63 bytes on most platforms; init.js
// already builds long names. Use a short, fixed prefix per test process and
// per-tenant single-char suffix to stay under the limit.
const TENANT_DB_PREFIX = `mtdisp-${process.pid}`;

function tenantDbName(tenant) {
  return `${TENANT_DB_PREFIX}-${tenant}`;
}

function makeTenantDataSource(tenant) {
  const settings = Object.assign({}, global.config, {
    database: tenantDbName(tenant),
    name: tenant,
    tenant,
  });
  return new juggler.DataSource(connector, settings);
}

describe('multi-tenant dispatch end-to-end (real Mongo)', function() {
  let app, originalDataSource, TenantItem, pools;

  before(async function() {
    pools = new Map();

    // The "trap" / original DataSource — production routes here when no
    // tenant context is set. Tests below also assert that fallback.
    originalDataSource = new juggler.DataSource(connector, Object.assign({}, global.config, {
      database: `${TENANT_DB_PREFIX}-trap`,
      name: 'trap',
    }));

    TenantItem = originalDataSource.define('DispatchItem', {
      tenant: {type: String, index: true},
      body: {type: String},
    });
    await originalDataSource.automigrate('DispatchItem');

    // Minimal app surface: the mixin reads Model.app.connectionManager.
    // The connection factory attaches the model to each tenant pool —
    // production does this via app.tenantModels tracking.
    app = {
      connectionManager: new FakeConnectionManager({
        connectionFactory: async tenant => {
          const pool = makeTenantDataSource(tenant);
          pools.set(tenant, pool);
          // Force-connect so getDataSource() returns a ready pool, mirroring
          // production's eager warmup via the multitenant-ds middleware.
          await new Promise((resolve, reject) => {
            pool.connect(err => err ? reject(err) : resolve());
          });
          // Attach the model to this tenant pool so DAO ops can dispatch
          // against it. The DAO reads Model.getDataSource() per op; the pool
          // just needs the connector wired up for that op to execute.
          pool.attach(TenantItem);
          await pool.automigrate('DispatchItem');
          return pool;
        },
      }),
    };
    TenantItem.app = app;
    applyDispatchMixin(TenantItem, {Context, originalDataSource});
  });

  after(async function() {
    // Drop per-tenant databases before disconnect so the Mongo server does
    // not retain test artifacts between runs.
    for (const pool of pools.values()) {
      if (pool.connector && pool.connector.db) await pool.connector.db.dropDatabase();
    }
    if (originalDataSource && originalDataSource.connector && originalDataSource.connector.db) {
      await originalDataSource.connector.db.dropDatabase();
    }
    if (app && app.connectionManager) await app.connectionManager.shutdown();
    if (originalDataSource) await originalDataSource.disconnect();
  });

  it('concurrent two-tenant writes land in distinct Mongo databases', async function() {
    // Pre-warm pools so getDataSource() resolves synchronously inside the
    // tenant context, matching the production multitenant-ds middleware.
    // The factory handles attach + automigrate per pool.
    await app.connectionManager.ensureConnection('tenant-a');
    await app.connectionManager.ensureConnection('tenant-b');

    await Promise.all([
      Context.runAsTenant('tenant-a', () => TenantItem.create({tenant: 'a', body: 'from-a'})),
      Context.runAsTenant('tenant-b', () => TenantItem.create({tenant: 'b', body: 'from-b'})),
    ]);

    // Read each tenant's database directly via its own connector.
    const collA = pools.get('tenant-a').connector.collection('DispatchItem');
    const collB = pools.get('tenant-b').connector.collection('DispatchItem');

    const docsA = await collA.find({}).toArray();
    const docsB = await collB.find({}).toArray();

    assert.equal(docsA.length, 1, 'tenant-a database must hold exactly one doc');
    assert.equal(docsB.length, 1, 'tenant-b database must hold exactly one doc');
    assert.equal(docsA[0].body, 'from-a', 'tenant-a doc must be the one written under tenant-a context');
    assert.equal(docsB[0].body, 'from-b', 'tenant-b doc must be the one written under tenant-b context');

    // The "trap" database must remain empty — no write leaked there.
    const trapColl = originalDataSource.connector.collection('DispatchItem');
    const trapDocs = await trapColl.find({}).toArray();
    assert.equal(trapDocs.length, 0, 'no write should land in the trap database');
  });

  it('dispatch reads Context.tenant on every DAO call', async function() {
    await app.connectionManager.ensureConnection('tenant-a');
    await app.connectionManager.ensureConnection('tenant-b');

    // Three sequential reads under alternating contexts.
    const dsA1 = await Context.runAsTenant('tenant-a', () => TenantItem.getDataSource());
    const dsB  = await Context.runAsTenant('tenant-b', () => TenantItem.getDataSource());
    const dsA2 = await Context.runAsTenant('tenant-a', () => TenantItem.getDataSource());

    assert.equal(dsA1, pools.get('tenant-a'));
    assert.equal(dsB, pools.get('tenant-b'));
    assert.equal(dsA2, pools.get('tenant-a'));
    assert.notEqual(dsA1, dsB, 'distinct tenants must resolve to distinct DataSources');
  });

  it('falls back to the original (trap) datasource when no tenant context is set', function() {
    const ds = TenantItem.getDataSource();
    assert.equal(ds, originalDataSource, 'no tenant → original DataSource');
  });
});
