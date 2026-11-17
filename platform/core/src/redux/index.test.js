/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Cornerstone3D packages are ESM builds jest cannot load here; the exports under test do not use them
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, cache: {}, metaData: {}, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });

import redux from './index.js';

describe('redux exports', () => {
  test('have not changed', () => {
    const expectedExports = ['actions', 'reducers', 'localStorage', 'sessionStorage', 'actionTypes', 'middleware', 'selectors'].sort();

    const exports = Object.keys(redux).sort();

    expect(exports).toEqual(expectedExports);
  });
});
