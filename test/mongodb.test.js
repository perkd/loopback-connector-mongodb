// Copyright IBM Corp. 2013,2020. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// This test written in mocha+should.js
const semver = require('semver');
require('./init.js');

const {describe, it, before, beforeEach, after, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const testUtils = require('../lib/test-utils');

function __CONTAIN_FN__(actual, expected) {
  const norm = v => JSON.parse(JSON.stringify(v));
  const a = norm(actual);
  const e = norm(expected);
  function contains(act, exp) {
    if (Array.isArray(exp)) {
      if (!Array.isArray(act)) return false;
      return exp.every(es => act.some(ae => contains(ae, es)));
    }
    if (exp !== null && typeof exp === 'object') {
      if (act === null || typeof act !== 'object') return false;
      return Object.keys(exp).every(k => contains(act[k], exp[k]));
    }
    return act === exp;
  }
  assert.ok(contains(a, e), 'Expected ' + JSON.stringify(a) + ' to contain ' + JSON.stringify(e));
}

const sanitizeFilter = require('../lib/mongodb').sanitizeFilter;
const trimLeadingDollarSigns = require('../lib/mongodb').trimLeadingDollarSigns;

const GeoPoint = require('loopback-datasource-juggler').GeoPoint;

let Superhero,
  User,
  Post,
  Product,
  PostWithStringId,
  db,
  PostWithObjectId,
  PostWithNumberUnderscoreId,
  PostWithNumberId,
  Category,
  UserWithRenamedColumns,
  PostWithStringIdAndRenamedColumns,
  Employee,
  PostWithDisableDefaultSort,
  WithEmbeddedProperties,
  WithEmbeddedBinaryProperties,
  WithInvalidCustomIdFieldName;

describe('connect', function() {
  it('should skip connect phase (lazyConnect = true)', () => new Promise((resolve, reject) => {
    const ds = global.getDataSource({
      host: '127.0.0.1',
      port: 4,
      lazyConnect: true,
    });
    const errTimeout = setTimeout(function() {
      resolve();
    }, 2000);

    ds.on('error', function(err) {
      clearTimeout(errTimeout);
      reject(err);
    });
  }));

  it('should report connection error (lazyConnect = false)', () => new Promise((resolve, reject) => {
    const ds = global.getDataSource({
      host: '127.0.0.1',
      port: 4,
      lazyConnect: false,
      serverSelectionTimeoutMS: 1000,
    });

    ds.on('error', function(err) {
      assert.ok(err != null);
      assert.ok(['MongoServerSelectionError', 'MongoNetworkError', 'MongoTimeoutError'].includes(err.name));
      assert.match(String(err.message), /connect ECONNREFUSED/);
      resolve();
    });
  }));

  it('should report url parsing error', () => new Promise((resolve, reject) => {
    const ds = global.getDataSource({
      url: 'mongodb://xyz:@127.0.0.1:4/xyz_dev_db',
      serverSelectionTimeoutMS: 1000,
    });

    ds.on('error', function(err) {
      assert.ok(err != null);
      assert.ok(['MongoServerSelectionError', 'MongoNetworkError', 'MongoTimeoutError'].includes(err.name));
      assert.match(String(err.message), /connect ECONNREFUSED/);
      resolve();
    });
  }));

  it('should connect on execute (lazyConnect = true)', () => new Promise((resolve, reject) => {
    const ds = global.getDataSource({
      host: '127.0.0.1',
      port: global.config.port,
      lazyConnect: true,
    });

    ds.define('TestLazy', {
      value: {type: String},
    });

    ds.connector.execute(
      'TestLazy',
      'insertOne',
      {value: 'test value'},
      function(err, success) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );
  }));

  it('should reconnect on execute when disconnected (lazyConnect = true)', () => new Promise((resolve, reject) => {
    const ds = global.getDataSource({
      host: '127.0.0.1',
      port: global.config.port,
      lazyConnect: true,
    });

    ds.define('TestLazy', {
      value: {type: String},
    });

    assert.strictEqual(ds.connector['db'], undefined);

    ds.connector.execute(
      'TestLazy',
      'insertOne',
      {value: 'test value'},
      function(err, success) {
        if (err) return reject(err);
        const id = success.insertedId;
        assert.ok('db' in ds.connector);

        ds.connector.disconnect(function(err) {
          if (err) return reject(err);
          ds.connector.execute('TestLazy', 'findOne', {_id: id}, function(
            err,
            data,
          ) {
            if (err) return reject(err);
            resolve();
          });
        });
      },
    );
  }));
});

describe('mongodb connector', function() {
  before(function() {
    db = global.getDataSource();

    User = db.define(
      'User',
      {
        name: {type: String, index: true},
        email: {type: String, index: true, unique: true},
        age: Number,
        icon: Buffer,
      },
      {
        indexes: {
          /* eslint-disable camelcase */
          name_age_index: {
            keys: {name: 1, age: -1},
          }, // The value contains keys and optinally options
          age_index: {age: -1}, // The value itself is for keys
          /* eslint-enable camelcase */
        },
      },
    );

    UserWithRenamedColumns = db.define(
      'UserWithRenamedColumns',
      {
        renamedName: {type: String, index: true, mongodb: {column: 'name'}},
        renamedEmail: {
          type: String,
          index: true,
          unique: true,
          mongodb: {field: 'email'},
        },
        age: Number,
        icon: Buffer,
      },
      {
        mongodb: {
          collection: 'User', // Overlay on the User collection
        },
      },
    );

    Superhero = db.define(
      'Superhero',
      {
        name: {type: String, index: true},
        power: {type: String, index: true, unique: true},
        address: {
          type: String,
          required: false,
          index: {mongodb: {unique: false, sparse: true}},
        },
        description: {type: String, required: false},
        location: {type: Object, required: false},
        age: Number,
        icon: Buffer,
      },
      {
        mongodb: {
          collection: 'sh',
        },
        indexes: {
          // eslint-disable-next-line
          geojson_location_geometry: {
            'location.geometry': '2dsphere',
          },
        },
      },
    );

    Post = db.define(
      'Post',
      {
        title: {type: String, length: 255, index: true},
        content: {type: String},
        comments: [String],
      },
      {
        mongodb: {
          collection: 'PostCollection', // Customize the collection name
        },
        forceId: false,
      },
    );

    Product = db.define(
      'Product',
      {
        name: {type: String, length: 255, index: true},
        description: {type: String},
        price: {type: Number},
        pricehistory: {type: Object},
      },
      {
        mongodb: {
          collection: 'ProductCollection', // Customize the collection name
        },
        forceId: false,
      },
    );

    PostWithStringId = db.define('PostWithStringId', {
      id: {type: String, id: true},
      title: {type: String, length: 255, index: true},
      content: {type: String},
    });

    PostWithObjectId = db.define('PostWithObjectId', {
      _id: {type: db.ObjectID, id: true},
      title: {type: String, length: 255, index: true},
      content: {type: String},
    });

    PostWithNumberUnderscoreId = db.define('PostWithNumberUnderscoreId', {
      _id: {type: Number, id: true},
      title: {type: String, length: 255, index: true},
      content: {type: String},
    });

    PostWithNumberId = db.define('PostWithNumberId', {
      id: {type: Number, id: true},
      title: {type: String, length: 255, index: true},
      content: {type: String},
    });

    Category = db.define('Category', {
      title: {type: String, length: 255, index: true},
      posts: {type: [db.ObjectID], index: true},
    }, {
      indexes: {
        'title_case_insensitive': {
          keys: {title: 1},
          options: {collation: {locale: 'en', strength: 1}},
        },
      },
    });

    PostWithStringIdAndRenamedColumns = db.define(
      'PostWithStringIdAndRenamedColumns',
      {
        id: {type: String, id: true},
        renamedTitle: {
          type: String,
          length: 255,
          index: true,
          mongodb: {fieldName: 'title'},
        },
        renamedContent: {type: String, mongodb: {columnName: 'content'}},
      },
      {
        mongodb: {
          collection: 'PostWithStringId', // Overlay on the PostWithStringId collection
        },
      },
    );

    PostWithDisableDefaultSort = db.define(
      'PostWithDisableDefaultSort',
      {
        id: {type: String, id: true},
        title: {type: String, length: 255, index: true},
        content: {type: String},
      },
      {
        disableDefaultSort: true,
      },
    );

    WithEmbeddedProperties = db.define(
      'WithEmbeddedProperties',
      {
        id: {type: String, id: true},
        name: {type: String},
        location: {
          type: {
            city: {type: String},
            country: {type: String},
          },
        },
      },
    );

    WithEmbeddedBinaryProperties = db.define(
      'WithEmbeddedBinaryProperties',
      {
        name: {type: String},
        image: {
          type: {
            label: String,
            rawImg: Buffer,
          },
        },
      },
    );

    WithInvalidCustomIdFieldName = db.define(
      'WithInvalidCustomIdFieldName',
      {
        id: {
          type: String,
          id: true,
          mongodb: {fieldName: 'rejected'},
        },
        content: {type: String},
      },
    );

    User.hasMany(Post);
    Post.belongsTo(User);
  });

  beforeEach(() => new Promise((resolve, reject) => {
    User.settings.mongodb = {};
    User.destroyAll(function() {
      Post.destroyAll(function() {
        PostWithObjectId.destroyAll(function() {
          PostWithNumberId.destroyAll(function() {
            PostWithNumberUnderscoreId.destroyAll(function() {
              PostWithStringId.destroyAll(function() {
                PostWithDisableDefaultSort.destroyAll(function() {
                  Category.destroyAll(function() {
                    WithEmbeddedProperties.destroyAll(function() {
                      resolve();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }));

  describe('.ping(cb)', function() {
    it('should return true for valid connection', () => new Promise((resolve, reject) => {
      db.ping((err) => err ? reject(err) : resolve());
    }));

    it('should report connection errors with invalid config', () => new Promise((resolve, reject) => {
      const ds = global.getDataSource({
        host: 'localhost',
        port: 4, // unassigned by IANA
        serverSelectionTimeoutMS: 1000,
      });
      ds.ping(function(err) {
        assert.ok(err != null);
        assert.ok(['MongoServerSelectionError', 'MongoNetworkError', 'MongoTimeoutError'].includes(err.name));
        assert.match(String(err.message), /connect ECONNREFUSED/);
        resolve();
      });
    }));

    it('ignores invalid option', () => new Promise((resolve, reject) => {
      const configWithInvalidOption = Object.assign({}, global.config, {
        invalidOption: 'invalid',
      });
      const ds = global.getDataSource(configWithInvalidOption);
      ds.ping(function(err) {
        if (err) return reject(err);
        ds.disconnect((err) => err ? reject(err) : resolve());
      });
    }));

    it('accepts database from the url', () => new Promise((resolve, reject) => {
      const cfg = JSON.parse(JSON.stringify(global.config));
      delete cfg.database;
      const ds = global.getDataSource(cfg);
      ds.ping(function(err) {
        if (err) return reject(err);
        ds.disconnect((err) => err ? reject(err) : resolve());
      });
    }));

    it('should prioritize to the database given in the url property', () => new Promise((resolve, reject) => {
      const cfg = JSON.parse(JSON.stringify(global.config));
      const testDb = 'lb-ds-overriden-test-1';
      cfg.url = 'mongodb://' + cfg.host + ':' + cfg.port + '/' + testDb;
      const ds = global.getDataSource(cfg);
      ds.once('connected', function() {
        const db = ds.connector.db;
        let validationError = null;
        try {
          assert.strictEqual(db['databaseName'], testDb); // check the db name in the db instance
        } catch (err) {
          // async error
          validationError = err;
        }
        ds.ping(function(err) {
          if (err && !validationError) validationError = err;
          ds.disconnect(function(disconnectError) {
            if (disconnectError && !validationError)
              validationError = disconnectError;
            if (validationError) reject(validationError); else resolve();
          });
        });
      });
    }));
  });

  describe('order filters', function() {
    let employeeDb;
    const data = [
      {
        id: 1,
        title: 'Senior Software Developer',
        name: 'Foo',
        contact: 'foo@foo.com',
      },
      {
        id: 3,
        title: 'Lead Developer',
        name: 'Baz',
        contact: 'baz@baz.com',
      },
      {
        id: 5,
        title: 'Senior Architect',
        name: 'Bar',
        contact: 'bar@bar.com',
      },
    ];
    before(() => new Promise((resolve, reject) => {
      employeeDb = global.getDataSource();

      Employee = employeeDb.define('Employee', {
        id: {type: Number, id: true},
        title: {type: String, length: 255},
        name: {type: String},
        contact: {type: String},
      });

      employeeDb.automigrate(function(err) {
        assert.ok(err == null);
        Employee.create(data, (err) => err ? reject(err) : resolve());
      });
    }));

    after(() => new Promise((resolve, reject) => {
      Employee.destroyAll((err) => err ? reject(err) : resolve());
    }));

    describe('using buildSort directly', function() {
      it('sort in descending order', () => new Promise((resolve, reject) => {
        const sort = employeeDb.connector.buildSort('Employee', 'id DESC');
        assert.ok('_id' in sort);
        assert.strictEqual(sort._id, -1);
        resolve();
      }));
      it('sort in ascending order', () => new Promise((resolve, reject) => {
        const sort = employeeDb.connector.buildSort('Employee', 'id ASC');
        assert.ok('_id' in sort);
        assert.strictEqual(sort._id, 1);
        resolve();
      }));
    });

    describe('using all with order filter', function() {
      it('find instances in descending order', () => new Promise((resolve, reject) => {
        Employee.all({order: 'id DESC'}, function(err, result) {
          assert.ok(err == null);
          assert.ok(result != null);
          assert.strictEqual(result.length, data.length);
          assert.deepStrictEqual(result[0].toObject(), data[2]);
          assert.deepStrictEqual(result[1].toObject(), data[1]);
          assert.deepStrictEqual(result[2].toObject(), data[0]);
          resolve();
        });
      }));
      it('find instances in ascending order', () => new Promise((resolve, reject) => {
        Employee.all({order: 'id ASC'}, function(err, result) {
          assert.ok(err == null);
          assert.ok(result != null);
          assert.strictEqual(result.length, data.length);
          assert.deepStrictEqual(result[0].toObject(), data[0]);
          assert.deepStrictEqual(result[1].toObject(), data[1]);
          assert.deepStrictEqual(result[2].toObject(), data[2]);
          resolve();
        });
      }));
    });
  });

  it('should create indexes', () => new Promise((resolve, reject) => {
    db.automigrate('User', function() {
      db.connector.db
        .collection('User')
        .indexInformation(function(err, result) {
          if (err) return reject(err);
          /* eslint-disable camelcase */
          const indexes = {
            _id_: [['_id', 1]],
            name_age_index: [['name', 1], ['age', -1]],
            age_index: [['age', -1]],
            name_1: [['name', 1]],
            email_1: [['email', 1]],
          };
          /* eslint-enable camelcase */
          assert.deepStrictEqual(indexes, result);
          resolve();
        });
    });
  }));

  it('should create complex indexes', () => new Promise((resolve, reject) => {
    db.automigrate('Superhero', function() {
      db.connector.db.collection('sh').indexInformation(function(err, result) {
        if (err) return reject(err);
        /* eslint-disable camelcase */
        const indexes = {
          _id_: [['_id', 1]],
          geojson_location_geometry: [['location.geometry', '2dsphere']],
          power_1: [['power', 1]],
          name_1: [['name', 1]],
          address_1: [['address', 1]],
        };
        /* eslint-enable camelcase */

        assert.deepStrictEqual(indexes, result);
        resolve();
      });
    });
  }));

  it('should create case insensitive indexes', () => new Promise((resolve, reject) => {
    db.automigrate('Category', function() {
      db.connector.db.collection('Category').indexes(function(err, result) {
        if (err) return reject(err);
        const indexes = [
          {name: '_id_', key: {_id: 1}},
          {name: 'title_1', key: {title: 1}},
          {name: 'title_case_insensitive', key: {title: 1}, collation: {locale: 'en', strength: 1}},
          {name: 'posts_1', key: {posts: 1}},
        ];

        __CONTAIN_FN__(result, indexes);
        resolve();
      });
    });
  }));

  it('should have created models with correct _id types', () => new Promise((resolve, reject) => {
    assert.strictEqual(PostWithObjectId.definition.properties._id.type,
      db.ObjectID);
    assert.ok(PostWithObjectId.definition.properties.id == null);
    assert.strictEqual(PostWithNumberUnderscoreId.definition.properties._id.type,
      Number);
    assert.ok(PostWithNumberUnderscoreId.definition.properties.id == null);

    resolve();
  }));

  it('should handle correctly type Number for id field _id', () => new Promise((resolve, reject) => {
    PostWithNumberUnderscoreId.create({_id: 3, content: 'test'}, function(
      err,
      person,
    ) {
      assert.ok(err == null);
      assert.strictEqual(person._id, 3);

      PostWithNumberUnderscoreId.findById(person._id, function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.content, 'test');

        resolve();
      });
    });
  }));

  it('should handle correctly type Number for id field _id using string', () => new Promise((resolve, reject) => {
    PostWithNumberUnderscoreId.create({_id: 4, content: 'test'}, function(
      err,
      person,
    ) {
      assert.ok(err == null);
      assert.strictEqual(person._id, 4);

      PostWithNumberUnderscoreId.findById('4', function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.content, 'test');

        resolve();
      });
    });
  }));

  it('should allow to find post by id string if `_id` is defined id', () => new Promise((resolve, reject) => {
    PostWithObjectId.create(function(err, post) {
      PostWithObjectId.find({where: {_id: post._id.toString()}}, function(
        err,
        p,
      ) {
        assert.ok(err == null);
        post = p[0];
        assert.ok(post != null);
        assert.ok(post._id instanceof db.ObjectID);

        resolve();
      });
    });
  }));

  it('find with `_id` as defined id should return an object with _id instanceof ObjectID',
    () => new Promise((resolve, reject) => {
      PostWithObjectId.create(function(err, post) {
        PostWithObjectId.findById(post._id, function(err, post) {
          assert.ok(err == null);
          assert.ok(post._id instanceof db.ObjectID);

          resolve();
        });
      });
    }));

  it('should update the instance with `_id` as defined id', () => new Promise((resolve, reject) => {
    PostWithObjectId.create({title: 'a', content: 'AAA'}, function(
      err,
      post,
    ) {
      post.title = 'b';
      PostWithObjectId.updateOrCreate(post, function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p._id, post._id);

        PostWithObjectId.findById(post._id, function(err, p) {
          assert.ok(err == null);
          assert.deepStrictEqual(p._id, post._id);
          assert.strictEqual(p.content, post.content);
          assert.strictEqual(p.title, 'b');
        });

        PostWithObjectId.find({where: {title: 'b'}}, function(err, posts) {
          assert.ok(err == null);
          p = posts[0];
          assert.deepStrictEqual(p._id, post._id);
          assert.strictEqual(p.content, post.content);
          assert.strictEqual(p.title, 'b');
          assert.strictEqual(posts.length, 1);
          resolve();
        });
      });
    });
  }));

  it('all should return object (with `_id` as defined id) with an _id instanceof ObjectID',
    () => new Promise((resolve, reject) => {
      const post = new PostWithObjectId({title: 'a', content: 'AAA'});
      post.save(function(err, post) {
        PostWithObjectId.all({where: {title: 'a'}}, function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.strictEqual(post['title'], 'a');
          assert.strictEqual(post['content'], 'AAA');
          assert.ok(post._id instanceof db.ObjectID);

          resolve();
        });
      });
    }));

  it('all return should honor filter.fields, with `_id` as defined id', () => new Promise((resolve, reject) => {
    const post = new PostWithObjectId({title: 'a', content: 'AAA'});
    post.save(function(err, post) {
      PostWithObjectId.all(
        {fields: ['title'], where: {title: 'a'}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.strictEqual(post['title'], 'a');
          assert.strictEqual(post['content'], undefined);
          assert.ok(post._id == null);

          resolve();
        },
      );
    });
  }));

  it('all return should honor filter.fields with `_id` selected', () => new Promise((resolve, reject) => {
    const post = new PostWithObjectId({title: 'a', content: 'AAA'});
    post.save(function(err, post) {
      PostWithObjectId.all(
        {fields: ['_id', 'content'], where: {title: 'a'}},
        function(err, posts) {
          assert.ok(err == null);
          if (err) return reject(err);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.ok(post.title == null);
          assert.strictEqual(post['content'], 'AAA');
          assert.ok(post._id instanceof db.ObjectID);

          resolve();
        },
      );
    });
  }));

  it('should support Buffer type', () => new Promise((resolve, reject) => {
    User.create({name: 'John', icon: new Buffer('1a2')}, function(e, u) {
      User.findById(u.id, function(e, user) {
        assert.ok(user.icon instanceof Buffer);
        resolve();
      });
    });
  }));

  it('should properly retrieve embedded model properties', () => new Promise((resolve, reject) => {
    const data = {name: 'Mitsos', location: {city: 'Volos', country: 'Greece'}};
    WithEmbeddedProperties.create(data, function(err, createdModel) {
      if (err) return reject(err);
      WithEmbeddedProperties.findById(createdModel.id, function(err, dbModel) {
        if (err) return reject(err);
        const modelObj = dbModel.toJSON();
        const dataObj = Object.assign({id: modelObj.id}, data);
        assert.deepStrictEqual(modelObj, dataObj);
        resolve();
      });
    });
  }));

  it('should not present missing embedded model properties as null', () => new Promise((resolve, reject) => {
    const data = {name: 'Mitsos'};
    WithEmbeddedProperties.create(data, function(err, createdModel) {
      if (err) return reject(err);
      WithEmbeddedProperties.findById(createdModel.id, function(err, dbModel) {
        if (err) return reject(err);
        const modelObj = dbModel.toJSON();
        const dataObj = Object.assign({}, data, {id: modelObj.id, location: undefined});
        assert.deepStrictEqual(modelObj, dataObj);
        resolve();
      });
    });
  }));

  it('should convert embedded model binary properties to buffer correctly', () => new Promise((resolve, reject) => {
    const entity = {
      name: 'Rigas',
      image: {label: 'paris 2016', rawImg: Buffer.from([255, 216, 255, 224])},
    };
    WithEmbeddedBinaryProperties.create(entity, function(e, r) {
      WithEmbeddedBinaryProperties.findById(r.id, function(e, post) {
        assert.deepStrictEqual(post.image.rawImg, Buffer.from([255, 216, 255, 224]));
        resolve();
      });
    });
  }));

  it('hasMany should support additional conditions', () => new Promise((resolve, reject) => {
    User.create(function(e, u) {
      u.posts.create({}, function(e, p) {
        u.posts({where: {id: p.id}}, function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);

          resolve();
        });
      });
    });
  }));

  it('create should return id field but not mongodb _id', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post content'}, function(
      err,
      post,
    ) {
      // console.log('create should', err, post);
      assert.ok(err == null);
      assert.ok(post.id != null);
      assert.ok(post._id == null);

      resolve();
    });
  }));

  it('should allow to find by id string', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post content'}, function(
      err,
      post,
    ) {
      Post.findById(post.id.toString(), function(err, p) {
        assert.ok(err == null);
        assert.ok(p != null);
        resolve();
      });
    });
  }));

  it('should allow custom collection name', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post content'}, function(
      err,
      post,
    ) {
      Post.dataSource.connector.db
        .collection('PostCollection')
        .findOne({_id: post.id}, function(err, p) {
          assert.ok(err == null);
          assert.ok(p != null);
          resolve();
        });
    });
  }));

  it('should allow to find by id using where', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post1 content'}, function(
      err,
      p1,
    ) {
      Post.create({title: 'Post2', content: 'Post2 content'}, function(
        err,
        p2,
      ) {
        Post.find({where: {id: p1.id}}, function(err, p) {
          assert.ok(err == null);
          assert.ok(p && p[0] != null);
          assert.strictEqual(p.length, 1);
          // Not strict equal
          assert.deepStrictEqual(p[0].id, p1.id);
          resolve();
        });
      });
    });
  }));

  it('should return data for nested `$where` in where', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post1 content'}, (err, p1) => {
      Post.create({title: 'Post2', content: 'Post2 content'}, (err2, p2) => {
        Post.create({title: 'Post3', content: 'Post3 data'}, (err3, p3) => {
          Post.find({where: {$where: 'function() {return this.content.contains("content")}'}}, (err, p) => {
            assert.ok(err == null);
            assert.strictEqual(p.length, 3);
            resolve();
          });
        });
      });
    });
  }));

  it('should allow $where in where with options.disableSanitization', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post1 content'}, (err, p1) => {
      Post.create({title: 'Post2', content: 'Post2 content'}, (err2, p2) => {
        Post.create({title: 'Post3', content: 'Post3 data'}, (err3, p3) => {
          Post.find(
            {where: {$where: 'function() {return this.content.includes("content")}'}},
            {disableSanitization: true},
            (err, p) => {
              assert.ok(err == null);
              assert.strictEqual(p.length, 2);
              resolve();
            },
          );
        });
      });
    });
  }));

  it('does not execute a nested `$where` when extended operators are allowed', () => new Promise((resolve, reject) => {
    const nestedWhereFilter = {where: {content: {$where: 'function() {return this.content.includes("content")}'}}};
    Post.create({title: 'Post1', content: 'Post1 content'}, (err, p1) => {
      Post.create({title: 'Post2', content: 'Post2 content'}, (err2, p2) => {
        Post.create({title: 'Post3', content: 'Post3 data'}, (err3, p3) => {
          Post.find(nestedWhereFilter, {allowExtendedOperators: true}, (err, p) => {
            assert.ok(err != null);
            assert.match(String(err.message), /\$where/);
            resolve();
          });
        });
      });
    });
  }));

  it('should allow to find by id using where inq', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post1 content'}, function(
      err,
      p1,
    ) {
      Post.create({title: 'Post2', content: 'Post2 content'}, function(
        err,
        p2,
      ) {
        Post.find({where: {id: {inq: [p1.id]}}}, function(err, p) {
          assert.ok(err == null);
          assert.ok(p && p[0] != null);
          assert.strictEqual(p.length, 1);
          // Not strict equal
          assert.deepStrictEqual(p[0].id, p1.id);
          resolve();
        });
      });
    });
  }));

  it('should invoke hooks', () => new Promise((resolve, reject) => {
    const events = [];
    const connector = Post.getDataSource().connector;
    connector.observe('before execute', function(ctx, next) {
      assert.strictEqual(typeof ctx.req.command, 'string');
      assert.ok(Array.isArray(ctx.req.params));
      events.push('before execute ' + ctx.req.command);
      next();
    });
    connector.observe('after execute', function(ctx, next) {
      assert.ok(ctx.res !== null && typeof ctx.res === 'object');
      events.push('after execute ' + ctx.req.command);
      next();
    });
    Post.create({title: 'Post1', content: 'Post1 content'}, function(
      err,
      p1,
    ) {
      Post.find(function(err, results) {
        assert.deepStrictEqual(events, [
          'before execute insert',
          'after execute insert',
          'before execute find',
          'after execute find',
        ]);
        connector.clearObservers('before execute');
        connector.clearObservers('after execute');
        if (err) reject(err); else resolve();
      });
    });
  }));

  it('should allow to find by number id using where', () => new Promise((resolve, reject) => {
    PostWithNumberId.create(
      {id: 1, title: 'Post1', content: 'Post1 content'},
      function(err, p1) {
        PostWithNumberId.create(
          {id: 2, title: 'Post2', content: 'Post2 content'},
          function(err, p2) {
            PostWithNumberId.find({where: {id: p1.id}}, function(err, p) {
              assert.ok(err == null);
              assert.ok(p && p[0] != null);
              assert.strictEqual(p.length, 1);
              assert.deepStrictEqual(p[0].id, p1.id);
              resolve();
            });
          },
        );
      },
    );
  }));

  it('should allow to find by number id using where inq', () => new Promise((resolve, reject) => {
    PostWithNumberId.create(
      {id: 1, title: 'Post1', content: 'Post1 content'},
      function(err, p1) {
        PostWithNumberId.create(
          {id: 2, title: 'Post2', content: 'Post2 content'},
          function(err, p2) {
            PostWithNumberId.find({where: {id: {inq: [1]}}}, function(
              err,
              p,
            ) {
              assert.ok(err == null);
              assert.ok(p && p[0] != null);
              assert.strictEqual(p.length, 1);
              assert.deepStrictEqual(p[0].id, p1.id);
              PostWithNumberId.find(
                {where: {id: {inq: [1, 2]}}},
                function(err, p) {
                  assert.ok(err == null);
                  assert.strictEqual(p.length, 2);
                  assert.deepStrictEqual(p[0].id, p1.id);
                  assert.deepStrictEqual(p[1].id, p2.id);
                  PostWithNumberId.find(
                    {where: {id: {inq: [0]}}},
                    function(err, p) {
                      assert.ok(err == null);
                      assert.strictEqual(p.length, 0);
                      resolve();
                    },
                  );
                },
              );
            });
          },
        );
      },
    );
  }));

  it('save should not return mongodb _id', () => new Promise((resolve, reject) => {
    Post.create({title: 'Post1', content: 'Post content'}, function(
      err,
      post,
    ) {
      post.content = 'AAA';
      post.save(function(err, p) {
        assert.ok(err == null);
        assert.ok(p._id == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.content, 'AAA');

        resolve();
      });
    });
  }));

  it('find should return an object with an id, which is instanceof ObjectID, but not mongodb _id',
    () => new Promise((resolve, reject) => {
      Post.create({title: 'Post1', content: 'Post content'}, function(
        err,
        post,
      ) {
        Post.findById(post.id, function(err, post) {
          assert.ok(err == null);
          assert.ok(post.id instanceof db.ObjectID);
          assert.ok(post._id == null);

          resolve();
        });
      });
    }));

  describe('updateAll', function() {
    it('should not mutate the input data object', async function() {
      const user = await User.create({name: 'Al', age: 31, email: 'al@strongloop'});
      const userId = user.id;
      const userData = user.toObject();
      userData.age = 100;

      await User.update(userData);
      assert.strictEqual(userData['id'], userId);
    });

    it('should not mutate the input model instance', async function() {
      const user = await User.create({name: 'Al', age: 31, email: 'al@strongloop'});
      const userId = user.id;
      user.age = 100;
      user.name = 'Albert';

      await User.update(user);
      assert.strictEqual(user['id'], userId);
      assert.strictEqual(user['name'], 'Albert');
    });

    it('should update the instance matching criteria', () => new Promise((resolve, reject) => {
      User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
        err1,
        createdusers1,
      ) {
        assert.ok(err1 == null);
        User.create(
          {name: 'Simon', age: 32, email: 'simon@strongloop'},
          function(err2, createdusers2) {
            assert.ok(err2 == null);
            User.create(
              {name: 'Ray', age: 31, email: 'ray@strongloop'},
              function(err3, createdusers3) {
                assert.ok(err3 == null);

                User.updateAll(
                  {age: 31},
                  {company: 'strongloop.com'},
                  function(err, updatedusers) {
                    assert.ok(err == null);
                    assert.strictEqual(updatedusers['count'], 2);

                    User.find({where: {age: 31}}, function(
                      err2,
                      foundusers,
                    ) {
                      assert.ok(err2 == null);
                      assert.strictEqual(foundusers[0].company, 'strongloop.com');
                      assert.strictEqual(foundusers[1].company, 'strongloop.com');

                      resolve();
                    });
                  },
                );
              },
            );
          },
        );
      });
    }));

    it('should clean the data object', () => new Promise((resolve, reject) => {
      User.dataSource.settings.allowExtendedOperators = true;

      User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
        err1,
        createdusers1,
      ) {
        assert.ok(err1 == null);
        User.create(
          {name: 'Simon', age: 32, email: 'simon@strongloop'},
          function(err2, createdusers2) {
            assert.ok(err2 == null);
            User.create(
              {name: 'Ray', age: 31, email: 'ray@strongloop'},
              function(err3, createdusers3) {
                assert.ok(err3 == null);
                User.updateAll({}, {age: 40, $set: {age: 39}}, function(
                  err,
                  updatedusers,
                ) {
                  assert.ok(err == null);
                  assert.strictEqual(updatedusers['count'], 3);

                  User.find({where: {age: 40}}, function(err2, foundusers) {
                    assert.ok(err2 == null);
                    assert.strictEqual(foundusers.length, 0);

                    User.find({where: {age: 39}}, function(
                      err3,
                      foundusers,
                    ) {
                      assert.ok(err3 == null);
                      assert.strictEqual(foundusers.length, 3);

                      User.updateAll(
                        {},
                        {$set: {age: 40}, age: 39},
                        function(err, updatedusers) {
                          assert.ok(err == null);
                          assert.strictEqual(updatedusers['count'], 3);
                          User.find({where: {age: 40}}, function(
                            err2,
                            foundusers,
                          ) {
                            assert.ok(err2 == null);
                            assert.strictEqual(foundusers.length, 3);
                            User.find({where: {age: 39}}, function(
                              err3,
                              foundusers,
                            ) {
                              assert.ok(err3 == null);
                              assert.strictEqual(foundusers.length, 0);

                              resolve();
                            });
                          });
                        },
                      );
                    });
                  });
                });
              },
            );
          },
        );
      });
    }));

    let describeMongo26 = describe;
    if (
      process.env.MONGODB_VERSION &&
      !semver.satisfies(process.env.MONGODB_VERSION, '~2.6.0')
    ) {
      describeMongo26 = describe.skip;
    }

    describeMongo26('extended operators', function() {
      it('should use $set by default if no operator is supplied', () => new Promise((resolve, reject) => {
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);
          User.create(
            {name: 'Simon', age: 32, email: 'simon@strongloop'},
            function(err2, createdusers2) {
              assert.ok(err2 == null);
              User.create(
                {name: 'Ray', age: 31, email: 'ray@strongloop'},
                function(err3, createdusers3) {
                  assert.ok(err3 == null);

                  User.updateAll({name: 'Simon'}, {name: 'Alex'}, function(
                    err,
                    updatedusers,
                  ) {
                    assert.ok(err == null);
                    assert.strictEqual(updatedusers['count'], 1);

                    User.find({where: {name: 'Alex'}}, function(
                      err,
                      founduser,
                    ) {
                      assert.ok(err == null);
                      assert.strictEqual(founduser.length, 1);
                      assert.strictEqual(founduser[0].name, 'Alex');

                      resolve();
                    });
                  });
                },
              );
            },
          );
        });
      }));

      it('should use $set by default if no operator is supplied (using renamed columns)',
        () => new Promise((resolve, reject) => {
          User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
            err1,
            createdusers1,
          ) {
            assert.ok(err1 == null);
            User.create(
              {name: 'Simon', age: 32, email: 'simon@strongloop'},
              function(err2, createdusers2) {
                assert.ok(err2 == null);
                User.create(
                  {name: 'Ray', age: 31, email: 'ray@strongloop'},
                  function(err3, createdusers3) {
                    assert.ok(err3 == null);

                    UserWithRenamedColumns.updateAll(
                      {name: 'Simon'},
                      {renamedName: 'Alex'},
                      function(err, updatedusers) {
                        assert.ok(err == null);
                        assert.strictEqual(updatedusers['count'], 1);

                        User.find({where: {name: 'Alex'}}, function(
                          err,
                          founduser,
                        ) {
                          assert.ok(err == null);
                          assert.strictEqual(founduser.length, 1);
                          assert.strictEqual(founduser[0].name, 'Alex');

                          resolve();
                        });
                      },
                    );
                  },
                );
              },
            );
          });
        }));

      it('should be possible to enable per model settings', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = null;
        User.settings.mongodb = {allowExtendedOperators: true};
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);

          User.updateAll(
            {name: 'Al'},
            {$rename: {name: 'firstname'}},
            function(err, updatedusers) {
              assert.ok(err == null);
              assert.strictEqual(updatedusers['count'], 1);

              User.find({where: {firstname: 'Al'}}, function(
                err,
                foundusers,
              ) {
                assert.ok(err == null);
                assert.strictEqual(foundusers.length, 1);

                resolve();
              });
            },
          );
        });
      }));

      it('should not be possible to enable per model settings when globally disabled',
        () => new Promise((resolve, reject) => {
          User.dataSource.settings.allowExtendedOperators = false;
          User.settings.mongodb = {allowExtendedOperators: true};
          User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
            err1,
            createdusers1,
          ) {
            assert.ok(err1 == null);

            User.updateAll(
              {name: 'Al'},
              {$rename: {name: 'firstname'}},
              function(err, updatedusers) {
                assert.ok(err != null);
                assert.strictEqual(err.name, 'MongoServerError');
                assert.match(String(err.errmsg), /The dollar \(\$\) prefixed field '\$rename' in '\$rename'/);
                resolve();
              },
            );
          });
        }));

      it('should not be possible to use when disabled per model settings', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.settings.mongodb = {allowExtendedOperators: false};
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);

          User.updateAll(
            {name: 'Al'},
            {$rename: {name: 'firstname'}},
            function(err, updatedusers) {
              assert.ok(err != null);
              assert.strictEqual(err.name, 'MongoServerError');
              assert.match(String(err.errmsg), /The dollar \(\$\) prefixed field '\$rename' in '\$rename'/);
              resolve();
            },
          );
        });
      }));

      it('should be possible to enable using options - even if globally disabled',
        () => new Promise((resolve, reject) => {
          User.dataSource.settings.allowExtendedOperators = false;
          const options = {allowExtendedOperators: true};
          User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
            err1,
            createdusers1,
          ) {
            assert.ok(err1 == null);

            User.updateAll(
              {name: 'Al'},
              {$rename: {name: 'firstname'}},
              options,
              function(err, updatedusers) {
                assert.ok(err == null);
                assert.strictEqual(updatedusers['count'], 1);

                User.find({where: {firstname: 'Al'}}, function(
                  err,
                  foundusers,
                ) {
                  assert.ok(err == null);
                  assert.strictEqual(foundusers.length, 1);

                  resolve();
                });
              },
            );
          });
        }));

      it('should be possible to disable using options - even if globally disabled',
        () => new Promise((resolve, reject) => {
          User.dataSource.settings.allowExtendedOperators = true;
          const options = {allowExtendedOperators: false};
          User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
            err1,
            createdusers1,
          ) {
            assert.ok(err1 == null);

            User.updateAll(
              {name: 'Al'},
              {$rename: {name: 'firstname'}},
              options,
              function(err, updatedusers) {
                assert.ok(err != null);
                assert.strictEqual(err.name, 'MongoServerError');
                assert.match(String(err.errmsg), /The dollar \(\$\) prefixed field '\$rename' in '\$rename'/);
                resolve();
              },
            );
          });
        }));

      it('should be possible to use the $inc operator', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);
          User.create(
            {name: 'Simon', age: 32, email: 'simon@strongloop'},
            function(err2, createdusers2) {
              assert.ok(err2 == null);
              User.create(
                {name: 'Ray', age: 31, email: 'ray@strongloop'},
                function(err3, createdusers3) {
                  assert.ok(err3 == null);

                  User.updateAll(
                    {name: 'Ray'},
                    {$inc: {age: 2}},
                    function(err, updatedusers) {
                      assert.ok(err == null);
                      assert.strictEqual(updatedusers['count'], 1);

                      User.find({where: {name: 'Ray'}}, function(
                        err,
                        foundusers,
                      ) {
                        assert.ok(err == null);
                        assert.strictEqual(foundusers.length, 1);
                        assert.strictEqual(foundusers[0].age, 33);

                        resolve();
                      });
                    },
                  );
                },
              );
            },
          );
        });
      }));

      it('should be possible to use the $min and $max operators', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.create(
          {name: 'Simon', age: 32, email: 'simon@strongloop'},
          function(err2, createdusers2) {
            assert.ok(err2 == null);

            User.updateAll({name: 'Simon'}, {$max: {age: 33}}, function(
              err,
              updatedusers,
            ) {
              assert.ok(err == null);
              assert.strictEqual(updatedusers['count'], 1);

              User.updateAll({name: 'Simon'}, {$min: {age: 31}}, function(
                err,
                updatedusers,
              ) {
                assert.ok(err == null);
                assert.strictEqual(updatedusers['count'], 1);

                User.find({where: {name: {$eq: 'Simon'}}}, function(
                  err,
                  foundusers,
                ) {
                  assert.ok(err == null);
                  assert.strictEqual(foundusers.length, 1);
                  assert.strictEqual(foundusers[0].age, 31);

                  resolve();
                });
              });
            });
          },
        );
      }));

      it('should be possible to use the $mul operator', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);

          User.updateAll({name: 'Al'}, {$mul: {age: 2}}, function(
            err,
            updatedusers,
          ) {
            assert.ok(err == null);
            assert.strictEqual(updatedusers['count'], 1);

            User.find({where: {name: 'Al'}}, function(err, foundusers) {
              assert.ok(err == null);
              assert.strictEqual(foundusers.length, 1);
              assert.strictEqual(foundusers[0].age, 62);

              resolve();
            });
          });
        });
      }));

      it('should be possible to use the $rename operator', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);

          User.updateAll(
            {name: 'Al'},
            {$rename: {name: 'firstname'}},
            function(err, updatedusers) {
              assert.ok(err == null);
              assert.strictEqual(updatedusers['count'], 1);

              User.find({where: {firstname: 'Al'}}, function(
                err,
                foundusers,
              ) {
                assert.ok(err == null);
                assert.strictEqual(foundusers.length, 1);

                resolve();
              });
            },
          );
        });
      }));
      it('should be possible to use the $unset operator', () => new Promise((resolve, reject) => {
        User.dataSource.settings.allowExtendedOperators = true;
        User.create({name: 'Al', age: 31, email: 'al@strongloop'}, function(
          err1,
          createdusers1,
        ) {
          assert.ok(err1 == null);

          User.updateAll({name: 'Al'}, {$unset: {email: ''}}, function(
            err,
            updatedusers,
          ) {
            assert.ok(err == null);
            assert.strictEqual(updatedusers['count'], 1);

            User.find({where: {name: 'Al'}}, function(err, foundusers) {
              assert.ok(err == null);
              assert.strictEqual(foundusers.length, 1);
              assert.ok(foundusers[0].email == null);

              resolve();
            });
          });
        });
      }));
    });

    it('should allow extended operators in update data for strict models', function() {
      const noteModel = db.define('noteModel', {
        title: String,
        description: String,
      }, {strict: true});
      noteModel.settings.mongodb = {allowExtendedOperators: true};
      let noteId;

      return noteModel.create({title: 'note1', description: 'grocery list'})
        .then(function(createdInstance) {
          noteId = createdInstance.id;
          return noteModel.updateAll({id: noteId}, {$set: {description: 'updated list', title: 'setTitle'}});
        })
        .then(function() {
          return noteModel.findById(noteId);
        })
        .then(function(foundNote) {
          assert.strictEqual(foundNote.title, 'setTitle');
          assert.strictEqual(foundNote.description, 'updated list');
        });
    });
  });

  it('findOrCreate should properly support field projection (on create) - object', function() {
    const query = {where: {title: 'Kopria post'}, fields: {comments: 1}};
    const newData = {title: 'Kopria post', content: 'Xazo content', comments: ['comment1', 'comment2']};
    return Post.findOrCreate(query, newData)
      .then(function(result) {
        const createdPost = result[0];
        const created = result[1];
        assert.strictEqual(created, true);
        assert.ok(createdPost.title == null);
        assert.ok(createdPost.content == null);
        __CONTAIN_FN__(createdPost.comments, ['comment1', 'comment2']);
      });
  });

  it('findOrCreate should properly support field projection (on create) - array', function() {
    const query = {where: {title: 'Kopria post'}, fields: ['comments']};
    const newData = {title: 'Kopria post', content: 'Xazo content', comments: ['comment1', 'comment2']};
    return Post.findOrCreate(query, newData)
      .then(function(result) {
        const createdPost = result[0];
        const created = result[1];
        assert.strictEqual(created, true);
        assert.ok(createdPost.title == null);
        assert.ok(createdPost.content == null);
        __CONTAIN_FN__(createdPost.comments, ['comment1', 'comment2']);
      });
  });

  it('findOrCreate should properly support field projection (on find) - object', function() {
    const query = {where: {title: 'Kopria post'}, fields: {comments: 1}};
    const postData = {title: 'Kopria post', content: 'Xazo content', comments: ['comment1', 'comment2']};
    return Post.create(postData)
      .then(function() { // post created
        return Post.findOrCreate(query, postData);
      })
      .then(function(result) {
        const foundPost = result[0];
        const created = result[1];
        assert.strictEqual(created, false);
        assert.ok(foundPost.title == null);
        assert.ok(foundPost.content == null);
        __CONTAIN_FN__(foundPost.comments, ['comment1', 'comment2']);
      });
  });

  it('findOrCreate should properly support field projection (on find) - array', function() {
    const query = {where: {title: 'Kopria post'}, fields: ['comments']};
    const postData = {title: 'Kopria post', content: 'Xazo content', comments: ['comment1', 'comment2']};
    return Post.create(postData)
      .then(function() { // post created
        return Post.findOrCreate(query, postData);
      })
      .then(function(result) {
        const foundPost = result[0];
        const created = result[1];
        assert.strictEqual(created, false);
        assert.ok(foundPost.title == null);
        assert.ok(foundPost.content == null);
        __CONTAIN_FN__(foundPost.comments, ['comment1', 'comment2']);
      });
  });

  it('updateOrCreate should update the instance', () => new Promise((resolve, reject) => {
    Post.create({title: 'a', content: 'AAA'}, function(err, post) {
      post.title = 'b';
      Post.updateOrCreate(post, function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.content, post.content);
        assert.ok(p._id == null);

        Post.findById(post.id, function(err, p) {
          assert.deepStrictEqual(p.id, post.id);
          assert.ok(p._id == null);
          assert.strictEqual(p.content, post.content);
          assert.strictEqual(p.title, 'b');

          resolve();
        });
      });
    });
  }));

  it('updateAttributes should update the instance', () => new Promise((resolve, reject) => {
    Post.create({title: 'a', content: 'AAA'}, function(err, post) {
      post.updateAttributes({title: 'b'}, function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.title, 'b');

        Post.findById(post.id, function(err, p) {
          assert.deepStrictEqual(p.id, post.id);
          assert.strictEqual(p.title, 'b');

          resolve();
        });
      });
    });
  }));

  it('updateAttributes should not throw an error when no attributes are given', () => new Promise((resolve, reject) => {
    Post.create({title: 'a', content: 'AAA'}, function(err, post) {
      post.updateAttributes({}, function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.title, 'a');

        resolve();
      });
    });
  }));

  it("updateAttributes: $addToSet should append item to an Array if it doesn't already exist",
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [{'2014-11-11': 90}]},
        function(err, product) {
          const newattributes = {
            $set: {description: 'goes well with butter'},
            $addToSet: {pricehistory: {'2014-12-12': 110}},
          };
          product.updateAttributes(newattributes, function(err1, inst) {
            assert.ok(err1 == null);

            Product.findById(product.id, function(err2, updatedproduct) {
              assert.ok(err2 == null);
              assert.ok(updatedproduct._id == null);
              assert.deepStrictEqual(updatedproduct.id, product.id);
              assert.strictEqual(updatedproduct.name, product.name);
              assert.strictEqual(updatedproduct.description, 'goes well with butter');
              assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
              assert.strictEqual(updatedproduct.pricehistory[1]['2014-12-12'], 110);
              resolve();
            });
          });
        },
      );
    }));

  it("updateOrCreate: $addToSet should append item to an Array if it doesn't already exist",
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [{'2014-11-11': 90}]},
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$addToSet = {pricehistory: {'2014-12-12': 110}};

          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
            assert.strictEqual(updatedproduct.pricehistory[1]['2014-12-12'], 110);
            resolve();
          });
        },
      );
    }));

  it('updateOrCreate: $addToSet should not append item to an Array if it does already exist',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {
          name: 'bread',
          price: 100,
          pricehistory: [{'2014-11-11': 90}, {'2014-10-10': 80}],
        },
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$addToSet = {pricehistory: {'2014-10-10': 80}};

          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
            assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
            resolve();
          });
        },
      );
    }));

  it('updateAttributes: $addToSet should not append item to an Array if it does already exist',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {
          name: 'bread',
          price: 100,
          pricehistory: [{'2014-11-11': 90}, {'2014-10-10': 80}],
        },
        function(err, product) {
          const newattributes = {
            $set: {description: 'goes well with butter'},
            $addToSet: {pricehistory: {'2014-12-12': 110}},
          };
          product.updateAttributes(newattributes, function(err1, inst) {
            assert.ok(err1 == null);

            Product.findById(product.id, function(err2, updatedproduct) {
              assert.ok(err2 == null);
              assert.ok(updatedproduct._id == null);
              assert.deepStrictEqual(updatedproduct.id, product.id);
              assert.strictEqual(updatedproduct.name, product.name);
              assert.strictEqual(updatedproduct.description, 'goes well with butter');
              assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
              assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
              resolve();
            });
          });
        },
      );
    }));

  it('updateAttributes: $pop should remove first or last item from an Array', () => new Promise((resolve, reject) => {
    Product.dataSource.settings.allowExtendedOperators = true;
    Product.create(
      {
        name: 'bread',
        price: 100,
        pricehistory: [
          {'2014-11-11': 90},
          {'2014-10-10': 80},
          {'2014-09-09': 70},
        ],
      },
      function(err, product) {
        const newattributes = {
          $set: {description: 'goes well with butter'},
          $addToSet: {pricehistory: 1},
        };
        product.updateAttributes(newattributes, function(err1, inst) {
          assert.ok(err1 == null);

          Product.findById(product.id, function(err2, updatedproduct) {
            assert.ok(err2 == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
            assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
            resolve();
          });
        });
      },
    );
  }));

  it('updateOrCreate: $pop should remove first or last item from an Array', () => new Promise((resolve, reject) => {
    Product.dataSource.settings.allowExtendedOperators = true;
    Product.create(
      {
        name: 'bread',
        price: 100,
        pricehistory: [
          {'2014-11-11': 90},
          {'2014-10-10': 80},
          {'2014-09-09': 70},
        ],
      },
      function(err, product) {
        product.$set = {description: 'goes well with butter'};
        product.$pop = {pricehistory: 1};

        Product.updateOrCreate(product, function(err, updatedproduct) {
          assert.ok(err == null);
          assert.ok(updatedproduct._id == null);
          assert.deepStrictEqual(updatedproduct.id, product.id);
          assert.strictEqual(updatedproduct.name, product.name);
          assert.strictEqual(updatedproduct.description, 'goes well with butter');
          assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
          assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);

          updatedproduct.$pop = {pricehistory: -1};
          Product.updateOrCreate(product, function(err, p) {
            assert.ok(err == null);
            assert.ok(p._id == null);
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-10-10'], 80);
            resolve();
          });
        });
      },
    );
  }));

  it('updateAttributes: $pull should remove items from an Array if they match a criteria',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [70, 80, 90, 100]},
        function(err, product) {
          const newattributes = {
            $set: {description: 'goes well with butter'},
            $pull: {pricehistory: {$gte: 90}},
          };
          product.updateAttributes(newattributes, function(err1, updatedproduct) {
            assert.ok(err1 == null);
            Product.findById(product.id, function(err2, updatedproduct) {
              assert.ok(err1 == null);
              assert.ok(updatedproduct._id == null);
              assert.deepStrictEqual(updatedproduct.id, product.id);
              assert.strictEqual(updatedproduct.name, product.name);
              assert.strictEqual(updatedproduct.description, 'goes well with butter');
              assert.strictEqual(updatedproduct.pricehistory[0], 70);
              assert.strictEqual(updatedproduct.pricehistory[1], 80);

              resolve();
            });
          });
        },
      );
    }));

  it('updateOrCreate: $pull should remove items from an Array if they match a criteria',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [70, 80, 90, 100]},
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$pull = {pricehistory: {$gte: 90}};

          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0], 70);
            assert.strictEqual(updatedproduct.pricehistory[1], 80);

            resolve();
          });
        },
      );
    }));

  it('updateAttributes: $pullAll should remove items from an Array if they match a value from a list',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [70, 80, 90, 100]},
        function(err, product) {
          const newattributes = {
            $set: {description: 'goes well with butter'},
            $pullAll: {pricehistory: [80, 100]},
          };
          product.updateAttributes(newattributes, function(err1, inst) {
            assert.ok(err1 == null);

            Product.findById(product.id, function(err2, updatedproduct) {
              assert.ok(err2 == null);
              assert.ok(updatedproduct._id == null);
              assert.deepStrictEqual(updatedproduct.id, product.id);
              assert.strictEqual(updatedproduct.name, product.name);
              assert.strictEqual(updatedproduct.description, 'goes well with butter');
              assert.strictEqual(updatedproduct.pricehistory[0], 70);
              assert.strictEqual(updatedproduct.pricehistory[1], 90);

              resolve();
            });
          });
        },
      );
    }));

  it('updateOrCreate: $pullAll should remove items from an Array if they match a value from a list',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {name: 'bread', price: 100, pricehistory: [70, 80, 90, 100]},
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$pullAll = {pricehistory: [80, 100]};

          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0], 70);
            assert.strictEqual(updatedproduct.pricehistory[1], 90);

            resolve();
          });
        },
      );
    }));

  it('updateAttributes: $push should append item to an Array even if it does already exist',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {
          name: 'bread',
          price: 100,
          pricehistory: [{'2014-11-11': 90}, {'2014-10-10': 80}],
        },
        function(err, product) {
          const newattributes = {
            $set: {description: 'goes well with butter'},
            $push: {pricehistory: {'2014-10-10': 80}},
          };

          product.updateAttributes(newattributes, function(err1, inst) {
            assert.ok(err1 == null);

            Product.findById(product.id, function(err2, updatedproduct) {
              assert.ok(err2 == null);
              assert.ok(updatedproduct._id == null);
              assert.deepStrictEqual(updatedproduct.id, product.id);
              assert.strictEqual(updatedproduct.name, product.name);
              assert.strictEqual(updatedproduct.description, 'goes well with butter');
              assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
              assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
              assert.strictEqual(updatedproduct.pricehistory[2]['2014-10-10'], 80);

              resolve();
            });
          });
        },
      );
    }));

  it('updateOrCreate: $push should append item to an Array even if it does already exist',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {
          name: 'bread',
          price: 100,
          pricehistory: [{'2014-11-11': 90}, {'2014-10-10': 80}],
        },
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$push = {pricehistory: {'2014-10-10': 80}};

          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
            assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
            assert.strictEqual(updatedproduct.pricehistory[2]['2014-10-10'], 80);
            resolve();
          });
        },
      );
    }));

  describe('replaceById', function() {
    it('should replace the object with given data', () => new Promise((resolve, reject) => {
      Product.create({name: 'beer', price: 150}, function(err, product) {
        if (err) return reject(err);
        replaceById(product.id, {name: 'milk'});
      });

      function replaceById(id, data) {
        Product.replaceById(id, data, function(err, updatedProduct) {
          if (err) return reject(err);
          assert.ok(updatedProduct._id == null);
          assert.strictEqual(updatedProduct.name, 'milk');
          assert.ok(updatedProduct.id != null);
          verify(id);
        });
      }

      function verify(id) {
        Product.findById(id, function(err, data) {
          assert.strictEqual(data.name, 'milk');
          assert.ok(data.price == null);
          if (err) reject(err); else resolve();
        });
      }
    }));
  });

  describe('replaceOrCreate', function() {
    it('should create a model instance even if it already exists', () => new Promise((resolve, reject) => {
      Product.replaceOrCreate({name: 'newFoo'}, function(
        err,
        updatedProduct,
      ) {
        if (err) return reject(err);
        assert.ok(updatedProduct._id == null);
        assert.ok(updatedProduct.id != null);
        verifyData(updatedProduct.id);
      });
      function verifyData(id) {
        Product.findById(id, function(err, data) {
          assert.strictEqual(data.name, 'newFoo');
          if (err) reject(err); else resolve();
        });
      }
    }));

    it('should replace a model instance if the passing key already exists', () => new Promise((resolve, reject) => {
      Product.create({name: 'bread', price: 100}, function(err, product) {
        if (err) return reject(err);
        replaceOrCreate({id: product.id, name: 'milk'});
      });
      function replaceOrCreate(data) {
        Product.replaceOrCreate(data, function(err, updatedProduct) {
          if (err) return reject(err);
          assert.ok(updatedProduct._id == null);
          assert.strictEqual(updatedProduct.name, 'milk');
          assert.ok(updatedProduct.id != null);
          verify(data.id);
        });
      }
      function verify(id) {
        Product.findById(id, function(err, data) {
          assert.strictEqual(data.name, 'milk');
          assert.ok(data.price == null);
          if (err) reject(err); else resolve();
        });
      }
    }));

    it('should remove extraneous properties that are not defined in the model', () => new Promise((resolve, reject) => {
      Product.create({name: 'bread', price: 100, bar: 'baz'}, function(
        err,
        product,
      ) {
        if (err) return reject(err);
        replaceOrCreate({id: product.id, name: 'milk'});
      });
      function replaceOrCreate(data) {
        Product.replaceOrCreate(data, function(err, updatedProduct) {
          if (err) return reject(err);
          assert.ok(updatedProduct.bar == null);
          verify(data.id);
        });
      }
      function verify(id) {
        Product.findById(id, function(err, data) {
          assert.ok(data.bar == null);
          if (err) reject(err); else resolve();
        });
      }
    }));
  });

  describe('replace', function() {
    it('should replace the model instance if the provided key already exists', () => new Promise((resolve, reject) => {
      Product.create({name: 'bread', price: 100}, function(err, product) {
        if (err) return reject(err);
        replace(product, {name: 'milk'}, product.id);
      });
      function replace(product, data, id) {
        product.replaceAttributes(data, function(err, updatedProduct) {
          if (err) return reject(err);
          assert.ok(updatedProduct._id == null);
          assert.strictEqual(updatedProduct.name, 'milk');
          assert.ok(updatedProduct.id != null);
          verify(id);
        });
      }
      function verify(id) {
        Product.findById(id, function(err, data) {
          assert.strictEqual(data.name, 'milk');
          assert.ok(data.price == null);
          if (err) reject(err); else resolve();
        });
      }
    }));

    it('should remove extraneous properties that are not defined in the model', () => new Promise((resolve, reject) => {
      Product.create({name: 'bread', price: 100, bar: 'baz'}, function(
        err,
        product,
      ) {
        if (err) return reject(err);
        replace(product, {name: 'milk'}, product.id);
      });
      function replace(product, data, id) {
        product.replaceAttributes(data, function(err, updatedProduct) {
          if (err) return reject(err);
          assert.ok(updatedProduct.bar == null);
          verify(id);
        });
      }
      function verify(id) {
        Product.findById(id, function(err, data) {
          assert.strictEqual(data.name, 'milk');
          assert.ok(data.bar == null);
          if (err) reject(err); else resolve();
        });
      }
    }));
  });

  it('updateOrCreate: should handle combination of operators and top level properties without errors',
    () => new Promise((resolve, reject) => {
      Product.dataSource.settings.allowExtendedOperators = true;
      Product.create(
        {
          name: 'bread',
          price: 100,
          ingredients: ['flour'],
          pricehistory: [{'2014-11-11': 90}, {'2014-10-10': 80}],
        },
        function(err, product) {
          product.$set = {description: 'goes well with butter'};
          product.$push = {ingredients: 'water'};
          product.$addToSet = {pricehistory: {'2014-09-09': 70}};
          product.description = 'alternative description';
          Product.updateOrCreate(product, function(err, updatedproduct) {
            assert.ok(err == null);
            assert.ok(updatedproduct._id == null);
            assert.deepStrictEqual(updatedproduct.id, product.id);
            assert.strictEqual(updatedproduct.name, product.name);
            assert.strictEqual(updatedproduct.description, 'goes well with butter');
            assert.strictEqual(updatedproduct.ingredients[0], 'flour');
            assert.strictEqual(updatedproduct.ingredients[1], 'water');
            assert.strictEqual(updatedproduct.pricehistory[0]['2014-11-11'], 90);
            assert.strictEqual(updatedproduct.pricehistory[1]['2014-10-10'], 80);
            assert.strictEqual(updatedproduct.pricehistory[2]['2014-09-09'], 70);

            resolve();
          });
        },
      );
    }));

  it('updateOrCreate should update the instance without removing existing properties',
    () => new Promise((resolve, reject) => {
      Post.create(
        {title: 'a', content: 'AAA', comments: ['Comment1']},
        function(err, post) {
          post = post.toObject();
          delete post.title;
          delete post.comments;
          Post.updateOrCreate(post, function(err, p) {
            assert.ok(err == null);
            assert.strictEqual(p.id, post.id);
            assert.strictEqual(p.content, post.content);
            assert.ok(p._id == null);

            Post.findById(post.id, function(err, p) {
              assert.deepStrictEqual(p.id, post.id);
              assert.ok(p._id == null);
              assert.strictEqual(p.content, post.content);
              assert.strictEqual(p.title, 'a');
              assert.strictEqual(p.comments[0], 'Comment1');

              resolve();
            });
          });
        },
      );
    }));

  it('updateOrCreate should create a new instance if it does not exist', () => new Promise((resolve, reject) => {
    const post = {id: '123', title: 'a', content: 'AAA'};
    Post.updateOrCreate(post, function(err, p) {
      assert.ok(err == null);
      assert.strictEqual(p.title, post.title);
      assert.strictEqual(p.content, post.content);
      assert.deepStrictEqual(p.id, post.id);

      Post.findById(p.id, function(err, p) {
        assert.strictEqual(p.id, post.id);
        assert.ok(p._id == null);
        assert.strictEqual(p.content, post.content);
        assert.strictEqual(p.title, post.title);
        assert.strictEqual(p.id, post.id);

        resolve();
      });
    });
  }));

  it('save should update the instance with the same id', () => new Promise((resolve, reject) => {
    Post.create({title: 'a', content: 'AAA'}, function(err, post) {
      post.title = 'b';
      post.save(function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.content, post.content);
        assert.ok(p._id == null);

        Post.findById(post.id, function(err, p) {
          assert.deepStrictEqual(p.id, post.id);
          assert.ok(p._id == null);
          assert.strictEqual(p.content, post.content);
          assert.strictEqual(p.title, 'b');

          resolve();
        });
      });
    });
  }));

  it('save should update the instance without removing existing properties', () => new Promise((resolve, reject) => {
    Post.create({title: 'a', content: 'AAA'}, function(err, post) {
      delete post.title;
      post.save(function(err, p) {
        assert.ok(err == null);
        assert.strictEqual(p.id, post.id);
        assert.strictEqual(p.content, post.content);
        assert.ok(p._id == null);

        Post.findById(post.id, function(err, p) {
          assert.deepStrictEqual(p.id, post.id);
          assert.ok(p._id == null);
          assert.strictEqual(p.content, post.content);
          assert.strictEqual(p.title, 'a');

          resolve();
        });
      });
    });
  }));

  it('save should create a new instance if it does not exist', () => new Promise((resolve, reject) => {
    const post = new Post({id: '123', title: 'a', content: 'AAA'});
    post.save(post, function(err, p) {
      assert.ok(err == null);
      assert.strictEqual(p.title, post.title);
      assert.strictEqual(p.content, post.content);
      assert.strictEqual(p.id, post.id);

      Post.findById(p.id, function(err, p) {
        assert.strictEqual(p.id, post.id);
        assert.ok(p._id == null);
        assert.strictEqual(p.content, post.content);
        assert.strictEqual(p.title, post.title);
        assert.strictEqual(p.id, post.id);

        resolve();
      });
    });
  }));
  it('all should return object with an id, which is instanceof ObjectID, but not mongodb _id',
    () => new Promise((resolve, reject) => {
      const post = new Post({title: 'a', content: 'AAA'});
      post.save(function(err, post) {
        Post.all({where: {title: 'a'}}, function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.strictEqual(post['title'], 'a');
          assert.strictEqual(post['content'], 'AAA');
          assert.ok(post.id instanceof db.ObjectID);
          assert.ok(post._id == null);

          resolve();
        });
      });
    }));

  it('all return should honor filter.fields', () => new Promise((resolve, reject) => {
    const post = new Post({title: 'b', content: 'BBB'});
    post.save(function(err, post) {
      db.connector.all(
        'Post',
        {fields: ['title'], where: {title: 'b'}},
        {},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.strictEqual(post['title'], 'b');
          assert.ok(post.content == null);
          assert.ok(post._id == null);
          assert.ok(post.id == null);

          resolve();
        },
      );
    });
  }));

  it('should allow to use filters with customized field names', () => new Promise((resolve, reject) => {
    const post = new PostWithStringIdAndRenamedColumns({renamedTitle: 'b', renamedContent: 'BBB'});
    post.save(function(err, post) {
      db.connector.all(
        'PostWithStringIdAndRenamedColumns',
        {fields: ['renamedTitle', 'renamedContent']},
        {},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 1);
          post = posts[0];
          assert.strictEqual(post['renamedTitle'], 'b');
          assert.strictEqual(post['renamedContent'], 'BBB');
          assert.ok(post.content == null);
          assert.ok(post._id == null);
          assert.ok(post.id == null);
          resolve();
        },
      );
    });
  }));

  it('create should convert id from ObjectID to string', () => new Promise((resolve, reject) => {
    const oid = new db.ObjectID();
    const sid = oid.toString();
    PostWithStringId.create({id: oid, title: 'c', content: 'CCC'}, function(
      err,
      post,
    ) {
      PostWithStringId.findById(oid, function(err, post) {
        assert.ok(err == null);
        assert.ok(post._id == null);
        assert.strictEqual(typeof post.id, 'string');
        assert.strictEqual(post.id, sid);

        resolve();
      });
    });
  }));

  it('create should convert id from string to ObjectID', () => new Promise((resolve, reject) => {
    const oid = new db.ObjectID();
    const sid = oid.toString();
    Post.create({id: sid, title: 'c', content: 'CCC'}, function(err, post) {
      assert.ok(post.id instanceof db.ObjectID);
      Post.findById(sid, function(err, post) {
        assert.ok(err == null);
        assert.ok(post._id == null);
        assert.ok(post.id instanceof db.ObjectID);
        assert.deepStrictEqual(post.id, oid);

        resolve();
      });
    });
  }));

  it('create should convert id from string to ObjectID - Array property', () => new Promise((resolve, reject) => {
    Post.create({title: 'c', content: 'CCC'}, function(err, post) {
      Category.create({title: 'a', posts: [String(post.id)]}, function(
        err,
        category,
      ) {
        assert.ok(category.id instanceof db.ObjectID);
        assert.ok(category.posts[0] instanceof db.ObjectID);
        Category.findOne({where: {posts: post.id}}, function(err, c) {
          assert.ok(err == null);
          assert.ok(c.id instanceof db.ObjectID);
          assert.ok(c.posts[0] instanceof db.ObjectID);
          assert.deepStrictEqual(c.id, category.id);

          resolve();
        });
      });
    });
  }));

  it('create should support renamed column names (using property syntax first)',
    () => new Promise((resolve, reject) => {
      const oid = new db.ObjectID().toString();
      PostWithStringId.create({id: oid, title: 'c', content: 'CCC'}, function(
        err,
        post,
      ) {
        PostWithStringIdAndRenamedColumns.findById(oid, function(err, post) {
          assert.ok(err == null);
          assert.ok(post._id == null);
          assert.strictEqual(post.id, oid);

          assert.ok(post.renamedTitle != null);
          assert.ok(post.renamedContent != null);
          assert.strictEqual(post.renamedTitle, 'c');
          assert.strictEqual(post.renamedContent, 'CCC');

          resolve();
        });
      });
    }));

  it('should get rejected if the id property has a custom field name', () => new Promise((resolve, reject) => {
    const oid = new db.ObjectID().toString();
    try {
      WithInvalidCustomIdFieldName.create({id: oid, content: 'should be rejected'}
        , function(
          err,
          post,
        ) {
          assert.ok(err != null);
        });
    } catch (e) {
      assert.ok(String(e.message).includes(
        "custom id field name 'rejected' is not allowed in model WithInvalidCustomIdFieldName",
      ));
    }
    resolve();
  }));

  it('create should support renamed column names (using db syntax first)', () => new Promise((resolve, reject) => {
    const oid = new db.ObjectID().toString();
    PostWithStringIdAndRenamedColumns.create(
      {
        id: oid,
        renamedTitle: 'c',
        renamedContent: 'CCC',
      },
      function(err, post) {
        PostWithStringId.findById(oid, function(err, post) {
          assert.ok(err == null);
          assert.ok(post._id == null);
          assert.strictEqual(post.id, oid);

          assert.ok(post.title != null);
          assert.ok(post.content != null);
          assert.strictEqual(post.title, 'c');
          assert.strictEqual(post.content, 'CCC');

          resolve();
        });
      },
    );
  }));

  describe('geo queries', function() {
    let geoDb, PostWithLocation, createLocationPost;

    before(function() {
      const config = JSON.parse(JSON.stringify(global.config)); // clone config
      config.enableGeoIndexing = true;

      geoDb = global.getDataSource(config);

      PostWithLocation = geoDb.define('PostWithLocation', {
        _id: {type: geoDb.ObjectID, id: true},
        location: {type: GeoPoint, index: true},
      });
      createLocationPost = function(far) {
        let point;
        if (far) {
          point = new GeoPoint({
            lat: 31.230416,
            lng: 121.473701,
          });
        } else {
          point = new GeoPoint({
            lat: 30.27167 + Math.random() * 0.01,
            lng: 120.13469600000008 + Math.random() * 0.01,
          });
        }
        return function(callback) {
          PostWithLocation.create({location: point}, callback);
        };
      };
    });

    beforeEach(() => new Promise((resolve, reject) => {
      PostWithLocation.destroyAll((err) => err ? reject(err) : resolve());
    }));

    it('create should convert geopoint to geojson', () => new Promise((resolve, reject) => {
      const point = new GeoPoint({lat: 1.243, lng: 20.4});

      PostWithLocation.create({location: point}, function(err, post) {
        assert.ok(err == null);
        assert.strictEqual(point.lat, post.location.lat);
        assert.strictEqual(point.lng, post.location.lng);

        resolve();
      });
    }));

    it('updateOrCreate should convert geopoint to geojson', () => new Promise((resolve, reject) => {
      const point = new GeoPoint({lat: 1.243, lng: 20.4});
      const newPoint = new GeoPoint({lat: 1.2431, lng: 20.41});

      PostWithLocation.create({location: point}, function(err, post) {
        assert.ok(err == null);
        assert.strictEqual(point.lat, post.location.lat);
        assert.strictEqual(point.lng, post.location.lng);

        post.location = newPoint;

        PostWithLocation.updateOrCreate(post, function(err, p) {
          assert.ok(err == null);
          assert.strictEqual(p._id, post._id);

          PostWithLocation.findById(post._id, function(err, p2) {
            assert.ok(err == null);
            assert.deepStrictEqual(p2._id, post._id);
            assert.strictEqual(p2.location.lat, newPoint.lat);
            assert.strictEqual(p2.location.lng, newPoint.lng);
            resolve();
          });
        });
      });
    }));

    it('replaceById should convert geopoint to geojson', () => new Promise((resolve, reject) => {
      const point = new GeoPoint({lat: 1.243, lng: 20.4});
      const newPoint = new GeoPoint({lat: 1.2431, lng: 20.41});

      PostWithLocation.create({location: point}, function(err, post) {
        assert.ok(err == null);
        assert.strictEqual(point.lat, post.location.lat);
        assert.strictEqual(point.lng, post.location.lng);

        post.location = newPoint;

        PostWithLocation.replaceById(post._id, post, function(err, p) {
          assert.ok(err == null);
          assert.strictEqual(p._id, post._id);

          PostWithLocation.findById(post._id, function(err, p) {
            assert.ok(err == null);
            assert.deepStrictEqual(p._id, post._id);
            assert.strictEqual(p.location.lat, newPoint.lat);
            assert.strictEqual(p.location.lng, newPoint.lng);
            resolve();
          });
        });
      });
    }));

    it('find should be able to query by location', () => new Promise((resolve, reject) => {
      const coords = {lat: 1.25, lng: 20.2};

      geoDb.autoupdate(function(err) {
        const createPost = function(callback) {
          const point = new GeoPoint({
            lat: Math.random() * 180 - 90,
            lng: Math.random() * 360 - 180,
          });

          PostWithLocation.create({location: point}, callback);
        };

        Promise.all([
          new Promise((res, rej) => (createPost.bind(null))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createPost.bind(null))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createPost.bind(null))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createPost.bind(null))((err) => err ? rej(err) : res())),
        ]).then(() => (function(err) {
          assert.ok(err == null);

          PostWithLocation.find(
            {
              where: {
                location: {
                  near: new GeoPoint(coords),
                },
              },
            },
            function(err, results) {
              assert.ok(err == null);
              assert.ok(results != null);

              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(
                  coords,
                  result.location,
                );
                assert.ok(currentDist >= dist);
                dist = currentDist;
              });

              resolve();
            },
          );
        })(null), (err) => (function(err) {
          assert.ok(err == null);

          PostWithLocation.find(
            {
              where: {
                location: {
                  near: new GeoPoint(coords),
                },
              },
            },
            function(err, results) {
              assert.ok(err == null);
              assert.ok(results != null);

              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(
                  coords,
                  result.location,
                );
                assert.ok(currentDist >= dist);
                dist = currentDist;
              });

              resolve();
            },
          );
        })(err));
      });
    }));

    it('find should be queryable using locations with deep/multiple keys', () => new Promise((resolve, reject) => {
      const coords = {lat: 1.25, lng: 20.2};

      geoDb.autoupdate(function(err) {
        let heroNumber = 0;
        const powers = ['fly', 'lasers', 'strength', 'drink'];

        function createSuperheroWithLocation(callback) {
          heroNumber++;

          Superhero.create(
            {
              name: 'Hero #' + heroNumber,
              power: powers[heroNumber - 1],
              location: {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [coords.lng, coords.lat],
                },
              },
            },
            callback,
          );
        }

        Promise.all([
          new Promise((res, rej) => (createSuperheroWithLocation)((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createSuperheroWithLocation)((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createSuperheroWithLocation)((err) => err ? rej(err) : res())),
        ]).then(() => (function(err) {
          if (err) return reject(err);

          Superhero.find(
            {
              where: {
                and: [
                  {
                    'location.geometry': {
                      near: [coords.lng, coords.lat],
                      maxDistance: 50,
                    },
                  },
                  {
                    power: 'strength',
                  },
                ],
              },
            },
            function(err, results) {
              if (err) return reject(err);

              assert.strictEqual(results.length, 1);

              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(coords, {
                  lng: result.location.geometry.coordinates[0],
                  lat: result.location.geometry.coordinates[1],
                });
                assert.ok(currentDist >= dist);
                dist = currentDist;
              });

              resolve();
            },
          );
        })(null), (err) => (function(err) {
          if (err) return reject(err);

          Superhero.find(
            {
              where: {
                and: [
                  {
                    'location.geometry': {
                      near: [coords.lng, coords.lat],
                      maxDistance: 50,
                    },
                  },
                  {
                    power: 'strength',
                  },
                ],
              },
            },
            function(err, results) {
              if (err) return reject(err);

              assert.strictEqual(results.length, 1);

              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(coords, {
                  lng: result.location.geometry.coordinates[0],
                  lat: result.location.geometry.coordinates[1],
                });
                assert.ok(currentDist >= dist);
                dist = currentDist;
              });

              resolve();
            },
          );
        })(err));
      });
    }));

    it('find should be able to query by location via near with maxDistance', () => new Promise((resolve, reject) => {
      const coords = {lat: 30.274085, lng: 120.15507000000002};

      geoDb.autoupdate(function(err) {
        Promise.all([
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(true))((err) => err ? rej(err) : res())),
        ]).then(() => (function(err) {
          if (err) return reject(err);
          PostWithLocation.find(
            {
              where: {
                location: {
                  near: new GeoPoint(coords),
                  maxDistance: 17000,
                  unit: 'meters',
                },
              },
            },
            function(err, results) {
              if (err) return reject(err);
              assert.strictEqual(results.length, 3);
              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(
                  coords,
                  result.location,
                );
                assert.ok(currentDist >= dist);
                assert.ok(currentDist <= 17);
                dist = currentDist;
              });
              resolve();
            },
          );
        })(null), (err) => (function(err) {
          if (err) return reject(err);
          PostWithLocation.find(
            {
              where: {
                location: {
                  near: new GeoPoint(coords),
                  maxDistance: 17000,
                  unit: 'meters',
                },
              },
            },
            function(err, results) {
              if (err) return reject(err);
              assert.strictEqual(results.length, 3);
              let dist = 0;
              results.forEach(function(result) {
                const currentDist = testUtils.getDistanceBetweenPoints(
                  coords,
                  result.location,
                );
                assert.ok(currentDist >= dist);
                assert.ok(currentDist <= 17);
                dist = currentDist;
              });
              resolve();
            },
          );
        })(err));
      });
    }));

    it('find should be able to query by location via near with minDistance set',
      () => new Promise((resolve, reject) => {
        const coords = {lat: 30.274085, lng: 120.15507000000002};
        geoDb.autoupdate(function(err) {
          Promise.all([
            new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (createLocationPost(true))((err) => err ? rej(err) : res())),
          ]).then(() => (function(err) {
            if (err) return reject(err);
            PostWithLocation.find(
              {
                where: {
                  location: {
                    near: new GeoPoint(coords),
                    minDistance: 17000,
                    unit: 'meters',
                  },
                },
              },
              function(err, results) {
                if (err) return reject(err);
                assert.strictEqual(results.length, 1);
                let dist = 0;
                results.forEach(function(result) {
                  const currentDist = testUtils.getDistanceBetweenPoints(
                    coords,
                    result.location,
                  );
                  assert.ok(currentDist >= dist);
                  dist = currentDist;
                });
                resolve();
              },
            );
          })(null), (err) => (function(err) {
            if (err) return reject(err);
            PostWithLocation.find(
              {
                where: {
                  location: {
                    near: new GeoPoint(coords),
                    minDistance: 17000,
                    unit: 'meters',
                  },
                },
              },
              function(err, results) {
                if (err) return reject(err);
                assert.strictEqual(results.length, 1);
                let dist = 0;
                results.forEach(function(result) {
                  const currentDist = testUtils.getDistanceBetweenPoints(
                    coords,
                    result.location,
                  );
                  assert.ok(currentDist >= dist);
                  dist = currentDist;
                });
                resolve();
              },
            );
          })(err));
        });
      }));

    it('find should be able to set unit when query location via near', () => new Promise((resolve, reject) => {
      const coords = {lat: 30.274085, lng: 120.15507000000002};

      geoDb.autoupdate(function(err) {
        const queryLocation = function(
          distance,
          unit,
          distanceInMeter,
          numOfResult,
        ) {
          return function(callback) {
            PostWithLocation.find(
              {
                where: {
                  location: {
                    near: new GeoPoint(coords),
                    maxDistance: distance,
                    unit: unit,
                  },
                },
              },
              function(err, results) {
                if (err) return reject(err);
                assert.strictEqual(results.length, numOfResult);
                results.forEach(function(result) {
                  const currentDist = testUtils.getDistanceBetweenPoints(
                    coords,
                    result.location,
                  );
                  assert.ok(currentDist <= distanceInMeter / 1000);
                });
                callback();
              },
            );
          };
        };

        Promise.all([
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(false))((err) => err ? rej(err) : res())),
          new Promise((res, rej) => (createLocationPost(true))((err) => err ? rej(err) : res())),
        ]).then(
          () => Promise.all([
            new Promise((res, rej) => (queryLocation(10000, undefined, 10000, 3))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (queryLocation(10, 'miles', 16000, 3))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (queryLocation(10, 'kilometers', 10000, 3))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (queryLocation(20000, 'feet', 6096, 3))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (queryLocation(10000, 'radians', 10000, 3))((err) => err ? rej(err) : res())),
            new Promise((res, rej) => (queryLocation(10000, 'degrees', 10000, 3))((err) => err ? rej(err) : res())),
          ]).then(() => resolve(), reject),
          reject,
        );
      });
    }));

    afterEach(() => new Promise((resolve, reject) => {
      PostWithLocation.destroyAll((err) => err ? reject(err) : resolve());
    }));
  });

  it('find should order by id if the order is not set for the query filter', () => new Promise((resolve, reject) => {
    PostWithStringId.create({id: '2', title: 'c', content: 'CCC'}, function(
      err,
      post,
    ) {
      PostWithStringId.create({id: '1', title: 'd', content: 'DDD'}, function(
        err,
        post,
      ) {
        PostWithStringId.find(function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts.length, 2);
          assert.strictEqual(posts[0].id, '1');

          PostWithStringId.find({limit: 1, offset: 0}, function(err, posts) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 1);
            assert.strictEqual(posts[0].id, '1');

            PostWithStringId.find({limit: 1, offset: 1}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].id, '2');
              resolve();
            });
          });
        });
      });
    });
  }));

  it('find should not order by id if the order is not set for the query filter and settings.disableDefaultSort is true',
    () => new Promise((resolve, reject) => {
      PostWithDisableDefaultSort.create({id: '2', title: 'c', content: 'CCC'}, function(err, post) {
        PostWithDisableDefaultSort.create({id: '1', title: 'd', content: 'DDD'}, function(err, post) {
          PostWithDisableDefaultSort.find({}, function(err, posts) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 2);
            assert.strictEqual(posts[0].id, '2');

            PostWithDisableDefaultSort.find({limit: 1, offset: 0}, function(err, posts) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].id, '2');

              PostWithDisableDefaultSort.find({limit: 1, offset: 1}, function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].id, '1');
                resolve();
              });
            });
          });
        });
      });
    }));

  it('should report error on duplicate keys', () => new Promise((resolve, reject) => {
    Post.create({title: 'd', content: 'DDD'}, function(err, post) {
      Post.create({id: post.id, title: 'd', content: 'DDD'}, function(
        err,
        post,
      ) {
        assert.ok(err != null);
        resolve();
      });
    });
  }));

  it('should allow to find using case insensitive index', () => new Promise((resolve, reject) => {
    Category.create({title: 'My Category'}, function(err, category1) {
      if (err) return reject(err);
      Category.create({title: 'MY CATEGORY'}, function(err, category2) {
        if (err) return reject(err);

        Category.find({where: {title: 'my cATEGory'}}, {collation: {locale: 'en', strength: 1}},
          function(err, categories) {
            if (err) return reject(err);
            assert.strictEqual(categories.length, 2);
            resolve();
          });
      });
    });
  }));

  it('should allow to find using like', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {like: 'M.+st'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 1);
        resolve();
      });
    });
  }));

  it('should allow to find using case insensitive like', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {like: 'm.+st', options: 'i'}}}, function(
        err,
        posts,
      ) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 1);
        resolve();
      });
    });
  }));

  it('should allow to find using like with renamed columns', () => new Promise((resolve, reject) => {
    PostWithStringId.create({title: 'My Post', content: 'Hello'}, function(
      err,
      post,
    ) {
      PostWithStringIdAndRenamedColumns.find(
        {where: {renamedTitle: {like: 'M.+st'}}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 1);
          resolve();
        },
      );
    });
  }));

  it('should allow to find using like with renamed columns (inverse create order)',
    () => new Promise((resolve, reject) => {
      PostWithStringIdAndRenamedColumns.create(
        {renamedTitle: 'My Post', renamedContent: 'Hello'},
        function(err, post) {
          PostWithStringId.find({where: {title: {like: 'M.+st'}}}, function(
            err,
            posts,
          ) {
            assert.ok(err == null);
            assert.strictEqual(posts['length'], 1);
            resolve();
          });
        },
      );
    }));

  it('should allow to find using case insensitive like - test 2', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {content: {like: 'HELLO', options: 'i'}}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 1);
          resolve();
        },
      );
    });
  }));

  it('should support like for no match', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {like: 'M.+XY'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 0);
        resolve();
      });
    });
  }));

  it('should allow to find using nlike', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {nlike: 'M.+st'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 0);
        resolve();
      });
    });
  }));

  it('should allow to find using case insensitive nlike', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {title: {nlike: 'm.+st', options: 'i'}}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 0);
          resolve();
        },
      );
    });
  }));

  it('should support nlike for no match', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {nlike: 'M.+XY'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 1);
        resolve();
      });
    });
  }));

  it('should support "and" operator that is satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {and: [{title: 'My Post'}, {content: 'Hello'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 1);
          resolve();
        },
      );
    });
  }));

  it('should support "and" operator that is not satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {and: [{title: 'My Post'}, {content: 'Hello1'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 0);
          resolve();
        },
      );
    });
  }));

  it('should support "or" that is satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {or: [{title: 'My Post'}, {content: 'Hello1'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 1);
          resolve();
        },
      );
    });
  }));

  it('should support "or" operator that is not satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {or: [{title: 'My Post1'}, {content: 'Hello1'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 0);
          resolve();
        },
      );
    });
  }));

  it('should support "nor" operator that is satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {nor: [{title: 'My Post1'}, {content: 'Hello1'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 1);
          resolve();
        },
      );
    });
  }));

  it('should support "nor" operator that is not satisfied', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find(
        {where: {nor: [{title: 'My Post'}, {content: 'Hello1'}]}},
        function(err, posts) {
          assert.ok(err == null);
          assert.strictEqual(posts['length'], 0);
          resolve();
        },
      );
    });
  }));

  it('should support neq for match', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {neq: 'XY'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 1);
        resolve();
      });
    });
  }));

  it('should support neq for no match', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.find({where: {title: {neq: 'My Post'}}}, function(err, posts) {
        assert.ok(err == null);
        assert.strictEqual(posts['length'], 0);
        resolve();
      });
    });
  }));

  it('should support count without where', () => new Promise((resolve, reject) => {
    const POST_NUMBER = 35;
    const posts = [];
    for (let i = 0; i < POST_NUMBER; i++) {
      posts.push({title: `My post ${i}`, content: `content ${i}`});
    }

    Post.create(posts, function() {
      Post.count(function(err, count) {
        if (err) return reject(err);
        assert.strictEqual(count, POST_NUMBER);
        resolve();
      });
    });
  }));

  // The where object should be parsed by the connector
  it('should support where for count', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      Post.count(
        {and: [{title: 'My Post'}, {content: 'Hello'}]},
        function(err, count) {
          assert.ok(err == null);
          assert.strictEqual(count, 1);
          Post.count(
            {and: [{title: 'My Post1'}, {content: 'Hello'}]},
            function(err, count) {
              assert.ok(err == null);
              assert.strictEqual(count, 0);
              resolve();
            },
          );
        },
      );
    });
  }));

  // The where object should be parsed by the connector
  it('should support where for destroyAll', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post1', content: 'Hello'}, function(err, post) {
      Post.create({title: 'My Post2', content: 'Hello'}, function(err, post) {
        Post.destroyAll(
          {
            and: [{title: 'My Post1'}, {content: 'Hello'}],
          },
          function(err) {
            assert.ok(err == null);
            Post.count(function(err, count) {
              assert.ok(err == null);
              assert.strictEqual(count, 1);
              resolve();
            });
          },
        );
      });
    });
  }));

  it(
    'should support where for count (using renamed columns in deep filter ' +
    'criteria)',
    () => new Promise((resolve, reject) => {
      PostWithStringId.create({title: 'My Post', content: 'Hello'}, function(
        err,
        post,
      ) {
        PostWithStringIdAndRenamedColumns.count(
          {
            and: [
              {
                renamedTitle: 'My Post',
              },
              {renamedContent: 'Hello'},
            ],
          },
          function(err, count) {
            assert.ok(err == null);
            assert.strictEqual(count, 1);
            PostWithStringIdAndRenamedColumns.count(
              {
                and: [
                  {
                    renamedTitle: 'My Post1',
                  },
                  {renamedContent: 'Hello'},
                ],
              },
              function(err, count) {
                assert.ok(err == null);
                assert.strictEqual(count, 0);
                resolve();
              },
            );
          },
        );
      });
    }),
  );

  it('should return info for destroy', () => new Promise((resolve, reject) => {
    Post.create({title: 'My Post', content: 'Hello'}, function(err, post) {
      post.destroy(function(err, info) {
        assert.ok(err == null);
        assert.deepStrictEqual(info, {count: 1});
        resolve();
      });
    });
  }));

  it('should export the MongoDB function', function() {
    const module = require('../');
    assert.ok(module.MongoDB instanceof Function);
  });

  it('should export the ObjectID function', function() {
    const module = require('../');
    assert.ok(module.ObjectID instanceof Function);
  });

  it('should export the generateMongoDBURL function', function() {
    const module = require('../');
    assert.ok(module.generateMongoDBURL instanceof Function);
  });

  describe('Test generateMongoDBURL function', function() {
    const module = require('../');
    describe('should return correct mongodb url ', function() {
      it('when only passing in database', function() {
        const options = {
          database: 'fakeDatabase',
        };
        assert.deepStrictEqual(module.generateMongoDBURL(options), 'mongodb://127.0.0.1:27017/fakeDatabase');
      });
      it('when protocol is mongodb and no username/password', function() {
        const options = {
          protocol: 'mongodb',
          hostname: 'fakeHostname',
          port: 9999,
          database: 'fakeDatabase',
        };
        assert.deepStrictEqual(module.generateMongoDBURL(options), 'mongodb://fakeHostname:9999/fakeDatabase');
      });
      it('when protocol is mongodb and has username/password', function() {
        const options = {
          protocol: 'mongodb',
          hostname: 'fakeHostname',
          port: 9999,
          database: 'fakeDatabase',
          username: 'fakeUsername',
          password: 'fakePassword',
        };
        assert.deepStrictEqual(
          module.generateMongoDBURL(options),
          'mongodb://fakeUsername:fakePassword@fakeHostname:9999/fakeDatabase',
        );
      });
      it('when protocol is mongodb+srv and no username/password', function() {
        const options = {
          protocol: 'mongodb+srv',
          hostname: 'fakeHostname',
          port: 9999,
          database: 'fakeDatabase',
        };
        // mongodb+srv url should not have the port in it
        assert.deepStrictEqual(module.generateMongoDBURL(options), 'mongodb+srv://fakeHostname/fakeDatabase');
      });
      it('when protocol is mongodb+srv and has username/password', function() {
        const options = {
          protocol: 'mongodb+srv',
          hostname: 'fakeHostname',
          port: 9999,
          database: 'fakeDatabase',
          username: 'fakeUsername',
          password: 'fakePassword',
        };
        // mongodb+srv url should not have the port in it
        assert.deepStrictEqual(
          module.generateMongoDBURL(options),
          'mongodb+srv://fakeUsername:fakePassword@fakeHostname/fakeDatabase',
        );
      });
    });
  });

  describe('fieldsArrayToObj', function() {
    const fieldsArrayToObj = require('../').fieldsArrayToObj;
    it('should export the fieldsArrayToObj function', function() {
      assert.ok(fieldsArrayToObj instanceof Function);
    });

    it('should return actual object if provided input is not an array', function() {
      assert.deepStrictEqual(fieldsArrayToObj({someField: 1}), {someField: 1});
    });

    it('should provide the single _id element when input array empty', function() {
      assert.deepStrictEqual(fieldsArrayToObj([]), {_id: 1});
    });

    it('should properly convert the provided array to object', function() {
      assert.deepStrictEqual(fieldsArrayToObj(['prop1', 'prop2']), {prop1: 1, prop2: 1});
    });
  });

  describe('regexp operator', function() {
    before(() => new Promise((resolve, reject) => {
      Post.destroyAll((err) => err ? reject(err) : resolve());
    }));
    beforeEach(() => new Promise((resolve, reject) => {
      Post.create(
        [{title: 'a', content: 'AAA'}, {title: 'b', content: 'BBB'}],
        (err) => err ? reject(err) : resolve(),
      );
    }));
    after(() => new Promise((resolve, reject) => {
      Post.destroyAll((err) => err ? reject(err) : resolve());
    }));

    describe('with regex strings', function() {
      describe('using no flags', function() {
        it('should work', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: '^A'}}}, function(
            err,
            posts,
          ) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 1);
            assert.strictEqual(posts[0].content, 'AAA');
            resolve();
          });
        }));
      });

      describe('using flags', function() {
        let consoleErrorCalls = 0;
        const originalConsoleError = console.error;
        beforeEach(function() {
          consoleErrorCalls = 0;
          console.error = () => { consoleErrorCalls++; };
        });
        afterEach(function() {
          console.error = originalConsoleError;
        });

        it('should work', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: '^a/i'}}}, function(
            err,
            posts,
          ) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 1);
            assert.strictEqual(posts[0].content, 'AAA');
            resolve();
          });
        }));

        it('should print a warning when the global flag is set', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: '^a/g'}}}, function(
            err,
            posts,
          ) {
            assert.strictEqual(consoleErrorCalls, 1);
            resolve();
          });
        }));
      });
    });

    describe('with regex literals', function() {
      describe('using no flags', function() {
        it('should work', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: /^A/}}}, function(
            err,
            posts,
          ) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 1);
            assert.strictEqual(posts[0].content, 'AAA');
            resolve();
          });
        }));
      });

      describe('using flags', function() {
        let consoleErrorCalls = 0;
        const originalConsoleError = console.error;
        beforeEach(function() {
          consoleErrorCalls = 0;
          console.error = () => { consoleErrorCalls++; };
        });
        afterEach(function() {
          console.error = originalConsoleError;
        });

        it('should work', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: /^a/i}}}, function(
            err,
            posts,
          ) {
            assert.ok(err == null);
            assert.strictEqual(posts.length, 1);
            assert.strictEqual(posts[0].content, 'AAA');
            resolve();
          });
        }));

        it('should print a warning when the global flag is set', () => new Promise((resolve, reject) => {
          Post.find({where: {content: {regexp: /^a/g}}}, function(
            err,
            posts,
          ) {
            assert.strictEqual(consoleErrorCalls, 1);
            resolve();
          });
        }));
      });
    });

    describe('with regex object', function() {
      describe('using no flags', function() {
        it('should work', () => new Promise((resolve, reject) => {
          Post.find(
            {where: {content: {regexp: new RegExp(/^A/)}}},
            function(err, posts) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'AAA');
              resolve();
            },
          );
        }));
      });

      describe('using flags', function() {
        let consoleErrorCalls = 0;
        const originalConsoleError = console.error;
        beforeEach(function() {
          consoleErrorCalls = 0;
          console.error = () => { consoleErrorCalls++; };
        });
        afterEach(function() {
          console.error = originalConsoleError;
        });

        it('should work', () => new Promise((resolve, reject) => {
          Post.find(
            {where: {content: {regexp: new RegExp(/^a/i)}}},
            function(err, posts) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'AAA');
              resolve();
            },
          );
        }));

        it('should print a warning when the global flag is set', () => new Promise((resolve, reject) => {
          Post.find(
            {where: {content: {regexp: new RegExp(/^a/g)}}},
            function(err, posts) {
              assert.strictEqual(consoleErrorCalls, 1);
              resolve();
            },
          );
        }));
      });
    });
  });

  describe('like and nlike operator', function() {
    before(() => new Promise((resolve, reject) => {
      Post.destroyAll((err) => err ? reject(err) : resolve());
    }));
    beforeEach(() => new Promise((resolve, reject) => {
      Post.create(
        [{title: 'a', content: 'AAA'}, {title: 'b', content: 'BBB'}],
        (err) => err ? reject(err) : resolve(),
      );
    }));
    after(() => new Promise((resolve, reject) => {
      Post.destroyAll((err) => err ? reject(err) : resolve());
    }));

    describe('like operator', function() {
      describe('with regex strings', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {like: '^A'}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'AAA');
              resolve();
            });
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {like: '^a', options: 'i'}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'AAA');
                resolve();
              },
            );
          }));
        });
      });

      describe('with regex literals', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {like: /^A/}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'AAA');
              resolve();
            });
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {like: /^a/i}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'AAA');
              resolve();
            });
          }));
        });
      });

      describe('with regex object', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {like: new RegExp(/^A/)}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'AAA');
                resolve();
              },
            );
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {like: new RegExp(/^a/i)}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'AAA');
                resolve();
              },
            );
          }));
        });
      });
    });

    describe('nlike operator', function() {
      describe('with regex strings', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {nlike: '^A'}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'BBB');
              resolve();
            });
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {nlike: '^a', options: 'i'}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'BBB');
                resolve();
              },
            );
          }));
        });
      });

      describe('with regex literals', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {nlike: /^A/}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'BBB');
              resolve();
            });
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find({where: {content: {nlike: /^a/i}}}, function(
              err,
              posts,
            ) {
              assert.ok(err == null);
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].content, 'BBB');
              resolve();
            });
          }));
        });
      });

      describe('with regex object', function() {
        describe('using no flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {nlike: new RegExp(/^A/)}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'BBB');
                resolve();
              },
            );
          }));
        });

        describe('using flags', function() {
          it('should work', () => new Promise((resolve, reject) => {
            Post.find(
              {where: {content: {nlike: new RegExp(/^a/i)}}},
              function(err, posts) {
                assert.ok(err == null);
                assert.strictEqual(posts.length, 1);
                assert.strictEqual(posts[0].content, 'BBB');
                resolve();
              },
            );
          }));
        });
      });
    });
  });

  describe('trimLeadingDollarSigns', () =>{
    it('removes an extra leading dollar sign in ths operators', () => {
      const spec = '$eq';
      const updatedSpec = trimLeadingDollarSigns(spec);
      assert.strictEqual(updatedSpec, 'eq');
    });
    it('removes extra leading dollar signs in ths operators', () => {
      const spec = '$$eq';
      const updatedSpec = trimLeadingDollarSigns(spec);
      assert.strictEqual(updatedSpec, 'eq');
    });

    it('remains the same if the input does not contain any dollar signs', () => {
      const spec = 'eq';
      const updatedSpec = trimLeadingDollarSigns(spec);
      assert.strictEqual(updatedSpec, spec);
    });
    it('remains the same if the input does not start with dollar signs', () => {
      const spec = 'eq$';
      const updatedSpec = trimLeadingDollarSigns(spec);
      assert.strictEqual(updatedSpec, spec);
    });
  });
  describe('sanitizeFilter()', () => {
    it('returns filter if not an object', () => {
      const input = false;
      const out = sanitizeFilter(input);
      assert.strictEqual(out, input);
    });

    it('returns the filter if options.disableSanitization is true', () => {
      const input = {key: 'value', $where: 'a value'};
      const out = sanitizeFilter(input, {disableSanitization: true});
      assert.deepStrictEqual(out, input);
    });

    it('removes `$where` property', () => {
      const input = {key: 'value', $where: 'a value'};
      const out = sanitizeFilter(input);
      assert.deepStrictEqual(out, {key: 'value'});
    });

    it('does not remove properties with `$` in it', () => {
      const input = {key: 'value', $where: 'a value', random$key: 'random'};
      const out = sanitizeFilter(input);
      assert.deepStrictEqual(out, {key: 'value', random$key: 'random'});
    });

    it('removes `mapReduce` property in the object', () => {
      const input = {key: 'value', random$key: 'a value', mapReduce: 'map'};
      const out = sanitizeFilter(input);
      assert.deepStrictEqual(out, {key: 'value', random$key: 'a value'});
    });
  });

  after(() => new Promise((resolve, reject) => {
    User.destroyAll(function() {
      Post.destroyAll(function() {
        PostWithObjectId.destroyAll(function() {
          PostWithNumberId.destroyAll(function() {
            PostWithNumberUnderscoreId.destroyAll(() => resolve());
          });
        });
      });
    });
  }));
});
