// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

require('./init.js');
const {describe, it, before, beforeEach, after, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const ds = global.getDataSource();

describe('mongodb custom id name', function() {
  const Customer = ds.createModel(
    'customer',
    {
      seq: {type: Number, id: true},
      name: String,
      emails: [String],
      age: Number,
    },
    {forceId: false},
  );
  before(() => new Promise((resolve, reject) => {
    Customer.deleteAll(function(err) {
      if (err) return reject(err);
      resolve();
    });
  }));

  it('should allow custom name for the id property for create', () => new Promise((resolve, reject) => {
    Customer.create(
      {
        seq: 1,
        name: 'John1',
        emails: ['john@x.com', 'john@y.com'],
        age: 30,
      },
      function(err, customer) {
        if (err) return reject(err);
        try {
          assert.strictEqual(customer.seq, 1);
        } catch (e) { return reject(e); }
        Customer.create(
          {
            seq: 2,
            name: 'John2',
            emails: ['john2@x.com', 'john2@y.com'],
            age: 40,
          },
          function(err, customer) {
            if (err) return reject(err);
            try {
              assert.strictEqual(customer.seq, 2);
              resolve();
            } catch (e) { reject(e); }
          },
        );
      },
    );
  }));

  it('should allow custom name for the id property for findById', () => new Promise((resolve, reject) => {
    Customer.findById(1, function(err, customer) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customer.seq, 1);
        resolve();
      } catch (e) { reject(e); }
    });
  }));

  it('should allow inq with find', () => new Promise((resolve, reject) => {
    Customer.find({where: {seq: {inq: [1]}}}, function(err, customers) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customers.length, 1);
        assert.strictEqual(customers[0].seq, 1);
        resolve();
      } catch (e) { reject(e); }
    });
  }));
});

describe('mongodb string id', function() {
  const Customer = ds.createModel(
    'customer2',
    {
      seq: {type: String, id: true},
      name: String,
      emails: [String],
      age: Number,
    },
    {forceId: false},
  );
  let customer1, customer2;

  before(() => new Promise((resolve, reject) => {
    Customer.deleteAll(function(err) {
      if (err) return reject(err);
      resolve();
    });
  }));

  it('should allow custom name for the id property for create', () => new Promise((resolve, reject) => {
    Customer.create(
      {
        seq: '1',
        name: 'John1',
        emails: ['john@x.com', 'john@y.com'],
        age: 30,
      },
      function(err, customer) {
        if (err) return reject(err);
        try {
          assert.strictEqual(customer.seq, '1');
        } catch (e) { return reject(e); }
        customer1 = customer;
        const customer2Id = new ds.ObjectID().toString();
        Customer.create(
          {
            seq: customer2Id,
            name: 'John2',
            emails: ['john2@x.com', 'john2@y.com'],
            age: 40,
          },
          function(err, customer) {
            if (err) return reject(err);
            customer2 = customer;
            try {
              assert.deepStrictEqual(customer.seq.toString(), customer2Id);
              resolve();
            } catch (e) { reject(e); }
          },
        );
      },
    );
  }));

  it('should allow custom name for the id property for findById', () => new Promise((resolve, reject) => {
    Customer.findById(1, function(err, customer) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customer.seq, '1');
        resolve();
      } catch (e) { reject(e); }
    });
  }));

  it('should allow inq with find', () => new Promise((resolve, reject) => {
    Customer.find({where: {seq: {inq: [1]}}}, function(err, customers) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customers.length, 1);
        assert.strictEqual(customers[0].seq, '1');
        resolve();
      } catch (e) { reject(e); }
    });
  }));

  it('should allow inq with find - test 2', () => new Promise((resolve, reject) => {
    Customer.find({where: {seq: {inq: [customer2.seq]}}}, function(
      err,
      customers,
    ) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customers.length, 1);
        // seq is now a string
        assert.deepStrictEqual(customers[0].seq, customer2.seq.toString());
        resolve();
      } catch (e) { reject(e); }
    });
  }));
});

