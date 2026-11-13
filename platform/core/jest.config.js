const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  name: pkg.name,
  displayName: pkg.name,
  // This package contains TypeScript sources (services/LocalCacheService et al.). The root babel
  // config already applies @babel/preset-typescript, so jest only needs to transform and resolve
  // the extra extensions.
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  // DICOM-SR tests load the Cornerstone3D adapters from their ESM build; the seg-editor units
  // confirmation (Cornerstone3dMetadataProvider.spacing.test.js) runs the real
  // getPixelSpacingInformation of the pinned @cornerstonejs/core (ESM; its enums import is mocked)
  transformIgnorePatterns: [
    '/node_modules/(?!@cornerstonejs/(dicom-image-loader|adapters)/|@cornerstonejs/core/dist/esm/utilities/(getPixelSpacingInformation|isEqual)\\.js)',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@cornerstonejs/dicom-image-loader/xhrRequest$':
      '<rootDir>/../../node_modules/@cornerstonejs/dicom-image-loader/dist/esm/imageLoader/internal/xhrRequest.js',
    '^@cornerstonejs/dicom-image-loader/loaderOptions$':
      '<rootDir>/../../node_modules/@cornerstonejs/dicom-image-loader/dist/esm/imageLoader/internal/options.js',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/viewer/**/*.test.js"
  // ]
};
