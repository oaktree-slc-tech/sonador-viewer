const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  // three's examples (loaders, SkeletonUtils) are published as ES modules
  transformIgnorePatterns: ['/node_modules/(?!three/examples/)'],
};
