const test = require('node:test');
const assert = require('node:assert/strict');
const { browserWouldShowResults, ORIGIN } = require('../script/probe-search');

test('a normal search response is visible to the page', () => {
  assert.equal(browserWouldShowResults({
    network: false, status: 200, allowOrigin: ORIGIN, usable: 3,
  }), true);
  assert.equal(browserWouldShowResults({
    network: false, status: 200, allowOrigin: '*', usable: 1,
  }), true);
});

test('a response the browser cannot read does not count as a result', () => {
  assert.equal(browserWouldShowResults({ network: true, status: 0, allowOrigin: '', usable: 0 }), false);
  assert.equal(browserWouldShowResults({ network: false, status: 503, allowOrigin: '', usable: 0 }), false);
  assert.equal(browserWouldShowResults({
    network: false, status: 200, allowOrigin: '', usable: 4,
  }), false);
  assert.equal(browserWouldShowResults({
    network: false, status: 200, allowOrigin: ORIGIN, usable: 0,
  }), false);
});
