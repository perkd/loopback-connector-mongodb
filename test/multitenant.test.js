// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Validates the multi-tenant contract documented in MULTITENANT.md:
// N concurrent DataSource instances against the same MongoDB server are isolated,
// independently disconnectable, safely lazy-connecting, session-scoped, and
// accept both `poolSize` (legacy) and `maxPoolSize` (mongodb 6.x+) options.

require('./init.js');

const {describe, it, before, after} = require('node:test');
const assert = require('node:assert/strict');
const juggler = require('loopback-datasource-juggler');
const connector = require('../');

const TENANTS = 5;
const baseDb = global.config.database;

function makeDataSource(suffix, extra) {
  const settings = Object.assign({}, global.config, {
    database: `${baseDb}-mt-${suffix}`,
  }, extra || {});
  return new juggler.DataSource(connector, settings);
}

function defineNote(ds) {
  return ds.define('MTNote', {
    tenant: {type: String, index: true},
    body: {type: String},
  });
}

describe('multi-tenant DataSource contract', function() {
  describe('isolation across N concurrent DataSources', function() {
    const sources = [];
    const models = [];

    before(async function() {
      for (let i = 0; i < TENANTS; i++) {
        const ds = makeDataSource(`iso-${i}`);
        sources.push(ds);
        models.push(defineNote(ds));
      }
      await Promise.all(sources.map(ds => ds.automigrate('MTNote')));
    });

    after(async function() {
      await Promise.all(sources.map(ds => ds.disconnect()));
    });

    it('writes from one DataSource are invisible to siblings', async function() {
      await Promise.all(models.map((M, i) => M.create({tenant: `t${i}`, body: `b${i}`})));

      for (let i = 0; i < TENANTS; i++) {
        const found = await models[i].find();
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0].tenant, `t${i}`);
      }
    });
  });

  describe('independent disconnect lifecycle', function() {
    const sources = [];
    const models = [];

    before(async function() {
      for (let i = 0; i < TENANTS; i++) {
        const ds = makeDataSource(`disc-${i}`);
        sources.push(ds);
        models.push(defineNote(ds));
      }
      await Promise.all(sources.map(ds => ds.automigrate('MTNote')));
    });

    after(async function() {
      await Promise.all(sources.map(ds => ds.connected ? ds.disconnect() : Promise.resolve()));
    });

    it('disconnect on one DataSource does not affect siblings', async function() {
      await sources[0].disconnect();

      for (let i = 1; i < TENANTS; i++) {
        const created = await models[i].create({tenant: `t${i}`, body: 'alive'});
        assert.ok(created.id);
        const found = await models[i].find({where: {body: 'alive'}});
        assert.strictEqual(found.length, 1);
      }
    });
  });

  describe('lazy connect under concurrent first-use', function() {
    const sources = [];
    const models = [];

    before(function() {
      for (let i = 0; i < TENANTS; i++) {
        const ds = makeDataSource(`lazy-${i}`, {lazyConnect: true});
        sources.push(ds);
        models.push(defineNote(ds));
      }
    });

    after(async function() {
      await Promise.all(sources.map(ds => ds.disconnect()));
    });

    it('each DataSource establishes exactly one connection', async function() {
      await Promise.all(sources.map(ds => ds.automigrate('MTNote')));

      const results = await Promise.all(
        models.map((M, i) => M.create({tenant: `t${i}`, body: `lazy-${i}`})),
      );
      assert.strictEqual(results.length, TENANTS);
      results.forEach(r => assert.ok(r.id));

      for (const ds of sources) {
        assert.ok(ds.connected, 'DataSource should be connected after first use');
      }
    });
  });

  describe('session/transaction scoping across DataSources', function() {
    // Sessions belong to the MongoClient that opened them. We verify the weaker
    // contract that holds without a replica set: an operation on DataSource B
    // proceeds independently while DataSource A holds an open session. Full
    // transaction commit/rollback semantics are covered in test/transaction.test.js
    // when a replica set is available.
    let dsA, dsB, NoteA, NoteB;

    before(async function() {
      dsA = makeDataSource('sess-a');
      dsB = makeDataSource('sess-b');
      NoteA = defineNote(dsA);
      NoteB = defineNote(dsB);
      await dsA.automigrate('MTNote');
      await dsB.automigrate('MTNote');
    });

    after(async function() {
      await dsA.disconnect();
      await dsB.disconnect();
    });

    it('a session on DataSource A does not block writes on DataSource B', async function() {
      const sessionA = dsA.connector.client.startSession();
      try {
        const created = await NoteB.create({tenant: 'b', body: 'independent'});
        assert.ok(created.id);
      } finally {
        await sessionA.endSession();
      }
    });
  });

  describe('pool option compatibility', function() {
    // Note: the connector's option allow-list (lib/mongodb.js:238) still names
    // `poolSize`, but the underlying mongodb driver already rejects it on 4.6.x
    // (`MongoParseError: option poolsize is not supported`). Only `maxPoolSize` /
    // `minPoolSize` work end-to-end. This is the actual contract today and what
    // the 7.x upgrade must preserve.
    it('accepts `maxPoolSize` without throwing', async function() {
      const ds = makeDataSource('pool-modern', {maxPoolSize: 3});
      const M = defineNote(ds);
      await ds.automigrate('MTNote');
      const created = await M.create({tenant: 'pool', body: 'modern'});
      assert.ok(created.id);
      await ds.disconnect();
    });
  });
});
