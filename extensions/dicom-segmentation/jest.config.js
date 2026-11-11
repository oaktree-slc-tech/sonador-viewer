const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  // The SEG parser tests load the Cornerstone3D adapters from their ESM build
  transformIgnorePatterns: ['/node_modules/(?!@cornerstonejs/adapters/)'],
};
