// Copyright IBM Corp. 2015,2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('node:assert/strict');
const {createDetector} = require('./heap-leak');

describe('leak detector', function() {
  it('should detect a basic leak', function(done) {
    const test = this;
    const detector = createDetector();
    const leaks = [];
    detector.start();
    const interval = setInterval(function() {
      if (test.iterations >= global.ITERATIONS || detector.leaked()) {
        clearInterval(interval);
        assert.ok(detector.leaked(), 'detector should report a leak on sustained heap growth');
        return done();
      }
      test.iterations = (test.iterations || 0) + 1;
      for (let i = 0; i < 100000; i++) {
        leaks.push('leaky string ' + i);
      }
      detector.sample();
    }, 0);
  });
});
