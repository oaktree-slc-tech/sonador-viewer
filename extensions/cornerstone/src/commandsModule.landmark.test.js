// A classic viewport is brought to the image that holds a landmark: the image whose plane passes
// within half a slice spacing of it, in the stack the viewport shows first when that stack is of the
// landmark's frame, then in each stack of the series given (the set's own series first). A stack that
// holds no such image is never shown in its place, a stack's last image included: the viewport stays.

const mockScroll = jest.fn();
const mockDispatch = jest.fn();
const mockStack = { imageIds: [], currentImageIdIndex: 0 };
const mockStudies = {};
// Axial images: '<series letter>:<z in mm>'; a: series 2.25.2, b: series 2.25.3, c: series 2.25.4
const mockPlaneOf = (imageId) => {
  const z = Number(String(imageId).split(':')[1]);
  return Number.isFinite(z) ? { imagePositionPatient: [0, 0, z], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] } : undefined;
};
const mockSeriesOf = { a: '2.25.2', b: '2.25.3', c: '2.25.4' };
const mockElementListeners = {};
jest.mock('cornerstone-core', () => ({
  EVENTS: { NEW_IMAGE: 'cornerstonenewimage' },
  metaData: {
    get: (type, imageId) => {
      if (type === 'generalSeriesModule') {
        return { seriesInstanceUID: mockSeriesOf[imageId.split(':')[0]] };
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
import { imageHoldingPoint, stackSpacing } from './utils/landmarkStack';

const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: { runCommand: () => {} } });
const jumpToLandmark = definitions.jumpToLandmark.commandFn;

beforeAll(() => { global.window = global.window || {}; window.store = { dispatch: (...args) => mockDispatch(...args) }; });
beforeEach(() => {
  mockScroll.mockClear();
  mockDispatch.mockClear();
  Object.keys(mockStudies).forEach(key => delete mockStudies[key]);
});

const ids = (letter, positions) => positions.map(z => `${letter}:${z}`);
const displaySetOf = (displaySetInstanceUID, SeriesInstanceUID, stackIds) => ({
  displaySetInstanceUID, SeriesInstanceUID, stackIds, images: stackIds.map(id => ({ getSOPInstanceUID: () => id })),
});
const SERIES = uid => ({ StudyInstanceUID: '2.25.1', SeriesInstanceUID: uid });
const show = (stackIds, currentImageIdIndex = 0) => Object.assign(mockStack, { imageIds: stackIds, currentImageIdIndex });


describe('the stack geometry', () => {
  const planes = positions => positions.map(z => ({ imagePositionPatient: [0, 0, z], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] }));

  it('takes the median distance between neighbouring positions, in any order, as the spacing', () => {
    expect(stackSpacing(planes([0, 1, 2, 3]))).toBe(1);
    expect(stackSpacing(planes([6, 0, 3, 9, 12]))).toBe(3);
    // A single image: its slice thickness
    expect(stackSpacing([{ ...planes([0])[0], sliceThickness: 2.5 }])).toBe(2.5);
    expect(stackSpacing(planes([0]))).toBeUndefined();
  });

  it('holds a point within half a spacing, at exactly half, and not just beyond', () => {
    const stack = planes([0, 3, 6, 9]);
    expect(imageHoldingPoint(stack, [5, 5, 4.4])).toBe(1);
    expect(imageHoldingPoint(stack, [5, 5, 4.5])).toBe(1);
    expect(imageHoldingPoint(stack, [5, 5, 10.5])).toBe(3);
    expect(imageHoldingPoint(stack, [5, 5, 10.51])).toBe(-1);
    expect(imageHoldingPoint(stack, [5, 5, -1.6])).toBe(-1);
  });
});


describe('the image the viewport goes to', () => {
  it('scrolls the stack shown when it holds the landmark', () => {
    show(ids('a', [0, 1, 2, 3]));
    mockStudies['2.25.1'] = { getDisplaySets: () => [displaySetOf('ds-b', '2.25.3', ids('b', [0, 1, 2, 3]))] };
    expect(jumpToLandmark({ worldPoint: [0, 0, 2.2], series: [SERIES('2.25.3'), SERIES('2.25.2')] })).toBe('shown');
    expect(mockScroll).toHaveBeenCalledWith(expect.anything(), 2);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('keeps the image when no stack holds the landmark: a point beyond a short stack', () => {
    show(ids('a', [0, 1, 2, 3]), 1);
    mockStudies['2.25.1'] = { getDisplaySets: () => [displaySetOf('ds-a', '2.25.2', ids('a', [0, 1, 2, 3]))] };
    expect(jumpToLandmark({ worldPoint: [0, 0, 40], series: [SERIES('2.25.2')] })).toBe('none');
    expect(mockScroll).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('shows a second series of the frame that reaches the landmark, at its image', () => {
    show(ids('a', [0, 1, 2, 3]), 1);
    const long = displaySetOf('ds-c', '2.25.4', ids('c', [0, 10, 20, 30, 40, 50]));
    mockStudies['2.25.1'] = { getDisplaySets: () => [displaySetOf('ds-a', '2.25.2', ids('a', [0, 1, 2, 3])), long] };
    expect(jumpToLandmark({ worldPoint: [0, 0, 41], series: [SERIES('2.25.2'), SERIES('2.25.4')], activeViewportIndex: 1 })).toBe('shown');
    expect(mockDispatch).toHaveBeenCalledWith({ index: 1, displaySet: expect.objectContaining({ displaySetInstanceUID: 'ds-c', frameIndex: 4 }) });
    expect(long.SOPInstanceUID).toBeUndefined();
  });

  it('at the edge, 1 mm beyond the last 1 mm slice while the last slice is shown: the image stays', () => {
    show(ids('a', [17, 18, 19, 20]), 3);
    mockStudies['2.25.1'] = { getDisplaySets: () => [displaySetOf('ds-a', '2.25.2', ids('a', [17, 18, 19, 20]))] };
    expect(jumpToLandmark({ worldPoint: [0, 0, 21], series: [SERIES('2.25.2')] })).toBe('none');
    expect(mockScroll).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    // One slice inside the stack, the control
    expect(jumpToLandmark({ worldPoint: [0, 0, 19], series: [SERIES('2.25.2')] })).toBe('shown');
    expect(mockScroll).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("tries the set's own series before the other series of its frame", () => {
    show(ids('x', [0]));
    mockStudies['2.25.1'] = { getDisplaySets: () => [
      displaySetOf('ds-b', '2.25.3', ids('b', [0, 2, 4, 6])),
      displaySetOf('ds-c', '2.25.4', ids('c', [0, 2, 4, 6])),
    ] };
    jumpToLandmark({ worldPoint: [0, 0, 4], series: [SERIES('2.25.4'), SERIES('2.25.3')] });
    expect(mockDispatch.mock.calls[0][0].displaySet.displaySetInstanceUID).toBe('ds-c');
  });

  it('does not take the stack shown when its series is not one of the frame', () => {
    show(ids('a', [0, 1, 2, 3]));
    mockStudies['2.25.1'] = { getDisplaySets: () => [displaySetOf('ds-b', '2.25.3', ids('b', [0, 1, 2, 3]))] };
    expect(jumpToLandmark({ worldPoint: [0, 0, 2], series: [SERIES('2.25.3')] })).toBe('shown');
    expect(mockScroll).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls[0][0].displaySet.displaySetInstanceUID).toBe('ds-b');
  });
});
