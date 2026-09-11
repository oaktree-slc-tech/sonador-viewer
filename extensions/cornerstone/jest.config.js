const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  name: pkg.name,
  displayName: pkg.name,
  // The SegmentationService is TypeScript; babel's test env carries @babel/preset-typescript, so
  // jest only needs to resolve and transform the extensions. testMatch stays *.test.js -- the
  // upstream SegmentationService.test.ts predates this repo's harness and is not runnable here.
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/viewer/**/*.test.js"
  // ]
};
