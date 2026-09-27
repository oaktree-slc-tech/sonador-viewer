// jsdom test environment without node-canvas. jsdom loads `canvas` whenever the package resolves,
// and its prebuilt binary fails to load here; the DOM tests need no <canvas> drawing, so the
// package is made unresolvable while jsdom looks for it.
//
// jsdom looks for it lazily, when its first window is created rather than when it is imported,
// which for a Jest environment is the constructor. Jest constructs environments in the worker's
// host process, so the resolver substitution is limited to that construction and restored
// afterwards whether or not it succeeds: anything else loaded in the worker later resolves
// `canvas` as it normally would.
const Module = require('module');
const { TestEnvironment: JSDOMEnvironment } = require('jest-environment-jsdom');

function withCanvasUnresolvable(run) {
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'canvas') {
      const error = new Error("Cannot find module 'canvas'");
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return resolveFilename.call(this, request, ...rest);
  };
  try {
    return run();
  } finally {
    Module._resolveFilename = resolveFilename;
  }
}

class JSDOMEnvironmentWithoutCanvas extends JSDOMEnvironment {
  constructor(...args) {
    withCanvasUnresolvable(() => super(...args));
  }
}

module.exports = JSDOMEnvironmentWithoutCanvas;
