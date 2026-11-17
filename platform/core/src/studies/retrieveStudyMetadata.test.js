// The Cornerstone3D packages are ESM builds jest cannot load here; the exports under test do not use them
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, cache: {}, metaData: {}, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });

import { retrieveStudyMetadata } from './retrieveStudyMetadata.js';

const fakeDicomWebServer = {};

// Testing Promises: https://jestjs.io/docs/en/asynchronous#promises
describe('retrieveStudyMetadata.js', () => {
  it('throws an exception if no server parameter is provided', () => {
    const callWithNoServer = () => {
      retrieveStudyMetadata(null, 'fake-study-instance-uid');
    };

    expect(callWithNoServer).toThrow(Error);
  });

  it('throws an exception if no StudyInstanceUID parameter is provided', () => {
    const callWithNoStudyInstanceUID = () => {
      retrieveStudyMetadata(fakeDicomWebServer, null);
    };

    expect(callWithNoStudyInstanceUID).toThrow(Error);
  });
});
