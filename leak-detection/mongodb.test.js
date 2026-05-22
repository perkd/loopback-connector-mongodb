// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const memwatch = require('memwatch-next');
const Todo = require('./fixtures/todo');

describe('mongodb', function() {
  let leakCount = 0;
  before(function() {
    memwatch.on('leak', () => { leakCount++; });
  });

  after(function(done) {
    Todo.destroyAll(done);
  });

  function resetTestState(ctx, cb) {
    leakCount = 0;
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
      if (ctx.iterations >= global.ITERATIONS || leakCount > 0) {
        (leakCount === 0).should.be.True();
        clearInterval(interval);
        return done();
      }
      ctx.iterations++;
      // eslint-disable-next-line
      hasOptions ? Todo[func](options) : Todo[func];
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
});
