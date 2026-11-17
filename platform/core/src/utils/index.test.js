/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Cornerstone3D packages are ESM builds jest cannot load here; the exports under test do not use them
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, cache: {}, metaData: {}, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });

import * as utils from './index.js';

describe('Top level exports', () => {
  test('should export the modules ', () => {
    const expectedExports = [
      'guid',
      'ObjectPath',
      'absoluteUrl',
      'addServers',
      'sortBy',
      'writeScript',
      'b64toBlob',
      'StackManager',
      'studyMetadataManager',
      'loadAndCacheDerivedDisplaySets',
      'DicomLoaderService',
      'urlUtil',
      'makeDeferred',
      'makeCancelable',
      'hotkeys',
      'Queue',
      'isDicomUid',
      'resolveObjectPath',
      'hierarchicalListUtils',
      'progressTrackingUtils',
      'xhrRetryRequestHook',
      // Sonador additions
      'buildButtonCommands',
      'color',
      'cornerstone3dUtils',
      'cornerstoneUtils',
      'createEncapsulatedDocumentFileUrl',
      'dataProc',
      'describeSeries',
      'describeSeriesFilename',
      'describeStudy',
      'describeStudyFilename',
      'formatBytes',
      'formatDate',
      'formatPN',
      'formatTime',
      'getImageId',
      'gpuCapabilities',
      'imageIdToURI',
      'instancesSortCriteria',
      'referenceIdentifiers',
      'roundNumber',
      'seriesSortCriteria',
      'sortStudy',
      'sortStudyInstances',
      'sortStudySeries',
      'sortingCriteria',
    ].sort();

    const exports = Object.keys(utils.default).sort();

    expect(exports).toEqual(expectedExports);
  });
});