describe('mongodb default id type', function() {
  const Account = ds.createModel(
    'account',
    {
      seq: {id: true, generated: true},
      name: String,
      emails: [String],
      age: Number,
    },
    {forceId: false},
  );

  before(() => new Promise((resolve, reject) => {
    Account.deleteAll(function(err) {
      if (err) return reject(err);
      resolve();
    });
  }));

  let id;
  it('should generate id value for create', () => new Promise((resolve, reject) => {
    Account.create(
      {
        name: 'John1',
        emails: ['john@x.com', 'john@y.com'],
        age: 30,
      },
      function(err, account) {
        if (err) return reject(err);
        try {
          assert.ok('seq' in account);
        } catch (e) { return reject(e); }
        id = account.seq;
        Account.findById(id, function(err, account1) {
          if (err) return reject(err);
          try {
            assert.deepStrictEqual(account1.seq, account.seq);
            assert.ok('seq' in account);
            resolve();
          } catch (e) { reject(e); }
        });
      },
    );
  }));

  it('should be able to find by string id', () => new Promise((resolve, reject) => {
    // Try to look up using string
    Account.findById(id.toString(), function(err, account1) {
      if (err) return reject(err);
      try {
        assert.deepStrictEqual(account1.seq, id);
        resolve();
      } catch (e) { reject(e); }
    });
  }));

  it('should be able to delete by string id', () => new Promise((resolve, reject) => {
    // Try to look up using string
    Account.destroyById(id.toString(), function(err, info) {
      if (err) return reject(err);
      try {
        assert.deepStrictEqual(info.count, 1);
        resolve();
      } catch (e) { reject(e); }
    });
  }));
});

describe('mongodb default id name', function() {
  const Customer1 = ds.createModel(
    'customer1',
    {name: String, emails: [String], age: Number},
    {forceId: false},
  );

  before(() => new Promise((resolve, reject) => {
    Customer1.deleteAll(function(err) {
      if (err) return reject(err);
      resolve();
    });
  }));

  it('should allow value for the id property for create', () => new Promise((resolve, reject) => {
    Customer1.create(
      {
        id: 1,
        name: 'John1',
        emails: ['john@x.com', 'john@y.com'],
        age: 30,
      },
      function(err, customer) {
        if (err) return reject(err);
        try {
          assert.strictEqual(customer.id, 1);
          resolve();
        } catch (e) { reject(e); }
      },
    );
  }));

  it('should allow value the id property for findById', () => new Promise((resolve, reject) => {
    Customer1.findById(1, function(err, customer) {
      if (err) return reject(err);
      try {
        assert.strictEqual(customer.id, 1);
        resolve();
      } catch (e) { reject(e); }
    });
  }));

  it('should generate id value for create', () => new Promise((resolve, reject) => {
    Customer1.create(
      {
        name: 'John1',
        emails: ['john@x.com', 'john@y.com'],
        age: 30,
      },
      function(err, customer) {
        if (err) return reject(err);
        try {
          assert.ok('id' in customer);
        } catch (e) { return reject(e); }
        Customer1.findById(customer.id, function(err, customer1) {
          if (err) return reject(err);
          try {
            assert.deepStrictEqual(customer1.id, customer.id);
            resolve();
          } catch (e) { reject(e); }
        });
      },
    );
  }));
});

