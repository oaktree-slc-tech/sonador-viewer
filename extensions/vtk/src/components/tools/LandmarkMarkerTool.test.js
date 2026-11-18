// Landmark markers in the Cornerstone3D slice views: a landmark within half the slice spacing of the
// displayed plane is drawn in full, one or two slices off as a ghost (the caret above for a later slice,
// the slice index growing along the view plane normal), and none further off or beyond the volume's
// slices; the view asks for its Frame of Reference only, so image-domain sets are never drawn; the
// 3D view draws nothing here; the layers go to the SVG layer and the markers are recorded for hover.

const mockDrawn = [];
const mockRecorded = [];
const mockViews = [];
let mockShown = [];
// The volume's slices along the normal: z = 0 to 30
const mockRange = { min: 0, max: 30 };

jest.mock('@cornerstonejs/core', () => {
  class VolumeViewport {}
  return {
    Enums: { ViewportType: { VOLUME_3D: 'volume3d' }, Events: { ELEMENT_DISABLED: 'disabled' } },
    eventTarget: { addEventListener: () => {} },
    getRenderingEngines: () => [],
    VolumeViewport,
    utilities: {
      getTargetVolumeAndSpacingInNormalDir: () => ({ imageVolume: { volumeId: 'vol' }, spacingInNormalDirection: 3 }),
      getSliceRange: (actor, normal, focal) => ({ min: mockRange.min, max: mockRange.max, current: focal[2] }),
    },
  };
}, { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  AnnotationTool: class { constructor() { this.configuration = {}; } },
  addTool: () => {},
  state: { tools: {} },
  utilities: { triggerAnnotationRenderForViewportIds: () => {} },
}), { virtual: true });
jest.mock('@ohif/core', () => {
  const markers = jest.requireActual('../../../../../platform/core/src/DICOMSR/landmarks/landmarkMarkers');
  return {
    __esModule: true,
    default: {
      DICOMSR: {
        landmarks: {
          subscribe: () => ({ unsubscribe: () => {} }),
          markers: {
            ...markers,
            subscribeMarkerFrames: () => ({ unsubscribe: () => {} }),
            viewLandmarks: (view) => {
              mockViews.push(view);
              return mockShown;
            },
          },
        },
      },
    },
  };
}, { virtual: true });
jest.mock('../../../../../platform/core/src/DICOMSR/landmarks/landmarkSetStore', () => ({
  getCurrentLandmark: () => null, getLandmarkSets: () => [], isLandmarkSetVisible: () => true, subscribe: () => ({ unsubscribe: () => {} }),
  EVENTS: { SELECTION_CHANGED: 'selection' },
}));
jest.mock('../../../../../platform/core/src/DICOMSR/landmarks/landmarkPlacement', () => ({ placementOf: () => ({ placed: true }) }));
jest.mock('@ohif/extension-cornerstone', () => {
  const overlay = jest.requireActual('../../../../cornerstone/src/utils/landmarkMarkerOverlay').default;
  return {
    utils: {
      landmarkMarkers: {
        ...overlay,
        drawLayersAsSvg: (helper, prefix, layers) => layers.forEach(([owner, primitives]) => mockDrawn.push({ owner: `${prefix}::${owner}`, primitives })),
        setLandmarkMarkers: (element, canvas, records) => {
          mockRecorded.push(records);
          return null;
        },
      },
    },
  };
}, { virtual: true });
// The axial slice at z = 15, 3 mm slices
jest.mock('./DICOMSRDisplayTool', () => ({
  srViewOf: viewport => (viewport.type === 'volume3d' ? { is3D: true } : { viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 15], halfSpacing: 1.5 }),
}));

import { VolumeViewport } from '@cornerstonejs/core';
import { LandmarkMarkerTool } from './LandmarkMarkerTool';

const tool = new LandmarkMarkerTool();
const viewport = Object.assign(new VolumeViewport(), {
  id: 'axial', type: 'orthographic', element: {}, canvas: {},
  getCamera: () => ({ viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 15] }),
  getActors: () => [{ referencedId: 'vol', actor: {} }],
  getFrameOfReferenceUID: () => '2.25.7001',
  worldToCanvas: ([x, y]) => [x, y],
});
const landmark = (key, point, extra = {}) => ({
  key, domain: 'patient', point, shape: 'Point', name: null, line: '#00C0FF', text: '#FFFFFF', current: false, ...extra,
});
const render = (target = viewport) => {
  mockDrawn.length = 0;
  mockViews.length = 0;
  const drawn = tool.renderAnnotation({ viewport: target }, {});
  return { drawn, layers: mockDrawn };
};
const caretY = ({ primitives }) => primitives.find(p => p.type === 'polyline').points[1][1];

beforeEach(() => {
  mockShown = [];
  Object.assign(mockRange, { min: 0, max: 30 });
});


it('draws a landmark on the displayed plane in full, at its place on the pane, and records it for hover', () => {
  mockShown = [landmark('a', [12, 30, 16])];
  const { drawn, layers } = render();
  expect(drawn).toBe(true);
  expect(layers.map(({ owner }) => owner)).toEqual(['axial::a']);
  expect(layers[0].primitives[1].segments[0]).toEqual([12 - 6.5, 30, 12 - 2.5, 30]);
  expect(mockRecorded[mockRecorded.length - 1]).toEqual([{ key: 'a', x: 12, y: 30 }]);
});

it('draws one and two slices off as ghosts, the caret above for a later slice (along the normal), below for an earlier one', () => {
  mockShown = [landmark('later', [10, 10, 18]), landmark('earlier', [10, 10, 9])];
  const { layers } = render();
  expect(layers[0].primitives[0].opacity).toBe(0.65);
  expect(caretY(layers[0])).toBeLessThan(10);
  expect(layers[1].primitives[0].opacity).toBe(0.4);
  expect(caretY(layers[1])).toBeGreaterThan(10);
});

it('draws nothing three slices off, nor a ghost for a landmark beyond the volume\'s slices', () => {
  mockShown = [landmark('far', [10, 10, 24.5])];
  expect(render().layers).toEqual([]);
  // The last slice at z = 15: a landmark 3 mm beyond it is not reached
  Object.assign(mockRange, { max: 15 });
  mockShown = [landmark('beyond', [10, 10, 18]), landmark('inside', [10, 10, 12])];
  expect(render().layers.map(({ owner }) => owner)).toEqual(['axial::inside']);
});

it("asks for the viewport's Frame of Reference only: image-domain sets are never drawn here", () => {
  render();
  expect(mockViews).toEqual([{ frameOfReferenceUID: '2.25.7001' }]);
});

it('draws the chosen landmark with its brackets', () => {
  mockShown = [landmark('a', [10, 10, 15], { current: true })];
  expect(render().layers.map(({ owner }) => owner)).toEqual(['axial::a', 'axial::a::brackets']);
});

it('draws nothing in the 3D view', () => {
  mockShown = [landmark('a', [10, 10, 15])];
  const { drawn, layers } = render({ ...viewport, type: 'volume3d' });
  expect(drawn).toBe(false);
  expect(layers).toEqual([]);
});
