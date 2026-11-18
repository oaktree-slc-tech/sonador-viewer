/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The frame an image-domain set is drawn on, as the Viewer's metadata provider resolves it: an image
// id whose frame its URL does not name, registered with its frame index, shows that frame's set and
// not the first frame's.

jest.mock('@cornerstonejs/core', () => ({
  utilities: {
    calibratedPixelSpacingMetadataProvider: { add: () => {} },
    getPixelSpacingInformation: instance => ({ PixelSpacing: instance.PixelSpacing, type: null }),
  },
}), { virtual: true });
// The classic metadata answers from the Viewer's provider, as the legacy bridge registers it
jest.mock('cornerstone-core', () => ({
  EVENTS: { ELEMENT_DISABLED: 'cornerstoneelementdisabled' },
  events: { addEventListener: () => {} },
  metaData: {
    get: (type, imageId) => jest.requireActual('../../../../platform/core/src/classes/Cornerstone3dMetadataProvider').default.get(type, imageId),
  },
  pixelToCanvas: (element, point) => point,
  getEnabledElements: () => [],
  updateImage: () => {},
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  importInternal: name => ({
    'base/BaseTool': class { constructor(props) { Object.assign(this, props); } },
    'drawing/getNewContext': () => ({}),
  })[name],
  getToolState: () => undefined,
}), { virtual: true });
// Two image-domain sets on one multiframe instance: frame 1 and frame 4
jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkSetStore', () => {
  const set = (frameNumber, name) => ({
    domain: 'image', image: { sopInstanceUID: '2.25.9101', frameNumber }, landmarks: [{ point: [8, 8], name }],
  });
  return {
    getCurrentLandmark: () => null,
    getLandmarkSets: () => [{ key: 'first', set: set(1, 'On frame 1') }, { key: 'fourth', set: set(4, 'On frame 4') }],
    isLandmarkSetVisible: () => true,
    subscribe: () => ({ unsubscribe: () => {} }),
    EVENTS: { SELECTION_CHANGED: 'selection' },
  };
});
jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkPlacement', () => ({ placementOf: () => ({ placed: true }) }));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  DicomMetadataStore: {},
  default: {
    DICOMSR: {
      landmarks: {
        subscribe: () => ({ unsubscribe: () => {} }),
        markers: jest.requireActual('../../../../platform/core/src/DICOMSR/landmarks/landmarkMarkers'),
      },
    },
  },
}), { virtual: true });
// No place in the patient: only the image-domain sets can be drawn
jest.mock('./imagePlaneOf', () => ({ __esModule: true, default: () => undefined }));

import DicomMetadataStore from '../../../../platform/core/src/services/DicomMetadataStore';
import provider from '../../../../platform/core/src/classes/Cornerstone3dMetadataProvider';
import { frameNumberOfImageId, placedLandmarks } from './LandmarkMarkerTool';

const UIDS = { StudyInstanceUID: '2.25.9100', SeriesInstanceUID: '2.25.9102', SOPInstanceUID: '2.25.9101' };
// Ids that name no frame the URL parsing reads
const FIRST = 'synthetic:2.25.9101/one';
const FOURTH = 'synthetic:2.25.9101/four';

beforeAll(() => {
  DicomMetadataStore.addInstances([{
    ...UIDS, SOPClassUID: '1.2.840.10008.5.1.4.1.1.4', Modality: 'MR', Rows: 16, Columns: 16, NumberOfFrames: 5,
    SharedFunctionalGroupsSequence: [{}], PerFrameFunctionalGroupsSequence: [{}, {}, {}, {}, {}],
  }]);
  provider.addImageIdToUIDs(FIRST, { ...UIDS, frameIndex: 0 });
  provider.addImageIdToUIDs(FOURTH, { ...UIDS, frameIndex: 3 });
});

it('reads the frame the metadata provider resolved for the instance', () => {
  expect(frameNumberOfImageId(FOURTH)).toBe(4);
  expect(frameNumberOfImageId(FIRST)).toBe(1);
});

it("draws the fourth frame's set on the fourth frame, and the first frame's on the first", () => {
  const names = imageId => placedLandmarks(document.createElement('div'), { imageId }, 1).map(({ landmark }) => landmark.name);
  expect(names(FOURTH)).toEqual(['On frame 4']);
  expect(names(FIRST)).toEqual(['On frame 1']);
});
