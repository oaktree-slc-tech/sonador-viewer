const path = require('path');
const { merge } = require('webpack-merge');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpackBase = require('./../../../.webpack/webpack.base.js');
// ~~ Plugins
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ExtractCssChunksPlugin = require('extract-css-chunks-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const extractStyleChunksRule = require('../../../.webpack/rules/extractStyleChunks.js');

const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');

const HTML_TEMPLATE = process.env.HTML_TEMPLATE || 'index.html';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';
const APP_CONFIG = process.env.APP_CONFIG || 'config/default.js';
const PROXY_TARGET = process.env.PROXY_TARGET;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const ENTRY_TARGET = process.env.ENTRY_TARGET || `${SRC_DIR}/index.js`;

const setHeaders = (res, path) => {
  res.setHeader('Content-Type', 'text/plain');
  if (path.indexOf('.gz') !== -1) {
    res.setHeader('Content-Encoding', 'gzip');
  } else if (path.indexOf('.br') !== -1) {
    res.setHeader('Content-Encoding', 'br');
  }
};

module.exports = (env, argv) => {
  const baseConfig = webpackBase(env, argv, { SRC_DIR, DIST_DIR });
  const isProdBuild = process.env.NODE_ENV === 'production';
  const hasProxy = PROXY_TARGET && PROXY_DOMAIN;

  const mergedConfig = merge(baseConfig, {
    entry: {
      app: ENTRY_TARGET,
    },
    output: {
      path: DIST_DIR,
      filename: isProdBuild ? '[name].bundle.[chunkhash].js' : '[name].js',
      publicPath: PUBLIC_URL,
      devtoolModuleFilenameTemplate: (info) => {
        if (isProdBuild) {
          return `webpack:///${info.resourcePath}`;
        } else {
          return 'file:///' + encodeURI(info.absoluteResourcePath);
        }
      },
    },
    resolve: {
      alias: {
        'cornerstone-wado-image-loader':
          'cornerstone-wado-image-loader/dist/dynamic-import/cornerstoneWADOImageLoader.min.js',
      },
      modules: [
        // Modules specific to this package
        path.resolve(__dirname, '../node_modules'),
        // Hoisted Yarn Workspace Modules
        path.resolve(__dirname, '../../../node_modules'),
        SRC_DIR,
      ],
    },
    module: {
      rules: [...extractStyleChunksRule(isProdBuild)],
    },
    plugins: [
      new CleanWebpackPlugin(),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: PUBLIC_DIR,
            to: DIST_DIR,
            toType: 'dir',
            globOptions: {
              ignore: ['config/*', 'html-templates/*', '.DS_Store'],
            },
          },
          {
            from: `${PUBLIC_DIR}/config/google.js`,
            to: `${DIST_DIR}/google.js`,
          },
          {
            from: `${PUBLIC_DIR}/${APP_CONFIG}`,
            to: `${DIST_DIR}/app-config.js`,
          },
          {
            from: '../../../node_modules/cornerstone-wado-image-loader/dist/dynamic-import',
            to: DIST_DIR,
          },
        ],
      }),
      new ExtractCssChunksPlugin({
        filename: isProdBuild ? '[name].[hash].css' : '[name].css',
        chunkFilename: isProdBuild ? '[id].[hash].css' : '[id].css',
        ignoreOrder: true,
      }),
      new HtmlWebpackPlugin({
        template: `${PUBLIC_DIR}/html-templates/${HTML_TEMPLATE}`,
        filename: 'index.html',
        templateParameters: {
          PUBLIC_URL: PUBLIC_URL,
        },
      }),
      // Uncomment to generate bundle analyzer
      // new BundleAnalyzerPlugin(),
    ],
    optimization: {
      splitChunks: {
        chunks: 'all',
      },
      minimize: isProdBuild,
      // TODO maybe we don't need it?
      minimizer: [
        new TerserPlugin({
          parallel: true,
          terserOptions: {},
        }),
      ],
      sideEffects: true,
    },
    devServer: {
      hot: true,
      open: true,
      port: 3000,
      host: process.env.OHIF_HOST || 'localhost',
      client: {
        overlay: { errors: true, warnings: false },
      },
      static: [
        {
          directory: path.join(require('os').homedir(), 'dicomweb'),
          staticOptions: {
            extensions: ['gz', 'br'],
            index: 'index.json.gz',
            redirect: true,
            setHeaders,
          },
          publicPath: '/dicomweb',
        },
        {
          directory: '../../testdata',
          staticOptions: {
            extensions: ['gz', 'br'],
            index: 'index.json.gz',
            redirect: true,
            setHeaders,
          },
          publicPath: '/testdata',
        },
      ],
      historyApiFallback: {
        disableDotRule: true,
      },
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  });

  if (hasProxy) {
    mergedConfig.devServer.proxy = mergedConfig.devServer.proxy || {};
    mergedConfig.devServer.proxy[PROXY_TARGET] = PROXY_DOMAIN;
  }
  // TODO maybe we dont' need it?
  if (isProdBuild) {
    mergedConfig.plugins.push(
      new MiniCssExtractPlugin({
        filename: '[name].bundle.css',
        chunkFilename: '[id].css',
      })
    );
  }

  return mergedConfig;
};
