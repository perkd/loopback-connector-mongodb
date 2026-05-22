// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback-connector-mongodb
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Heap-growth-based leak detector. Replaces the memwatch-next / @airbnb/node-memwatch
// native modules, which no longer build on Node 22+.
//
// Usage: run mocha with `--expose-gc`. Call `start()` before the loop, `sample()`
// each iteration, `leaked()` to query. A sustained upward trend in heap-used
// across consecutive forced GCs is reported as a leak.

const v8 = require('node:v8');

const SAMPLE_WINDOW = 20; // rolling samples used for trend analysis
const MIN_SAMPLES_TO_JUDGE = 10; // need at least this many before claiming a leak
const GROWTH_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB sustained growth = leak

function createDetector() {
  const samples = [];

  function gcAndMeasure() {
    if (typeof global.gc !== 'function') {
      throw new Error('Leak detector requires Node to be started with --expose-gc');
    }
    global.gc();
    return v8.getHeapStatistics().used_heap_size;
  }

  return {
    start() {
      samples.length = 0;
      samples.push(gcAndMeasure());
    },
    sample() {
      samples.push(gcAndMeasure());
      if (samples.length > SAMPLE_WINDOW) samples.shift();
    },
    leaked() {
      if (samples.length < MIN_SAMPLES_TO_JUDGE) return false;
      // Compare median of first half vs median of second half. A leak shows
      // sustained growth, not just a spike.
      const half = Math.floor(samples.length / 2);
      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      const early = median(samples.slice(0, half));
      const late = median(samples.slice(-half));
      return (late - early) > GROWTH_THRESHOLD_BYTES;
    },
    samples() { return [...samples]; },
  };
}

module.exports = {createDetector};
