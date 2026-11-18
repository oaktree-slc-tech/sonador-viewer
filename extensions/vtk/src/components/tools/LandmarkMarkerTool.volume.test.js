// Landmark markers in the 3D volume view: every landmark in view drawn, faded by its depth along the
// viewing direction across all visible sets (100 % nearest, 50 % farthest, 100 % when all are at one
// depth), the nearest drawn last; the hovered and the chosen marker at full strength, plates and
// brackets never faded; of two overlapping markers the nearer answers; the chosen landmark outside the
// view marked at the nearest edge with its brackets and a chevron, below a hovered name plate, also
// straight behind a perspective camera; and "Follow selected landmark", which turns the 3D views that
// draw the landmarks, of the landmark's Frame of Reference, to face it (zoom and focal point
// unchanged), and does nothing for another feature's 3D view, a landmark at the focal point or with
// the preference off.

const mockDrawn = [];
const mockViews = [];
let mockShown = [];
let mockPointer = null;
let mockFollow = false;
let mockCurrent = null;
const mockListeners = { store: null, follow: null };
const mockViewports = [];
// The tool groups by viewport id: the volume viewer's holds the landmark markers, another feature's does not
const mockGroups = {};

jest.mock('@cornerstonejs/core', () => {
  class VolumeViewport {}
  return {
    Enums: { ViewportType: { VOLUME_3D: 'volume3d' }, Events: { ELEMENT_DISABLED: 'disabled' } },
    eventTarget: { addEventListener: () => {} },
    getRenderingEngines: () => [{ getViewports: () => mockViewports }],
    VolumeViewport,
    utilities: {},
  };
}, { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  AnnotationTool: class { constructor() { this.configuration = {}; } },
  ToolGroupManager: { getToolGroupForViewport: id => mockGroups[id] },
  addTool: () => {},
  state: { tools: {} },
  utilities: { triggerAnnotationRenderForViewportIds: () => {} },
}), { virtual: true });
jest.mock('@ohif/core', () => {
  const markers = jest.requireActual('../../../../../platform/core/src/DICOMSR/landmarks/landmarkMarkers');
  const volumeView = jest.requireActual('../../../../../platform/core/src/DICOMSR/landmarks/landmarkVolumeView');
  return {
    __esModule: true,
    default: {
      DICOMSR: {
        landmarks: {
          EVENTS: { SELECTION_CHANGED: 'selection' },
          subscribe: (listener) => {
            mockListeners.store = listener;
            return { unsubscribe: () => {} };
          },
          getCurrentLandmark: () => mockCurrent,
          getFollowSelectedLandmark: () => mockFollow,
          subscribeFollowSelectedLandmark: (listener) => {
            mockListeners.follow = listener;
            return { unsubscribe: () => {} };
          },
          markers: {
            ...markers,
            subscribeMarkerFrames: () => ({ unsubscribe: () => {} }),
            viewLandmarks: (view) => {
              mockViews.push(view);
              return mockShown;
            },
          },
          volumeView,
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
        // The pointer, when there is one, answers through the markers' own hit test
        setLandmarkMarkers: (element, canvas, records, { markerAt }) => {
          const hit = mockPointer && markerAt(records, mockPointer[0], mockPointer[1]);
          return hit ? hit.key : null;
        },
      },
    },
  };
}, { virtual: true });
jest.mock('./DICOMSRDisplayTool', () => ({ srViewOf: () => ({ is3D: true }) }));

import { LandmarkMarkerTool } from './LandmarkMarkerTool';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => a.map(v => v / Math.hypot(...a));

/**
 * A 3D view of a 400 px square canvas, 1 px per mm, projecting as its camera says; in the volume
 * viewer's tool group (with the landmark markers) unless `drawsLandmarks` is false
 */
function volumeViewport({ id = 'vol', frameOfReferenceUID = '2.25.7001', camera, size = 400, drawsLandmarks = true } = {}) {
  mockGroups[id] = { hasTool: name => drawsLandmarks && name === 'SonadorLandmarkMarker3D', toolOptions: {} };
  const viewport = {
    id, type: 'volume3d', element: {}, canvas: { clientWidth: size, clientHeight: size },
    camera: { parallelProjection: true, ...camera },
    getCamera: () => ({ ...viewport.camera }),
    setCamera: (next) => { viewport.camera = { ...viewport.camera, ...next }; },
    render: jest.fn(),
    getFrameOfReferenceUID: () => frameOfReferenceUID,
    worldToCanvas: (point) => {
      const { position, focalPoint, viewUp } = viewport.camera;
      const forward = norm(sub(focalPoint, position));
      const up = norm(viewUp);
      const right = cross(forward, up);
      const offset = sub(point, focalPoint);
      return [size / 2 + dot(offset, right), size / 2 - dot(offset, up)];
    },
  };
  return viewport;
}
// Looking down -z at the origin from 500 mm, the head toward +y
const FRONT = { position: [0, 0, 500], focalPoint: [0, 0, 0], viewUp: [0, 1, 0] };

const landmark = (key, point, extra = {}) => ({
  key, domain: 'patient', point, shape: 'Point', name: null, line: '#00C0FF', text: '#FFFFFF', current: false, ...extra,
});
const tool = new LandmarkMarkerTool();
const render = (viewport) => {
  mockDrawn.length = 0;
  mockViews.length = 0;
  tool.renderAnnotation({ viewport }, {});
  return mockDrawn;
};
const layer = (layers, owner) => layers.find(entry => entry.owner === owner);
const strength = (layers, owner) => layer(layers, owner).primitives[0].opacity;

beforeEach(() => {
  mockShown = [];
  mockPointer = null;
  mockFollow = false;
  mockCurrent = null;
  mockViewports.length = 0;
});


describe('the depth fade', () => {
  // Two landmarks of set A side by side at one depth, a third (set B) 40 mm behind them
  const shown = () => [landmark('A::0', [-30, 0, 0]), landmark('A::1', [30, 0, 0]), landmark('B::0', [0, 0, -40])];

  it('gives the pair at one depth equal strength, the farther 50 %, and draws the nearest last', () => {
    mockShown = shown();
    const layers = render(volumeViewport({ camera: FRONT }));
    expect(strength(layers, 'vol::A::0')).toBe(1);
    expect(strength(layers, 'vol::A::1')).toBe(1);
    expect(strength(layers, 'vol::B::0')).toBe(0.5);
    expect(layers.map(({ owner }) => owner)[0]).toBe('vol::B::0');
  });

  it('follows the camera: after an orbit to the side the depths, and so the strengths, change', () => {
    mockShown = shown();
    const viewport = volumeViewport({ camera: FRONT });
    viewport.setCamera({ position: [500, 0, 0], viewUp: [0, 1, 0] });
    const layers = render(viewport);
    expect(strength(layers, 'vol::A::1')).toBe(1);
    expect(strength(layers, 'vol::A::0')).toBe(0.5);
    expect(strength(layers, 'vol::B::0')).toBeCloseTo(0.75);
  });

  it('measures across the landmarks still drawn: with set B hidden, the pair is at a finite 100 %', () => {
    mockShown = shown().filter(({ key }) => !key.startsWith('B'));
    const layers = render(volumeViewport({ camera: FRONT }));
    expect([strength(layers, 'vol::A::0'), strength(layers, 'vol::A::1')]).toEqual([1, 1]);
  });

  it('draws the chosen and the hovered marker at full strength, and never fades brackets or plates', () => {
    mockShown = [landmark('A::0', [-30, 0, 0]), landmark('B::0', [0, 0, -40], { current: true }), landmark('B::1', [60, 0, -40], { name: 'Tear drop' })];
    mockPointer = [260, 200];
    const layers = render(volumeViewport({ camera: FRONT }));
    expect(strength(layers, 'vol::B::0')).toBe(1);
    expect(strength(layers, 'vol::B::1')).toBe(1);
    layer(layers, 'vol::B::0::brackets').primitives.forEach(p => expect(p.opacity).toBe(1));
    expect(layer(layers, 'vol::B::1::plate').primitives.find(p => p.type === 'text').text).toBe('Tear drop');
    layer(layers, 'vol::B::1::plate').primitives.forEach(p => expect(p.opacity === undefined ? 1 : p.opacity).toBe(1));
  });
});


describe('hover', () => {
  it('answers with the nearer marker where two overlap, though the farther centre is nearer the pointer', () => {
    mockShown = [landmark('far', [0, 0, -40], { name: 'Far' }), landmark('near', [8, 0, 0], { name: 'Near' })];
    mockPointer = [201, 200];
    const layers = render(volumeViewport({ camera: FRONT }));
    expect(layer(layers, 'vol::near::plate')).toBeDefined();
    expect(layer(layers, 'vol::far::plate')).toBeUndefined();
  });
});


describe('the chosen landmark outside the view', () => {
  it('is marked at the nearest edge by its brackets and a chevron in its Line colour, pointing toward it', () => {
    mockShown = [landmark('A::0', [0, 0, 0]), landmark('A::1', [400, 20, 0], { current: true, line: '#FF0000' })];
    const layers = render(volumeViewport({ camera: FRONT }));
    expect(layers.map(({ owner }) => owner)).toEqual(['vol::A::0', 'vol::A::1::edge']);
    const edge = layer(layers, 'vol::A::1::edge').primitives;
    expect(edge.filter(p => p.stroke === '#FFFFFF')).toHaveLength(4);
    const chevron = edge[edge.length - 1];
    expect(chevron.stroke).toBe('#FF0000');
    // At the right edge, pointing right
    expect(chevron.points[1][0]).toBeGreaterThan(chevron.points[0][0]);
    expect(chevron.points[1][0]).toBeGreaterThan(370);
  });

  it('is marked for a landmark behind a perspective camera, from its direction on the view plane', () => {
    mockShown = [landmark('A::0', [-100, 0, 700], { current: true })];
    const layers = render(volumeViewport({ camera: { ...FRONT, parallelProjection: false } }));
    expect(layers.map(({ owner }) => owner)).toEqual(['vol::A::0::edge']);
    // Toward the left of the view
    const chevron = layer(layers, 'vol::A::0::edge').primitives.slice(-1)[0];
    expect(chevron.points[1][0]).toBeLessThan(40);
  });

  it('is marked for a landmark straight behind a perspective camera, which has no direction on the view plane', () => {
    mockShown = [landmark('A::0', [0, 0, 700], { current: true })];
    const layers = render(volumeViewport({ camera: { ...FRONT, parallelProjection: false } }));
    expect(layers.map(({ owner }) => owner)).toEqual(['vol::A::0::edge']);
    const chevron = layer(layers, 'vol::A::0::edge').primitives.slice(-1)[0];
    chevron.points.flat().forEach(value => expect(Number.isFinite(value)).toBe(true));
    // The middle of the bottom edge, pointing down
    expect(chevron.points[1][0]).toBeCloseTo(200);
    expect(chevron.points[1][1]).toBeGreaterThan(chevron.points[0][1]);
  });

  it('keeps the mark after Follow brings the camera onto the line through a landmark beyond it', () => {
    const view = volumeViewport({ camera: { ...FRONT, parallelProjection: false } });
    mockViewports.push(view);
    mockFollow = true;
    mockCurrent = { key: 'A', index: 0, landmark: { point: [60, 0, 700] }, entry: { set: { domain: 'patient', frameOfReferenceUID: '2.25.7001' } } };
    mockListeners.store({ type: 'selection' });
    expect(Math.hypot(...view.camera.position)).toBeCloseTo(500);
    mockShown = [landmark('A::0', [60, 0, 700], { current: true })];
    const layers = render(view);
    expect(layers.map(({ owner }) => owner)).toEqual(['vol::A::0::edge']);
    layer(layers, 'vol::A::0::edge').primitives.forEach(p => p.points.flat().forEach(value => expect(Number.isFinite(value)).toBe(true)));
  });

  it('draws the edge mark below a hovered name plate', () => {
    mockShown = [landmark('A::0', [130, 0, 0], { name: 'Tear drop' }), landmark('A::1', [400, 20, 0], { current: true })];
    mockPointer = [330, 200];
    const owners = render(volumeViewport({ camera: FRONT })).map(({ owner }) => owner);
    expect(owners).toEqual(['vol::A::0', 'vol::A::1::edge', 'vol::A::0::plate']);
  });

  it('has no mark when the chosen landmark is in view, nor for a hidden or held set (nothing is listed for it)', () => {
    mockShown = [landmark('A::0', [0, 0, 0], { current: true })];
    expect(render(volumeViewport({ camera: FRONT })).map(({ owner }) => owner)).toEqual(['vol::A::0', 'vol::A::0::brackets']);
    mockShown = [];
    expect(render(volumeViewport({ camera: FRONT }))).toEqual([]);
  });

  it("asks for the viewport's Frame of Reference only: image-domain sets are never drawn here", () => {
    render(volumeViewport({ camera: FRONT }));
    expect(mockViews).toEqual([{ frameOfReferenceUID: '2.25.7001' }]);
  });
});


describe('Follow selected landmark', () => {
  const current = (point, extra = {}) => ({
    key: 'A', index: 0, landmark: { point }, entry: { set: { domain: 'patient', frameOfReferenceUID: '2.25.7001', ...extra } },
  });
  const choose = () => mockListeners.store({ type: 'selection' });

  it('with the preference on, turns each 3D view of the Frame of Reference to face the chosen landmark, zoom and focal point unchanged', () => {
    const view = volumeViewport({ camera: { ...FRONT, parallelScale: 120 } });
    const other = volumeViewport({ id: 'other', frameOfReferenceUID: '2.25.7002', camera: FRONT });
    const pane = { ...volumeViewport({ id: 'axial', camera: FRONT }), type: 'orthographic' };
    mockViewports.push(view, other, pane);
    mockFollow = true;
    // A landmark at the back of the volume
    mockCurrent = current([0, 0, -80]);
    choose();
    expect(view.camera.focalPoint).toEqual([0, 0, 0]);
    expect(view.camera.position[2]).toBeCloseTo(-500);
    expect(view.camera.parallelScale).toBe(120);
    expect(view.render).toHaveBeenCalled();
    expect(other.camera.position).toEqual([0, 0, 500]);
    expect(pane.camera.position).toEqual([0, 0, 500]);
  });

  it("never turns a 3D view that does not draw the landmarks (another feature's), on a choice or on turning it on", () => {
    const view = volumeViewport({ camera: FRONT });
    const excluded = volumeViewport({ id: 'seg-editor-3d', camera: FRONT, drawsLandmarks: false });
    mockViewports.push(view, excluded);
    mockFollow = true;
    mockCurrent = current([0, 0, -80]);
    choose();
    expect(view.camera.position[2]).toBeCloseTo(-500);
    expect(excluded.camera.position).toEqual([0, 0, 500]);
    expect(excluded.render).not.toHaveBeenCalled();
    mockCurrent = current([80, 0, 0]);
    mockListeners.follow(true, { hydrated: false });
    expect(view.camera.position[0]).toBeCloseTo(500);
    expect(excluded.camera.position).toEqual([0, 0, 500]);
    expect(excluded.render).not.toHaveBeenCalled();
  });

  it('leaves the camera where it is with the preference off, for a landmark at the focal point, and for an image-domain set', () => {
    const view = volumeViewport({ camera: FRONT });
    mockViewports.push(view);
    mockCurrent = current([0, 0, -80]);
    choose();
    expect(view.camera.position).toEqual([0, 0, 500]);
    mockFollow = true;
    mockCurrent = current([0, 0, 0]);
    choose();
    expect(view.camera.position).toEqual([0, 0, 500]);
    mockCurrent = current([0, 0, -80], { domain: 'image' });
    choose();
    expect(view.camera.position).toEqual([0, 0, 500]);
  });

  it('turns to the current landmark at once when turned on, but not when the preference is read at startup', () => {
    const view = volumeViewport({ camera: FRONT });
    mockViewports.push(view);
    mockCurrent = current([80, 0, 0]);
    mockListeners.follow(true, { hydrated: true });
    expect(view.camera.position).toEqual([0, 0, 500]);
    mockListeners.follow(true, { hydrated: false });
    expect(view.camera.position[0]).toBeCloseTo(500);
    expect(view.camera.focalPoint).toEqual([0, 0, 0]);
  });
});
