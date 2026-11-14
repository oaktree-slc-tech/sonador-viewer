// A classic viewport is brought to the slice of a series nearest a patient point (an arrow's tip),
// over every display set of the series and every frame of a multi-frame instance: its stack scrolls
// when it holds that slice; otherwise the slice's display set is shown at it, its stack index carried
// as the viewport's frameIndex (no SOP instance to override it), whenever the images load.

const mockScroll = jest.fn();
const mockDispatch = jest.fn();
const mockStack = { imageIds: [], currentImageIdIndex: 0 };
const mockStudies = {};
// Axial slices 3 mm apart: 'a:<i>' of series 2.25.2 at z = 3i, 'b:<i>' of series 2.25.3 at z = 3i
const mockPlaneOf = (imageId) => {
  const index = Number(String(imageId).split(':')[1]);
  return Number.isFinite(index) ? { imagePositionPatient: [0, 0, 3 * index], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] } : undefined;
};
// Image ids 'a:<i>' (series 2.25.2) and 'b:<i>' (series 2.25.3) at z = 3i; the SOP instance of an
// id is its third part when it has one ('b:2:2.25.3.9': frame of instance 2.25.3.9), else the id
const mockElementListeners = {};
jest.mock('cornerstone-core', () => ({
  EVENTS: { NEW_IMAGE: 'cornerstonenewimage' },
  metaData: {
    get: (type, imageId) => {
      if (type === 'generalSeriesModule') {
        return { seriesInstanceUID: imageId.startsWith('a:') ? '2.25.2' : '2.25.3' };
      }
      return type === 'SOPInstanceUID' ? (imageId.split(':')[2] || imageId) : undefined;
    },
  },
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  import: name => (name === 'util/scrollToIndex' ? (...args) => mockScroll(...args) : () => {}),
  getToolState: (element, name) => (name === 'stack' ? { data: [mockStack] } : undefined),
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { MeasurementApi: {} },
    display: {},
    DICOMSR: {},
    log: { warn: () => {}, debug: () => {}, info: () => {} },
    utils: {
      studyMetadataManager: { get: uid => mockStudies[uid] }, cornerstoneUtils: { refreshCornerstoneViewports: () => {} },
      StackManager: { findOrCreateStack: (study, displaySet) => ({ imageIds: displaySet.stackIds }) },
    },
    redux: { actions: { setViewportSpecificData: (index, displaySet) => ({ index, displaySet }) } },
  },
}), { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: { LabellingFlow: () => null } }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
const mockElement = {
  id: 'element',
  addEventListener: (name, fn) => { mockElementListeners[name] = fn; },
  removeEventListener: (name) => { delete mockElementListeners[name]; },
};
jest.mock('./state', () => ({ getEnabledElement: () => mockElement }));
jest.mock('./tools/imagePlaneOf', () => ({ __esModule: true, default: imageId => mockPlaneOf(imageId) }));

import commandsModule from './commandsModule';

const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: { runCommand: () => {} } });
const jumpToNearestSlice = definitions.jumpToNearestSlice.commandFn;

beforeAll(() => { global.window = global.window || {}; window.store = { dispatch: (...args) => mockDispatch(...args) }; });
beforeEach(() => {
  mockScroll.mockClear();
  mockDispatch.mockClear();
  Object.assign(mockStack, { imageIds: ['a:0', 'a:1', 'a:2', 'a:3'], currentImageIdIndex: 0 });
});

it("scrolls the viewport's stack to the slice nearest the point when it shows the series", () => {
  expect(jumpToNearestSlice({ worldPoint: [12, 0, 7], StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.2' })).toBe('shown');
  expect(mockScroll).toHaveBeenCalledWith(mockElement, 2);
  expect(mockDispatch).not.toHaveBeenCalled();
});

const displaySetOf = (displaySetInstanceUID, stackIds) => {
  const sops = [...new Set(stackIds.map(id => id.split(':')[2] || id))];
  return { displaySetInstanceUID, SeriesInstanceUID: '2.25.3', stackIds, images: sops.map(sop => ({ getSOPInstanceUID: () => sop })) };
};

it('shows a later frame of a multi-frame instance in another series at once, as the stack index', () => {
  // One three-frame instance at z = 0, 3, 6
  const multiFrame = displaySetOf('ds-1', ['b:0:2.25.3.9', 'b:1:2.25.3.9', 'b:2:2.25.3.9']);
  multiFrame.SOPInstanceUID = '2.25.3.9';
  mockStudies['2.25.1'] = { getDisplaySets: () => [multiFrame] };
  expect(jumpToNearestSlice({ worldPoint: [12, 0, 6.5], StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3', activeViewportIndex: 1 })).toBe('shown');
  const [[{ index, displaySet }]] = mockDispatch.mock.calls;
  expect(index).toBe(1);
  expect(displaySet).toMatchObject({ displaySetInstanceUID: 'ds-1', frameIndex: 2 });
  expect(displaySet.SOPInstanceUID).toBeUndefined();
  // Nothing waits on the viewport's images
  expect(mockElementListeners.cornerstonenewimage).toBeUndefined();
  expect(mockScroll).not.toHaveBeenCalled();
});

it('takes the nearest slice over every display set of the series, the one shown included', () => {
  // The viewport shows a display set of the series at z = 27, 30; another holds z = 12, 15
  const shown = displaySetOf('ds-shown', ['b:9', 'b:10']);
  const near = displaySetOf('ds-near', ['b:4', 'b:5']);
  mockStudies['2.25.1'] = { getDisplaySets: () => [shown, near] };
  Object.assign(mockStack, { imageIds: shown.stackIds, currentImageIdIndex: 0 });
  expect(jumpToNearestSlice({ worldPoint: [12, 0, 12], StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3' })).toBe('shown');
  expect(mockScroll).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith({ index: 0, displaySet: expect.objectContaining({ displaySetInstanceUID: 'ds-near', frameIndex: 0 }) });

  // The nearest slice in the shown display set: the stack scrolls
  mockDispatch.mockClear();
  expect(jumpToNearestSlice({ worldPoint: [12, 0, 29], StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3' })).toBe('shown');
  expect(mockScroll).toHaveBeenCalledWith(mockElement, 1);
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('reports a series it cannot show', () => {
  expect(jumpToNearestSlice({ worldPoint: [12, 0, 4], StudyInstanceUID: '2.25.9', SeriesInstanceUID: '2.25.9' })).toBe('unavailable');
});
