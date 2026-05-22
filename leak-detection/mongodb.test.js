// Copyright IBM Corp. 2015,2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('node:assert/strict');
const {createDetector} = require('./heap-leak');
const Todo = require('./fixtures/todo');
const DataSource = require('loopback-datasource-juggler').DataSource;
const connector = require('..');

describe('mongodb', function() {
  let detector;
  before(function() {
    detector = createDetector();
  });

  after(function(done) {
    Todo.destroyAll(done);
  });

  function resetTestState(ctx, cb) {
    detector.start();
    ctx.iterations = 0;
    Todo.destroyAll(cb);
  }

  function execute(ctx, func, options, done) {
    let hasOptions = true;
    if (typeof options === 'function') {
      done = options;
      hasOptions = false;
    }
    const interval = setInterval(function() {
      if (ctx.iterations >= global.ITERATIONS || detector.leaked()) {
        clearInterval(interval);
        assert.ok(!detector.leaked(), 'sustained heap growth detected');
        return done();
      }
      ctx.iterations++;
      // eslint-disable-next-line
      hasOptions ? Todo[func](options) : Todo[func];
      detector.sample();
    }, 0);
  }

  context('find', function() {
    beforeEach(function(done) {
      resetTestState(this, done);
    });

    beforeEach(function createFixtures(done) {
      Todo.create(
        [
          {content: 'Buy eggs'},
          {content: 'Buy milk'},
          {content: 'Buy cheese'},
        ],
        done,
      );
    });

    it('should not leak when retrieving a specific item', function(done) {
      execute(this, 'find', {where: {content: 'Buy eggs'}}, done);
    });

    it('should not leak when retrieving all items', function(done) {
      execute(this, 'find', done);
    });
  });

  context('create', function() {
    beforeEach(function(done) {
      resetTestState(this, done);
    });

    it('should not leak when creating an item', function(done) {
      execute(this, 'create', {content: 'Buy eggs'}, done);
    });

    it('should not leak when creating multiple items', function(done) {
      execute(
        this,
        'create',
        [
          {content: 'Buy eggs'},
          {content: 'Buy milk'},
          {content: 'Buy cheese'},
        ],
        done,
      );
    });
  });

  context('multi-tenant DataSource churn', function() {
    beforeEach(function(done) {
      detector.start();
      this.iterations = 0;
      done();
    });

    it('should not leak when DataSources are created and disconnected in a loop', function(done) {
      const self = this;
      const baseDb = process.env.LB_DB || 'strongloop';
      (function next() {
        if (self.iterations >= global.ITERATIONS || detector.leaked()) {
          assert.ok(!detector.leaked(), 'sustained heap growth across DataSource churn');
          return done();
        }
        self.iterations++;
        const ds = new DataSource(connector, {
          host: process.env.LB_HOST || '127.0.0.1',
          port: process.env.LB_PORT || 27017,
          database: `${baseDb}-mt-${self.iterations}`,
        });
        const Note = ds.define('LeakNote', {content: {type: String}});
        Note.create({content: 'churn'}, function(err) {
          if (err) return done(err);
          ds.disconnect(function(err) {
            if (err) return done(err);
            detector.sample();
            setImmediate(next);
          });
        });
      })();
    });
  });
});
