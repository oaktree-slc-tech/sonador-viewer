const path = require('path');
const webpackBase = require('./../../../.webpack/webpack.base.js');
const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');

//TODO maybe we don't need it
const ENTRY = {
  app: `${SRC_DIR}/index.ts`,
};

module.exports = (env, argv) => {
  return webpackBase(env, argv, { SRC_DIR, DIST_DIR, ENTRY });
};
