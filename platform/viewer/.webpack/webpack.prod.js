// ~~ WebPack
const webpack = require('webpack');
const path = require('path');
const { merge } = require('webpack-merge');
const webpackCommon = require('./../../../.webpack/webpack.commonjs.js');
// ~~ Plugins
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const fontsToJavaScriptRule = require('../../../.webpack/rules/fontsToJavaScript.js');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');
// ~~ Env Vars
const APP_CONFIG = process.env.APP_CONFIG || 'config/default.js';
const HTML_TEMPLATE = process.env.HTML_TEMPLATE || 'script-tag.html';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';
// Terser workers each hold a whole chunk and its source map; see the minimizer below.
const MINIFY_WORKERS = parseInt(process.env.MINIFY_WORKERS, 10) || 2;

module.exports = (env, argv) => {
  const baseConfig = webpackCommon(env, argv, { SRC_DIR, DIST_DIR });

  const mergedConfig = merge(baseConfig, {
    cache: false,
    entry: {
      app: `${SRC_DIR}/index-umd.js`,
    },
    output: {
      path: DIST_DIR,
      library: 'OHIFViewer',
      libraryTarget: 'umd',
      filename: 'index.umd.js',
      chunkFilename: '[name].js',
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      removeAvailableModules: false,
      removeEmptyChunks: false,
      mergeDuplicateChunks: true,
      sideEffects: true,
      // Webpack's default minimizer runs one Terser worker per core (less one), and each worker
      // holds a whole chunk plus its source map, so peak memory grows with the core count.
      // index.umd.js is ~60% of the emitted JS and always minifies on a single worker, so a
      // second worker finishes the remaining chunks within that time and more add memory, not
      // speed. terserOptions repeat webpack's defaults so the output is unchanged.
      minimizer: [
        new TerserPlugin({
          parallel: MINIFY_WORKERS,
          terserOptions: { compress: { passes: 2 } },
        }),
      ],
    },
    module: {
      rules: [fontsToJavaScriptRule],
    },
    plugins: [
      // Clean output.path
      new CleanWebpackPlugin(),
      new CopyWebpackPlugin({
        patterns: [
          // Copy over and rename our target app config file
          {
            from: `${PUBLIC_DIR}/${APP_CONFIG}`,
            to: `${DIST_DIR}/app-config.js`,
          },
        ],
      }),
      // Generate "index.html" w/ correct includes/imports
      new HtmlWebpackPlugin({
        inject: false,
        template: `${PUBLIC_DIR}/html-templates/${HTML_TEMPLATE}`,
        filename: 'index.html',
        templateParameters: {
          PUBLIC_URL: PUBLIC_URL,
        },
      }),
    ],
  });

  return mergedConfig;
};
