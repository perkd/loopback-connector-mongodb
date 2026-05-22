// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const {describe, it, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const Transaction = require('loopback-connector/lib/transaction');

require('./init.js');

const juggler = require('loopback-datasource-juggler');

// Transactions require a MongoDB replica set on localhost:27000-27002.
// Start one with:  run-rs -v 4.2.0 --host localhost --portStart 27000
// Then opt in:     TEST_TRANSACTIONS=1 yarn test:unit
const ENABLED = process.env.TEST_TRANSACTIONS === '1';
const RS_URL = 'mongodb://localhost:27000,localhost:27001,localhost:27002/testdb?replicaSet=rs';

const suite = ENABLED ? describe : describe.skip;

let db, Post, Review;
suite('transactions', function() {
  before(() => new Promise((resolve, reject) => {
    db = global.getDataSource({
      url: RS_URL,
      retryWrites: false,
    });
    db.once('connected', function() {
      Post = db.define('PostTX', {
        title: {type: String, length: 255, index: true},
        content: {type: String},
      });
      Review = db.define('ReviewTX', {
        author: String,
        content: {type: String},
      });
      Post.hasMany(Review, {as: 'reviews', foreignKey: 'postId'});
      db.automigrate((err) => err ? reject(err) : resolve());
    });
  }));

  let currentTx;
  let hooks = [];
  // Return an async function to start a transaction and create a post
  function createPostInTx(post, timeout) {
    return () => new Promise((resolve, reject) => {
      Post.beginTransaction({
        isolationLevel: Transaction.READ_COMMITTED,
        timeout: timeout,
      },
      function(err, tx) {
        if (err) return reject(err);
        try {
          assert.ok('id' in tx);
          assert.strictEqual(typeof tx.id, 'string');
        } catch (e) { return reject(e); }
        hooks = [];
        tx.observe('before commit', function(context, next) {
          hooks.push('before commit');
          next();
        });
        tx.observe('after commit', function(context, next) {
          hooks.push('after commit');
          next();
        });
        tx.observe('before rollback', function(context, next) {
          hooks.push('before rollback');
          next();
        });
        tx.observe('after rollback', function(context, next) {
          hooks.push('after rollback');
          next();
        });
        currentTx = tx;
        Post.create(post, {transaction: tx, model: 'Post'},
          function(err, p) {
            if (err) {
              reject(err);
            } else {
              p.reviews.create({
                author: 'John',
                content: 'Review for ' + p.title,
              }, {transaction: tx, model: 'Review'},
              function(err, c) {
                if (err) reject(err); else resolve();
              });
            }
          });
      });
    });
  }

  // Return an async function to find matching posts and assert number of
  // records to equal to the count
  function expectToFindPosts(where, count, inTx) {
    return () => new Promise((resolve, reject) => {
      const options = {model: 'Post'};
      if (inTx) {
        options.transaction = currentTx;
      }
      Post.find({where: where}, options,
        function(err, posts) {
          if (err) return reject(err);
          try {
            assert.strictEqual(posts.length, count);
          } catch (e) { return reject(e); }
          // Make sure both find() and count() behave the same way
          Post.count(where, options,
            function(err, result) {
              if (err) return reject(err);
              try {
                assert.strictEqual(result, count);
              } catch (e) { return reject(e); }
              if (count) {
                // Find related reviews
                options.model = 'Review';
                posts[0].reviews({}, options, function(err, reviews) {
                  if (err) return reject(err);
                  try {
                    assert.strictEqual(reviews.length, count);
                    resolve();
                  } catch (e) { reject(e); }
                });
              } else {
                resolve();
              }
            });
        });
    });
  }

  describe('commit', function() {
    const post = {title: 't1', content: 'c1'};
    before(createPostInTx(post));

    it('should not see the uncommitted insert', expectToFindPosts(post, 0));

    it('should see the uncommitted insert from the same transaction',
      expectToFindPosts(post, 1, true));

    it('should commit a transaction', () => new Promise((resolve, reject) => {
      currentTx.commit(function(err) {
        try {
          assert.deepStrictEqual(hooks, ['before commit', 'after commit']);
          if (err) reject(err); else resolve();
        } catch (e) { reject(e); }
      });
    }));

    it('should see the committed insert', expectToFindPosts(post, 1));

    it('should report error if the transaction is not active', () => new Promise((resolve, reject) => {
      currentTx.commit(function(err) {
        try {
          assert.ok(err instanceof Error);
          resolve();
        } catch (e) { reject(e); }
      });
    }));
  });

  describe('rollback', function() {
    before(function() {
      // Reset the collection
      db.connector.data = {};
    });

    const post = {title: 't2', content: 'c2'};
    before(createPostInTx(post));

    it('should not see the uncommitted insert', expectToFindPosts(post, 0));

    it('should see the uncommitted insert from the same transaction',
      expectToFindPosts(post, 1, true));

    it('should rollback a transaction', () => new Promise((resolve, reject) => {
      currentTx.rollback(function(err) {
        try {
          assert.deepStrictEqual(hooks, ['before rollback', 'after rollback']);
          if (err) reject(err); else resolve();
        } catch (e) { reject(e); }
      });
    }));

    it('should not see the rolledback insert', expectToFindPosts(post, 0));

    it('should report error if the transaction is not active', () => new Promise((resolve, reject) => {
      currentTx.rollback(function(err) {
        try {
          assert.ok(err instanceof Error);
          resolve();
        } catch (e) { reject(e); }
      });
    }));
  });

  describe('timeout', function() {
    const TIMEOUT = 50;
    before(function() {
      // Reset the collection
      db.connector.data = {};
    });

    const post = {title: 't3', content: 'c3'};
    beforeEach(createPostInTx(post, TIMEOUT));

    it('should report timeout', () => new Promise((resolve, reject) => {
      // wait until the "create post" transaction times out
      setTimeout(runTheTest, TIMEOUT * 3);

      function runTheTest() {
        Post.find({where: {title: 't3'}}, {transaction: currentTx},
          function(err, posts) {
            try {
              assert.match(String(err), /transaction.*not active/);
              resolve();
            } catch (e) { reject(e); }
          });
      }
    }));

    it('should invoke the timeout hook', {timeout: TIMEOUT * 3}, () => new Promise((resolve) => {
      currentTx.observe('timeout', function(context, next) {
        next();
        resolve();
      });
    }));
  });

  describe('isActive', function() {
    it('returns true when connection is active', () => new Promise((resolve, reject) => {
      Post.beginTransaction({
        isolationLevel: Transaction.READ_COMMITTED,
        timeout: 1000,
      },
      function(err, tx) {
        if (err) return reject(err);
        try {
          assert.strictEqual(tx.isActive(), true);
          resolve();
        } catch (e) { reject(e); }
      });
    }));
    it('returns false when connection is not active', () => new Promise((resolve, reject) => {
      Post.beginTransaction({
        isolationLevel: Transaction.READ_COMMITTED,
        timeout: 1000,
      },
      function(err, tx) {
        if (err) return reject(err);
        try {
          delete tx.connection;
          assert.strictEqual(tx.isActive(), false);
          resolve();
        } catch (e) { reject(e); }
      });
    }));
  });
});
