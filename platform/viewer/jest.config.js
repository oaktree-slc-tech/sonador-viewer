const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  name: pkg.name,
  displayName: pkg.name,
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/globalSetup.js'],
  // The viewer now imports TypeScript sources from @ohif/core (UINotificationService et al.).
  // The root babel config already applies @babel/preset-typescript, so jest only needs to
  // transform and resolve the extra extensions. Mirrors platform/core/jest.config.js.
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/viewer/**/*.test.js"
  // ]
};
