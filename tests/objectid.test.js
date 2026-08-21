// Copyright IBM Corp. 2013,2020. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

require('./init.js');

const {describe, it, before, beforeEach, after, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {promisify} = require('node:util');

let Book, Chapter;
const ds = global.getDataSource();
const objectIDLikeString = '7cd2ad46ffc580ba45d3cb1f';
const objectIDLikeString2 = '7cd2ad46ffc580ba45d3cb1e';

describe('ObjectID', function() {
  before(function() {
    Book = ds.define('Book');
    Chapter = ds.define('Chapter');
    Book.hasMany('chapters');
    Chapter.belongsTo('book');
  });

  it('should cast foreign keys as ObjectID', () => new Promise((resolve, reject) => {
    Chapter.beforeCreate = function(next, data) {
      try {
        assert.ok(data.bookId instanceof ds.ObjectID);
        assert.ok(this.bookId instanceof ds.ObjectID);
        next();
      } catch (e) { next(e); }
    };

    Book.create(function(err, book) {
      if (err) return reject(err);
      Chapter.create({bookId: book.id.toString()}, (err) => err ? reject(err) : resolve());
    });
  }));

  it('should convert 24 byte hex string as ObjectID', function() {
    const ObjectID = ds.connector.getDefaultIdType();
    const str = objectIDLikeString;
    assert.ok(ObjectID(str) instanceof ds.ObjectID);
  });

  it('should not convert 12 byte string as ObjectID', function() {
    const ObjectID = ds.connector.getDefaultIdType();
    const str = 'line-by-line';
    assert.strictEqual(ObjectID(str), str);
  });

  it('should keep mongodb ObjectID as is', function() {
    const ObjectID = ds.connector.getDefaultIdType();
    const id = new ds.ObjectID();
    assert.ok(ObjectID(id) instanceof ds.ObjectID);
  });

  it('should keep non-string id as it', function() {
    const ObjectID = ds.connector.getDefaultIdType();
    const id = 123;
    assert.strictEqual(ObjectID(id), 123);
  });

  describe('strictObjectIDCoercion', function() {
    describe('when set to false (default)', function() {
      const Article = ds.createModel(
        'ArticleA',
        {
          xid: String,
          title: String,
        },
      );

      beforeEach(() => new Promise((resolve, reject) => {
        Article.deleteAll((err) => err ? reject(err) : resolve());
      }));

      it('should save as ObjectID', async function() {
        await Article.create({xid: objectIDLikeString, title: 'abc'});
        const found = await Article.findOne({where: {title: 'abc'}});
        assert.ok(found.xid instanceof ds.ObjectID);
      });
    });

    describe('when set to true', function() {
      const Article = ds.createModel(
        'ArticleB',
        {
          xid: String,
          title: String,
        },
        {strictObjectIDCoercion: true},
      );

      beforeEach(() => new Promise((resolve, reject) => {
        Article.deleteAll((err) => err ? reject(err) : resolve());
      }));

      it('should not save as ObjectID', async function() {
        await Article.create({xid: objectIDLikeString, title: 'abc'});
        const found = await Article.findOne({where: {title: 'abc'}});
        assert.ok(!(found.xid instanceof ds.ObjectID));
      });
    });
  });

  describe("mongodb: {dataType: 'objectid'}", function() {
    const Article = ds.createModel(
      'ArticleC',
      {
        xid: {type: String, mongodb: {dataType: 'objectid'}},
        xidArr: {type: [String], mongodb: {dataType: 'objectid'}},
        title: String,
      },
      {strictObjectIDCoercion: true},
    );

    beforeEach(() => new Promise((resolve, reject) => {
      Article.deleteAll((err) => err ? reject(err) : resolve());
    }));

    it('should throw if value is not an ObjectID-like string', async function() {
      await assert.rejects(
        Article.create({xid: '', title: 'abc'}),
        // Explicit mongodb.dataType ObjectID is rejected by juggler first;
        // the connector message remains if that validation is disabled.
        (e) => {
          assert.match(String(e.message), /not an ObjectID string|is not a valid ObjectId/);
          return true;
        },
      );
    });

    it('should save as ObjectID regardless of strictObjectIDCoercion: true', async function() {
      await Article.create({xid: objectIDLikeString, title: 'abc'});
      const found = await Article.findOne({where: {title: 'abc'}});
      assert.ok(found.xid instanceof ds.ObjectID);
    });

    it('should store ObjectID fields via findOrCreate $setOnInsert', async function() {
      const Member = ds.createModel(
        'MemberFOC',
        {
          personId: {type: String, mongodb: {dataType: 'objectid'}},
          title: String,
        },
        {strictObjectIDCoercion: true},
      );

      await Member.deleteAll();

      const filter = {where: {personId: objectIDLikeString}};
      const data = {personId: objectIDLikeString, title: 'member-foc'};
      const [createdInst, created] = await Member.findOrCreate(filter, data);

      assert.strictEqual(created, true);
      const raw = await findRawModelDataAsync('MemberFOC', createdInst.id);
      assert.ok(raw.personId instanceof ds.ObjectID);

      const [foundInst, createdAgain] = await Member.findOrCreate(filter, data);
      assert.strictEqual(createdAgain, false);
      assert.strictEqual(String(foundInst.id), String(createdInst.id));
      assert.strictEqual(await Member.count({personId: objectIDLikeString}), 1);
    });

    it('should properly save an array of ObjectIDs', async () => {
      await Article.create({
        xid: objectIDLikeString,
        xidArr: [objectIDLikeString, objectIDLikeString2],
        title: 'arrayOfObjectID',
      });
      const found = await Article.find({where: {title: 'arrayOfObjectID'}});
      // the type of the returned array is actually string even though they are stored as ObjectIds in the db
      for (const v of [objectIDLikeString, objectIDLikeString2]) assert.ok(found[0].xidArr.includes(v));
      // check if the array is stored as ObjectId in the db
      const raw = await findRawModelDataAsync('ArticleC', found[0].id);
      assert.ok(raw.xidArr[0] instanceof ds.ObjectID);
      assert.ok(raw.xidArr[1] instanceof ds.ObjectID);
    });

    it('handles auto-generated PK properties defined in LB4 style', async () => {
      const Note = ds.createModel('NoteLB4', {
        id: {
          type: 'string',
          id: true,
          generated: true,
          mongodb: {dataType: 'ObjectID'},
        },
        title: {
          type: 'string',
          required: true,
        },
      });

      const result = await Note.create({title: 'hello'});
      // the test passes when this call does not throw
    });

    describe('where clause', () => {
      it('should properly convert an array of ObjectIDs - implicit equal operator', async () => {
        await Article.create({
          xid: objectIDLikeString,
          xidArr: [objectIDLikeString, objectIDLikeString2],
          title: 'arrayOfObjectID',
        });
        const found = await Article.find({where: {xidArr: [objectIDLikeString, objectIDLikeString2]}});

        for (const v of [objectIDLikeString, objectIDLikeString2]) assert.ok(found[0].xidArr.includes(v));
        // check if the array is stored in ObjectId
        const raw = await findRawModelDataAsync('ArticleC', found[0].id);
        assert.ok(raw.xidArr[0] instanceof ds.ObjectID);
        assert.ok(raw.xidArr[1] instanceof ds.ObjectID);
      });

      it('should properly convert an array of ObjectIDs - extended operator', async () => {
        await Article.create({
          xid: objectIDLikeString,
          xidArr: [objectIDLikeString, objectIDLikeString2],
          title: 'arrayOfObjectID2',
        });
        const found = await Article.find(
          {where: {xidArr: {$all: [objectIDLikeString, objectIDLikeString2]}}},
          {allowExtendedOperators: true},
        );

        for (const v of [objectIDLikeString, objectIDLikeString2]) assert.ok(found[0].xidArr.includes(v));
        // check if the array is stored in ObjectId
        const raw = await findRawModelDataAsync('ArticleC', found[0].id);
        assert.ok(raw.xidArr[0] instanceof ds.ObjectID);
        assert.ok(raw.xidArr[1] instanceof ds.ObjectID);
      });
    });
  });

  describe('ObjectID as a constructor', function() {
    const Article = ds.createModel(
      'ArticleC2',
      {
        xid: {type: ds.ObjectID},
        xidArr: {type: [ds.ObjectID]},
        title: String,
      },
      {strictObjectIDCoercion: true},
    );

    beforeEach(() => new Promise((resolve, reject) => {
      Article.deleteAll((err) => err ? reject(err) : resolve());
    }));

    it('should save as ObjectID regardless of strictObjectIDCoercion: true', async function() {
      await Article.create({xid: objectIDLikeString, title: 'abc'});
      const found = await Article.findOne({where: {title: 'abc'}});
      assert.ok(found.xid instanceof ds.ObjectID);
    });

    it('should properly save an array of ObjectIDs', async () => {
      await Article.create({
        xid: objectIDLikeString,
        xidArr: [objectIDLikeString],
        title: 'arrayOfObjectID',
      });
      const found = await Article.findOne({where: {title: 'arrayOfObjectID'}});
      assert.ok(Array.isArray(found.xidArr));
      const sub = [new ds.ObjectID(objectIDLikeString)];
      assert.ok(sub.every(v => found.xidArr.some(
        a => a === v || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(v)),
      )));
    });
  });
  function findRawModelData(modelName, id, cb) {
    ds.connector.execute(modelName, 'findOne', {_id: {$eq: id}}, {safe: true}, cb);
  }
  const findRawModelDataAsync = promisify(findRawModelData);
});
