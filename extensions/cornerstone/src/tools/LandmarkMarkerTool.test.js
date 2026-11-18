/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// Landmark markers in the classic viewport: a landmark within half the stack's spacing is drawn in
// full, one or two slices off as a ghost with its caret set by the stack's order (above for a later
// image, below for an earlier one, a reversed stack flipping it), and none further off or beyond the
// end of the stack; an image-domain set on its own instance and frame, also on an image without a
// place in the patient; the chosen landmark with its brackets; a hovered named marker with its name
// plate. The view asks for the image's Frame of Reference, instance and frame.

// Axial images 1 mm apart, z = 17 to 20, of Frame of Reference 2.25.7001; ids '<stack>:<z>'
const mockPlanes = {};
['up', 'down'].forEach((stack) => {
  [17, 18, 19, 20].forEach((z) => {
    mockPlanes[`${stack}:${z}`] = {
      imagePositionPatient: [0, 0, z], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
      rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.7001',
    };
  });
});
const mockToolState = {};
const mockDrawn = [];
const mockViews = [];
let mockShown = [];
const mockUpdated = jest.fn();

jest.mock('cornerstone-core', () => ({
  EVENTS: { ELEMENT_DISABLED: 'cornerstoneelementdisabled' },
  events: { addEventListener: () => {} },
  metaData: {
    get: (type, imageId) => {
      if (type === 'SOPInstanceUID') {
        return `sop-${String(imageId).split(':')[1]}`;
      }
      return undefined;
    },
  },
  // Canvas pixels: twice the image pixels
  pixelToCanvas: (element, { x, y }) => ({ x: 2 * x, y: 2 * y }),
  getEnabledElements: () => [],
  updateImage: (...args) => mockUpdated(...args),
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  importInternal: name => ({
    'base/BaseTool': class { constructor(props) { Object.assign(this, props); } },
    'drawing/getNewContext': () => ({}),
  })[name],
  getToolState: (element, name) => mockToolState[name],
}), { virtual: true });
jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkSetStore', () => ({
  getCurrentLandmark: () => null, getLandmarkSets: () => [], isLandmarkSetVisible: () => true, subscribe: () => ({ unsubscribe: () => {} }),
  EVENTS: { SELECTION_CHANGED: 'selection' },
}));
jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkPlacement', () => ({ placementOf: () => ({ placed: true }) }));
jest.mock('@ohif/core', () => {
  const markers = jest.requireActual('../../../../platform/core/src/DICOMSR/landmarks/landmarkMarkers');
  return {
    __esModule: true,
    DicomMetadataStore: {},
    default: {
      DICOMSR: {
        angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
        landmarks: {
          subscribe: () => ({ unsubscribe: () => {} }),
          markers: {
            ...markers,
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
jest.mock('./imagePlaneOf', () => ({ __esModule: true, default: imageId => mockPlanes[imageId] }));
// The layers drawn, as primitives in CSS pixels
jest.mock('../utils/landmarkMarkerOverlay', () => {
  const actual = jest.requireActual('../utils/landmarkMarkerOverlay');
  return { ...actual, drawOnCanvas: (context, primitives, scale) => mockDrawn.push({ primitives, scale }) };
});

import LandmarkMarkerTool, { frameNumberOfImageId } from './LandmarkMarkerTool';

const tool = new LandmarkMarkerTool();
const canvas = { width: 400, clientWidth: 200, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
let element;

const landmark = (key, point, extra = {}) => ({
  key, setKey: 'set', index: 0, domain: 'patient', point, shape: 'Point', name: null, line: '#00C0FF', text: '#FFFFFF', current: false, ...extra,
});
function show(imageIds, imageId) {
  mockToolState.stack = { data: [{ imageIds, currentImageIdIndex: imageIds.indexOf(imageId) }] };
  mockDrawn.length = 0;
  mockViews.length = 0;
  tool.renderToolData({ detail: { element, image: { imageId }, canvasContext: { canvas } } });
  return mockDrawn.map(({ primitives }) => primitives);
}
const UP = ['up:17', 'up:18', 'up:19', 'up:20'];
// The same planes in the other order
const DOWN = ['down:20', 'down:19', 'down:18', 'down:17'];
const markerOf = layers => layers[0];
const ghostCaretY = primitives => primitives.find(p => p.type === 'polyline').points[1][1];

beforeEach(() => {
  element = document.createElement('div');
  mockShown = [];
});


describe('the slice rule in the stack', () => {
  it('draws a landmark on the displayed image in full, at its place on the image', () => {
    mockShown = [landmark('a', [12, 30, 18])];
    const layers = show(UP, 'up:18');
    expect(layers).toHaveLength(1);
    const lines = markerOf(layers)[1];
    expect(lines.opacity).toBe(1);
    // The image position is the centre of the first pixel: the landmark is at (12.5, 30.5) on the image
    expect(lines.segments[0]).toEqual([12.5 - 6.5, 30.5, 12.5 - 2.5, 30.5]);
    expect(mockDrawn[0].scale).toBe(2);
  });

  it('draws one and two slices off as ghosts, the caret above for a later image of the stack', () => {
    mockShown = [landmark('one', [10, 10, 19]), landmark('two', [10, 10, 20])];
    const [one, two] = show(UP, 'up:18');
    expect(one[0].opacity).toBe(0.65);
    expect(two[0].opacity).toBe(0.4);
    expect(ghostCaretY(one)).toBeLessThan(10);
  });

  it('sets the caret by the stack order: in a reversed stack the same landmark is on an earlier image', () => {
    mockShown = [landmark('one', [10, 10, 19])];
    expect(ghostCaretY(show(DOWN, 'down:18')[0])).toBeGreaterThan(10);
  });

  it('draws nothing three slices off', () => {
    mockShown = [landmark('three', [10, 10, 21])];
    expect(show(UP, 'up:18')).toEqual([]);
  });

  it('at the edge, 1 mm beyond the last 1 mm image while it is shown: no marker and no ghost; one image inside keeps its ghost', () => {
    mockShown = [landmark('beyond', [10, 10, 21]), landmark('inside', [10, 10, 19])];
    const layers = show(UP, 'up:20');
    expect(layers).toHaveLength(1);
    expect(ghostCaretY(layers[0])).toBeGreaterThan(10);
  });

  it("asks for the image's Frame of Reference, instance and frame", () => {
    show(UP, 'up:18');
    expect(mockViews[0]).toMatchObject({ frameOfReferenceUID: '2.25.7001', image: { sopInstanceUID: 'sop-18', frameNumber: 1 } });
  });
});


describe('image-domain sets', () => {
  it('are drawn at their column and row, in full, without ghosts', () => {
    mockShown = [landmark('img', [40.5, 22.5], { domain: 'image' })];
    const layers = show(UP, 'up:18');
    expect(layers).toHaveLength(1);
    expect(markerOf(layers)[1].segments[0]).toEqual([40.5 - 6.5, 22.5, 40.5 - 2.5, 22.5]);
  });

  it('are drawn on an image without a place in the patient, where patient-domain landmarks are not', () => {
    mockShown = [landmark('img', [40.5, 22.5], { domain: 'image' }), landmark('a', [12, 30, 18])];
    const layers = show(['flat:1'], 'flat:1');
    expect(layers).toHaveLength(1);
    expect(markerOf(layers)[1].segments[0]).toEqual([40.5 - 6.5, 22.5, 40.5 - 2.5, 22.5]);
    expect(mockViews[0]).toMatchObject({ frameOfReferenceUID: undefined, image: { sopInstanceUID: 'sop-1', frameNumber: 1 } });
  });

  it('reads the frame of the displayed image id', () => {
    expect(frameNumberOfImageId('wadors:https://server/studies/1/series/2/instances/3/frames/4')).toBe(4);
    expect(frameNumberOfImageId('wadouri:https://server/wado?objectUID=3&frame=2')).toBe(3);
    expect(frameNumberOfImageId('sonadorlocal:3?frame=0')).toBe(1);
    expect(frameNumberOfImageId('wadouri:https://server/wado?objectUID=3')).toBe(1);
  });
});


describe('the chosen landmark and hover', () => {
  it('draws white brackets around the chosen landmark, after every marker', () => {
    mockShown = [landmark('a', [10, 10, 18], { current: true }), landmark('b', [30, 10, 18])];
    const layers = show(UP, 'up:18');
    expect(layers).toHaveLength(3);
    expect(layers[2].some(p => p.stroke === '#FFFFFF')).toBe(true);
  });

  it('draws no brackets around a chosen landmark seen as a ghost', () => {
    mockShown = [landmark('a', [10, 10, 19], { current: true })];
    expect(show(UP, 'up:18')).toHaveLength(1);
  });

  it('thickens a hovered marker and shows its name; a hovered ghost shows its offset', () => {
    mockShown = [landmark('a', [10, 10, 18], { name: 'Tear drop' }), landmark('g', [60, 10, 19], { name: 'Label only' })];
    show(UP, 'up:18');
    // The pointer on the first marker (CSS pixels from the canvas's top left)
    element.dispatchEvent(Object.assign(new MouseEvent('mousemove', { clientX: 12, clientY: 11 })));
    expect(mockUpdated).toHaveBeenCalledWith(element);
    let layers = show(UP, 'up:18');
    expect(layers[0][1].width).toBe(2);
    expect(layers[2].find(p => p.type === 'text').text).toBe('Tear drop');

    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 10 }));
    layers = show(UP, 'up:18');
    expect(layers[2].find(p => p.type === 'text').text).toBe('Label only · 1 slice later');

    element.dispatchEvent(new MouseEvent('mouseleave'));
    expect(show(UP, 'up:18')).toHaveLength(2);
  });

  it('shows nothing but the thicker stroke on a hovered unnamed marker', () => {
    mockShown = [landmark('a', [10, 10, 18])];
    show(UP, 'up:18');
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    const layers = show(UP, 'up:18');
    expect(layers).toHaveLength(1);
    expect(layers[0][1].width).toBe(2);
  });
});
