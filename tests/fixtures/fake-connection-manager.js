// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Minimal in-memory connection manager that mirrors the surface of
// @crm/loopback's ConnectionManager used by the dispatch path:
// `ensureConnection(tenant) -> pool` and `getExistingConnection(tenant) -> pool|undefined`.
//
// Kept as a fixture so this repo has no dependency on @crm/loopback.
// Single-flight creation per tenant matches production (PoolManager.poolCreationLocks).
// Identical shape to loopback/test/fixtures/multitenant/fake-connection-manager.js.

class FakeConnectionManager {
  constructor({connectionFactory}) {
    this._connectionFactory = connectionFactory;
    this._pools = new Map();
    this._locks = new Map();
  }

  getExistingConnection(tenant) {
    return this._pools.get(tenant);
  }

  async ensureConnection(tenant) {
    if (this._pools.has(tenant)) return this._pools.get(tenant);
    if (this._locks.has(tenant)) return this._locks.get(tenant);

    const promise = (async () => {
      const pool = await this._connectionFactory(tenant);
      this._pools.set(tenant, pool);
      this._locks.delete(tenant);
      return pool;
    })();
    this._locks.set(tenant, promise);
    return promise;
  }

  async shutdown() {
    for (const pool of this._pools.values()) {
      if (pool && typeof pool.disconnect === 'function') {
        await pool.disconnect();
      }
    }
    this._pools.clear();
    this._locks.clear();
  }
}

module.exports = {FakeConnectionManager};
