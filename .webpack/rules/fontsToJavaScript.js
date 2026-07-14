/**
 * For CommonJS, we want to bundle whatever font we've landed on. This allows
 * us to reduce the number of script-tags we need to specify for simple use.
 *
 * PWA will grab these externally to reduce bundle size (think code split),
 * and cache the grab using service-worker.
 */
const fontsToJavaScript = {
  test: /\.(ttf|eot|woff|woff2)$/i,
  type: 'asset/resource',
  generator: {
    filename: 'static/fonts/[name][hash][ext]',
  },
};

module.exports = fontsToJavaScript;
