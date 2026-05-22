// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('assert');

let memwatch;

try {
  memwatch = require('@airbnb/node-memwatch');
} catch (e) {
  memwatch = require('memwatch-next');
}
describe('leak detector', function() {
  let leakCount = 0;
  before(function() {
    memwatch.on('leak', () => { leakCount++; });
  });

  it('should detect a basic leak', function(done) {
    const test = this;
    const iterations = 0;
    const leaks = [];
    const interval = setInterval(function() {
      if (test.iterations >= global.ITERATIONS || leakCount > 0) {
        assert.ok(leakCount > 0);
        clearInterval(interval);
        return done();
      }
      test.iterations++;
      for (let i = 0; i < 1000000; i++) {
        const str = 'leaky string';
        leaks.push(str);
      }
    }, 0);
  });
});
