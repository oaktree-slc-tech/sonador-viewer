const { merge } = require('webpack-merge');
const webpackBase = require('./webpack.base.js');
const cssToJavaScriptRule = require('./rules/cssToJavaScript.js');
const stylusToJavaScriptRule = require('./rules/stylusToJavaScript.js');
const scssToCSS = require('./rules/scssToCSS.js');

module.exports = (env, argv, { SRC_DIR, DIST_DIR }) => {
  const baseConfig = webpackBase(env, argv, { SRC_DIR, DIST_DIR });

  return merge(baseConfig, {
    module: {
      rules: [...scssToCSS, cssToJavaScriptRule, stylusToJavaScriptRule],
    },
  });
};
