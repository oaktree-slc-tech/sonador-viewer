const { merge } = require('webpack-merge');
const path = require('path');

const webpackBase = require('../../../.webpack/webpack.base.js');
const pkg = require('../package.json');

const ROOT_DIR = path.join(__dirname, './..');
const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');

//TODO maybe we don't need it
const ENTRY = {
  app: `${SRC_DIR}/index.js`,
};

module.exports = (env, argv) => {
  const commonConfig = webpackBase(env, argv, { SRC_DIR, DIST_DIR, ENTRY });

  return merge(commonConfig, {
    stats: {
      colors: true,
      hash: true,
      timings: true,
      assets: true,
      chunks: false,
      chunkModules: false,
      modules: false,
      children: false,
      warnings: true,
    },
    optimization: {
      minimize: true,
      sideEffects: false,
    },
    output: {
      path: ROOT_DIR,
      library: 'ohifI18n',
      libraryTarget: 'umd',
      filename: pkg.main,
    },
  });
};
