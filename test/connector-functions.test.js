// Copyright IBM Corp. 2018,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const {describe, it, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');

require('./init.js');

describe('connector function - findById', function() {
  let db, TestAlias, sampleId;
  before(() => new Promise((resolve, reject) => {
    db = global.getDataSource();
    TestAlias = db.define('TestAlias', {foo: {type: String}});
    db.automigrate(function(err) {
      if (err) return reject(err);
      TestAlias.create({foo: 'foo'}, function(err, t) {
        if (err) return reject(err);
        sampleId = t.id;
        resolve();
      });
    });
  }));

  it('find is aliased as findById', () => new Promise((resolve, reject) => {
    db.connector.findById('TestAlias', sampleId, {}, function(err, r) {
      if (err) return reject(err);
      try {
        assert.strictEqual(r.foo, 'foo');
        resolve();
      } catch (e) { reject(e); }
    });
  }));
});

describe('find (implicitNullType)', function() {
  let db, TestAlias, sampleId;
  let implicitNullType = false;
  beforeEach(() => new Promise((resolve, reject) => {
    db = global.getDataSource({
      host: '127.0.0.1',
      port: global.config.port,
      implicitNullType,
    });
    implicitNullType = !implicitNullType;
    TestAlias = db.define('TestAlias', {foo: {type: String}});
    db.automigrate(function(err) {
      if (err) return reject(err);
      TestAlias.create({foo: 'foo'}, function(err, t) {
        if (err) return reject(err);
        sampleId = t.id;
        resolve();
      });
    });
  }));

  it('find none by id: sampleId, deletedAt: null (implicitNullType=false)', () => new Promise((resolve, reject) => {
    db.connector.all('TestAlias', {where: {id: sampleId, deletedAt: null}}, {}, function(err, r) {
      if (err) return reject(err);
      if (r.length) {
        return reject(new Error('all should not have found the TestAlias document'));
      }
      resolve();
    });
  }));

  it('find all by id: sampleId, deletedAt: null (implicitNullType=true)', () => new Promise((resolve, reject) => {
    db.connector.all('TestAlias', {where: {id: sampleId, deletedAt: null}}, {}, function(err, r) {
      if (err) return reject(err);
      try {
        assert.strictEqual(r[0].foo, 'foo');
        resolve();
      } catch (e) { reject(e); }
    });
  }));
});
