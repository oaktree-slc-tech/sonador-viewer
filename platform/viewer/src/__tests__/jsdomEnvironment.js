// jsdom test environment that keeps the optional `canvas` package out of jsdom.
//
// jsdom loads `canvas` whenever it can be resolved, and it can be here because other packages in
// the workspace depend on it. Its native binding has no business in a component test and fails to
// load outright on machines without the system libraries it was built against, which takes every
// jsdom suite down with it. Seeding the module cache with an empty export before jsdom is required
// makes jsdom treat canvas as absent.
//
// Use from a test file with:  @jest-environment ./src/__tests__/jsdomEnvironment.js

const Module = require('module');

try {
  const canvasId = require.resolve('canvas');

  if (!require.cache[canvasId]) {
    const stub = new Module(canvasId);
    stub.filename = canvasId;
    stub.loaded = true;
    stub.exports = {};
    require.cache[canvasId] = stub;
  }
} catch (err) {
  // canvas is not installed; nothing to keep out.
}

module.exports = require('jest-environment-jsdom');
