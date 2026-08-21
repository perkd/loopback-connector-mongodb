// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const juggler = require('loopback-datasource-juggler');
const path = require('node:path');
let DataSource = juggler.DataSource;

const TEST_ENV = process.env.TEST_ENV || 'test';
let config = require('rc')('loopback', {test: {mongodb: {}}})[TEST_ENV]
  .mongodb;

const baseDatabaseName =
  process.env.MONGODB_DATABASE ||
  'lb-ds-mongodb-test-' +
    (process.env.TRAVIS_BUILD_NUMBER || process.env.BUILD_NUMBER || '1');

const testFileName = process.argv[1] ?
  path.basename(process.argv[1], path.extname(process.argv[1]))
    .replace(/[^a-zA-Z0-9_-]+/g, '-') :
  'unknown';

config = {
  host: process.env.MONGODB_HOST || 'localhost',
  port: process.env.MONGODB_PORT || 27017,
  // Isolate node:test worker processes so suites cannot drop each other's collections.
  database: `${baseDatabaseName}-${testFileName}-${process.pid}`,
};

global.config = config;

let db;
global.getDataSource = global.getSchema = function(customConfig, customClass) {
  const ctor = customClass || DataSource;
  db = new ctor(require('../'), customConfig || config);
  db.log = function(a) {
    console.log(a);
  };

  return db;
};

global.resetDataSourceClass = function(ctor) {
  DataSource = ctor || juggler.DataSource;
  const promise = db ? db.disconnect() : Promise.resolve();
  db = undefined;
  return promise;
};

global.connectorCapabilities = {
  ilike: false,
  nilike: false,
  nestedProperty: true,
  atomicUpsertWithWhere: true,
  supportInq: true,
};
