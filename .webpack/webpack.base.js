const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const dotenv = require('dotenv');

// Rules
const loadShadersRule = require('./rules/loadShaders.js');
const loadWebWorkersRule = require('./rules/loadWebWorkers.js');
const transpileJavaScriptRule = require('./rules/transpileJavaScript.js');

const viewerPackage = require('../platform/viewer/package.json');

dotenv.config();

const NODE_ENV = process.env.NODE_ENV;
const QUICK_BUILD = process.env.QUICK_BUILD;
const BUILD_NUM = process.env.CIRCLE_BUILD_NUM || '0';

const defineValues = {
  /* Application */
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
  'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
  'process.env.DEBUG': JSON.stringify(process.env.DEBUG),
  'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
  'process.env.BUILD_NUM': JSON.stringify(BUILD_NUM),
  'process.env.VERSION_NUMBER': JSON.stringify(viewerPackage.version),
  /* i18n */
  'process.env.USE_LOCIZE': JSON.stringify(process.env.USE_LOCIZE || ''),
  'process.env.LOCIZE_PROJECTID': JSON.stringify(process.env.LOCIZE_PROJECTID || ''),
  'process.env.LOCIZE_API_KEY': JSON.stringify(process.env.LOCIZE_API_KEY || ''),
  'process.env.REACT_APP_I18N_DEBUG': JSON.stringify(process.env.REACT_APP_I18N_DEBUG || ''),
};

module.exports = (env, argv, { SRC_DIR = 'src', DIST_DIR = 'dist' }) => {
  if (!process.env.NODE_ENV) {
    throw new Error('process.env.NODE_ENV not set');
  }

  if (!NODE_ENV) {
    throw new Error('process.env.NODE_ENV not set');
  }

  const isProdBuild = NODE_ENV === 'production';
  const isQuickBuild = QUICK_BUILD === 'true';

  const config = {
    mode: isProdBuild ? 'production' : 'development',
    devtool: isProdBuild ? 'source-map' : 'eval-cheap-module-source-map',
    entry: SRC_DIR,
    output: { clean: true },
    optimization: {
      minimize: isProdBuild,
      sideEffects: false,
    },
    context: path.resolve(__dirname, SRC_DIR),
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
    module: {
      rules: [transpileJavaScriptRule(NODE_ENV), loadWebWorkersRule, loadShadersRule, {
        test: /\.wasm$/,
        type: 'asset/resource',
        generator: {
          filename: 'static/wasm/[name][hash][ext]',
        },
      }],
    },
    resolve: {
      fallback: {
        fs: false,
        path: false,
        zlib: false,
        buffer: require.resolve('buffer'),
        'react/jsx-runtime': 'react/jsx-runtime.js',
        'react/jsx-dev-runtime': 'react/jsx-dev-runtime.js',
      },
      modules: [
        
        // Modules specific to this package
        path.resolve(__dirname, '../node_modules'),
        
        // Hoisted Yarn Workspace Modules
        path.resolve(__dirname, '../../../node_modules'),
        path.resolve(__dirname, '../platform/viewer/node_modules'),
        path.resolve(__dirname, '../platform/ui/node_modules'),
        // TODO check if i18n works, add i18n node_modules if not
        SRC_DIR,
      ],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.*'],
      symlinks: true,
      alias: {
        '@icr/polyseg-wasm/dist/ICRPolySeg.wasm': path.resolve(__dirname, '../node_modules/@icr/polyseg-wasm/dist/ICRPolySeg.wasm'),
        '@cornerstonejs/codec-charls/dist/charlswasm_decode.wasm': path.resolve(__dirname, '../node_modules/@cornerstonejs/codec-charls/dist/charlswasm_decode.wasm'),
        '@cornerstonejs/codec-libjpeg-turbo-8bit/dist/libjpegturbowasm_decode.wasm': path.resolve(__dirname, '../node_modules/@cornerstonejs/codec-libjpeg-turbo-8bit/dist/libjpegturbowasm_decode.wasm'),
        '@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.wasm': path.resolve(__dirname, '../node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.wasm'),
        '@cornerstonejs/codec-openjph/dist/openjphjs.wasm': path.resolve(__dirname, '../node_modules/@cornerstonejs/codec-openjph/dist/openjphjs.wasm'),
      }
    },
    plugins: [
      new webpack.DefinePlugin(defineValues),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
    experiments: { asyncWebAssembly: true }
  };

  if (isQuickBuild) {
    config.optimization.minimize = false;
    config.devtool = false;
  }

  return config;
};