describe('strictObjectIDCoercion', function() {
  const ObjectID = ds.connector.getDefaultIdType();
  const objectIdLikeString = '7cd2ad46ffc580ba45d3cb1f';

  describe('set to false (default)', function() {
    const User = ds.createModel(
      'user1',
      {
        id: {type: String, id: true},
        name: String,
      },
    );

    beforeEach(() => new Promise((resolve, reject) => {
      User.deleteAll(function(err) {
        if (err) return reject(err);
        resolve();
      });
    }));

    it('should coerce to ObjectID', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
    });

    it('should find model with ObjectID id', async function() {
      const user = await User.create({name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
      const found = await User.findById(user.id);
      assert.strictEqual(found.toObject().name, 'John');
    });

    it('should find model with ObjectID-like id', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
      assert.deepStrictEqual(user.id, ObjectID(objectIdLikeString));
      const found = await User.findById(objectIdLikeString);
      assert.strictEqual(found.toObject().name, 'John');
    });

    it('should find model with string id', async function() {
      const user = await User.create({id: 'a', name: 'John'});
      assert.strictEqual(typeof user.id, 'string');
      assert.strictEqual(user.id, 'a');
      const found = await User.findById('a');
      assert.strictEqual(found.toObject().name, 'John');
    });
  });

  describe('set to true', function() {
    const User = ds.createModel(
      'user2',
      {
        id: {type: String, id: true},
        name: String,
      },
      {strictObjectIDCoercion: true},
    );

    beforeEach(() => new Promise((resolve, reject) => {
      User.deleteAll(function(err) {
        if (err) return reject(err);
        resolve();
      });
    }));

    it('should not coerce to ObjectID', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.strictEqual(user.id, objectIdLikeString);
    });

    it('should not find model with ObjectID id', async function() {
      const user = await User.create({name: 'John'});
      const found = await User.findById(user.id);
      assert.strictEqual(found === null, true);
    });

    it('should find model with ObjectID-like string id', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.ok(!(user.id instanceof ds.ObjectID));
      assert.deepStrictEqual(user.id, objectIdLikeString);
      const found = await User.findById(objectIdLikeString);
      assert.strictEqual(found.toObject().name, 'John');
    });

    it('should find model with string id', async function() {
      const user = await User.create({id: 'a', name: 'John'});
      assert.strictEqual(typeof user.id, 'string');
      assert.strictEqual(user.id, 'a');
      const found = await User.findById('a');
      assert.strictEqual(found.toObject().name, 'John');
    });
  });

  describe('set to true, id type set to ObjectID', function() {
    const User = ds.createModel(
      'user3',
      {
        id: {type: String, id: true, mongodb: {dataType: 'ObjectID'}},
        name: String,
      },
      {strictObjectIDCoercion: true},
    );

    const User1 = ds.createModel(
      'user4',
      {
        id: {type: String, id: true, mongodb: {dataType: 'objectid'}},
        name: String,
      },
      {strictObjectIDCoercion: true},
    );

    beforeEach(() => new Promise((resolve, reject) => {
      User.deleteAll();
      User1.deleteAll(function(err) {
        if (err) return reject(err);
        resolve();
      });
    }));

    it('should coerce to ObjectID', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
    });

    it('should coerce to ObjectID (lowercase)', async function() {
      const user = await User1.create({id: objectIdLikeString, name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
    });

    it('should throw if id is not a ObjectID-like string', async function() {
      await assert.rejects(
        User.create({id: 'abc', name: 'John'}),
        // Explicit mongodb.dataType ObjectID is rejected by juggler first;
        // the connector message remains if that validation is disabled.
        (e) => {
          assert.match(String(e.message), /not an ObjectID string|is not a valid ObjectId/);
          return true;
        },
      );
    });

    it('should find model with ObjectID id', async function() {
      const user = await User.create({name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
      const found = await User.findById(user.id);
      assert.strictEqual(found.toObject().name, 'John');
    });

    // This works by coercing string to ObjectID, overriding `strictObjectIDCoercion: true`
    it('should find model with ObjectID-like id', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      assert.ok(user.id instanceof ds.ObjectID);
      assert.deepStrictEqual(user.id, ObjectID(objectIdLikeString));
      const found = await User.findById(objectIdLikeString);
      assert.strictEqual(found.toObject().name, 'John');
    });

    it('should update model with ObjectID id', async function() {
      const user = await User.create({name: 'John'});
      await User.update({id: user.id, name: 'Jon'});
      const found = await User.findById(user.id);
      assert.strictEqual(found.name, 'Jon');
    });

    it('should update model with ObjectID-like id', async function() {
      const user = await User.create({id: objectIdLikeString, name: 'John'});
      await User.update({id: objectIdLikeString, name: 'Jon'});
      const found = await User.findById(objectIdLikeString);
      assert.strictEqual(found.name, 'Jon');
    });
  });
});
