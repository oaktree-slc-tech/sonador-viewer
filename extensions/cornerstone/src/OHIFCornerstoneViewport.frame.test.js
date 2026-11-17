/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// A frame of a multi-frame instance reaches the classic viewport: `jumpToImage` with a frame number
// resolves it to its index in the display set's stack and shows it by that index alone, so the
// viewport, which takes the first image of a SOP Instance UID it is given, shows that frame. An
// instance of a single frame is still reached by its own image.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockDispatch = jest.fn();
const mockStudies = {};
const mockChild = jest.fn();
// Image ids '<SOP Instance UID>:<frame>'
jest.mock('cornerstone-core', () => ({
  EVENTS: {},
  metaData: { get: (type, imageId) => (type === 'SOPInstanceUID' ? String(imageId).split(':')[0] : undefined) },
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ import: () => () => {}, getToolState: () => undefined }), { virtual: true });
jest.mock('@ohif/core', () => {
  const StackManager = {
    findOrCreateStack: (study, displaySet) => ({ imageIds: displaySet.stackIds, currentImageIdIndex: 0 }),
    clearStacks: () => {},
  };
  return {
    __esModule: true,
    uiNotificationService: { show: () => {} },
    default: {
      measurements: { MeasurementApi: {} },
      display: { DisplaySetApi: {} },
      DICOMSR: {},
      log: { warn: () => {}, debug: () => {}, info: () => {} },
      utils: {
        studyMetadataManager: { get: uid => mockStudies[uid] }, cornerstoneUtils: { refreshCornerstoneViewports: () => {} },
        StackManager,
      },
      redux: { actions: { setViewportSpecificData: (index, displaySet) => ({ index, displaySet }) } },
    },
  };
}, { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: { LabellingFlow: () => null } }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
jest.mock('./state', () => ({ getEnabledElement: () => undefined }));
jest.mock('./tools/imagePlaneOf', () => ({ __esModule: true, default: () => undefined }));
jest.mock('./components/OHIFCornerstoneViewportOverlay', () => () => null);
jest.mock('./components/SeriesTagHoverTooltip', () => () => null);
jest.mock('./tools/checkForSRAnnotations', () => () => {});
// The viewport's child: the stack and the index it is given
jest.mock('./ConnectedCornerstoneViewport', () => (props) => {
  mockChild(props);
  return null;
});

import commandsModule from './commandsModule';
import OHIFCornerstoneViewport from './OHIFCornerstoneViewport';

global.IS_REACT_ACT_ENVIRONMENT = true;
const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: { runCommand: () => {} } });
const jumpToImage = definitions.jumpToImage.commandFn;

beforeAll(() => { window.store = { dispatch: (...args) => mockDispatch(...args) }; });
beforeEach(() => {
  mockDispatch.mockClear();
  mockChild.mockClear();
});

const displaySetOf = (displaySetInstanceUID, stackIds) => {
  const sops = [...new Set(stackIds.map(id => id.split(':')[0]))];
  return {
    displaySetInstanceUID, StudyInstanceUID: '2.25.1', stackIds,
    images: sops.map(sop => ({ getSOPInstanceUID: () => sop })),
  };
};

/** Run the command, then mount the classic viewport with the display set it dispatched */
function shownIndex(displaySet, args) {
  mockStudies['2.25.1'] = { findDisplaySet: match => [displaySet].find(match), displaySets: [displaySet] };
  jumpToImage({ StudyInstanceUID: '2.25.1', activeViewportIndex: 0, ...args });
  const [[{ displaySet: dispatched }]] = mockDispatch.mock.calls;
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(
    <OHIFCornerstoneViewport viewportIndex={0} onNewImage={() => {}}
      viewportData={{ studies: [{ StudyInstanceUID: '2.25.1', displaySets: [displaySet] }], displaySet: { ...dispatched } }} />));
  const { imageIds, imageIdIndex } = mockChild.mock.calls[mockChild.mock.calls.length - 1][0];
  act(() => root.unmount());
  return imageIds[imageIdIndex];
}

it('shows the third frame of a three-frame instance, not its first', () => {
  const multiFrame = displaySetOf('ds-mf', ['2.25.9:1', '2.25.9:2', '2.25.9:3']);
  expect(shownIndex(multiFrame, { SOPInstanceUID: '2.25.9', frameNumber: 3 })).toBe('2.25.9:3');
});

it('shows the frame of its own instance in a stack of several instances', () => {
  const mixed = displaySetOf('ds-mixed', ['2.25.8:1', '2.25.8:2', '2.25.9:1', '2.25.9:2', '2.25.9:3']);
  expect(shownIndex(mixed, { SOPInstanceUID: '2.25.9', frameNumber: 2 })).toBe('2.25.9:2');
});

it('shows an instance of a single frame by its own image (control)', () => {
  const singles = displaySetOf('ds-singles', ['2.25.7:1', '2.25.6:1', '2.25.5:1']);
  expect(shownIndex(singles, { SOPInstanceUID: '2.25.6', frameNumber: 1 })).toBe('2.25.6:1');
  // Without a frame number, as before
  mockDispatch.mockClear();
  expect(shownIndex(singles, { SOPInstanceUID: '2.25.5' })).toBe('2.25.5:1');
});

it('changes nothing for a frame the instance does not have', () => {
  mockStudies['2.25.1'] = { findDisplaySet: match => [displaySetOf('ds-mf', ['2.25.9:1'])].find(match) };
  jumpToImage({ StudyInstanceUID: '2.25.1', SOPInstanceUID: '2.25.9', frameNumber: 4, activeViewportIndex: 0 });
  expect(mockDispatch).not.toHaveBeenCalled();
});
