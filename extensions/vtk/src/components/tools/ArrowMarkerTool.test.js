// The Cornerstone3D views' arrow markers: an arrow whose tip is less than one slice spacing from the
// view's slice, and that the slice does not draw (the library's display filter leaves it out), shows a
// ring at its tip, projected onto the view, in its style's color; a far, drawn, hidden or 3D-view arrow
// shows none; read-only DICOM-SR arrows the read-only display does not draw in the view are included;
// a press on a ring calls onActivate with the tip, the arrow's normal and the viewport. The Inspector
// turns onto the arrow's plane at the tip at any angle. A disabled viewport's rings are cleared.

const mockAnnotations = { ArrowAnnotate: [], SonadorSRDisplay: [] };
const mockHidden = new Set();
const mockDrawnBySlice = new Set();
const mockCircles = [];
const mockMarkers = [];

const mockCoreListeners = {};
const mockCleared = [];
jest.mock('@cornerstonejs/core', () => ({
  Enums: { ViewportType: { VOLUME_3D: 'volume3d' }, Events: { ELEMENT_DISABLED: 'CORNERSTONE_ELEMENT_DISABLED' } },
  eventTarget: { addEventListener: (name, fn) => { mockCoreListeners[name] = fn; } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  AnnotationTool: class {
    constructor(toolProps, defaultToolProps) {
      this.configuration = { ...defaultToolProps.configuration, ...(toolProps.configuration || {}) };
    }
    getToolName() { return 'SonadorArrowMarker3D'; }
    getStyle(property, specifier) { return `color-of:${specifier.annotationUID || 'tool'}`; }
  },
  addTool: () => {},
  annotation: {
    state: { getAnnotations: toolName => mockAnnotations[toolName] },
    visibility: { isAnnotationVisible: uid => !mockHidden.has(uid) },
  },
  drawing: { drawCircle: (helper, uid, circleUID, center, radius, options) => mockCircles.push({ uid, center, radius, options }) },
  state: { tools: {} },
  utilities: { planar: { filterAnnotationsForDisplay: (viewport, annotations) => annotations.filter(a => mockDrawnBySlice.has(a.annotationUID)) } },
}), { virtual: true });
jest.mock('@ohif/core/src/displayAttributes', () => ({ getLineTextColor: ({ Color }) => ({ line: (Color || {}).Line || null }) }), { virtual: true });
jest.mock('@ohif/core/src/DICOMSR/readOnly/srDisplayAnnotations', () => ({
  __esModule: true,
  default: { TOOL_NAME: 'SonadorSRDisplay', isViewable: annotation => annotation.data.viewableHere === true },
}), { virtual: true });
jest.mock('@ohif/extension-cornerstone', () => ({
  utils: {
    arrowMarkers: {
      ...jest.requireActual('../../../../cornerstone/src/utils/arrowMarkers').default,
      setArrowMarkers: (element, canvas, markers) => { mockMarkers.length = 0; mockMarkers.push(...markers); },
      clearArrowMarkers: element => mockCleared.push(element),
      ensureArrowMarkerTooltip: () => {},
    },
  },
}), { virtual: true });
// The axial slice at z = 30, 3 mm slices
jest.mock('./DICOMSRDisplayTool', () => ({ srViewOf: () => ({ viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 30], halfSpacing: 1.5 }) }));

import { ArrowMarkerTool, turnViewOntoArrow } from './ArrowMarkerTool';

const onActivate = jest.fn();
const tool = new ArrowMarkerTool({ configuration: { onActivate } });
// The pane maps world (x, y, z) to canvas (x, y)
const viewport = {
  id: 'axial', type: 'orthographic', element: {}, canvas: {},
  getFrameOfReferenceUID: () => '2.25.7001',
  worldToCanvas: ([x, y]) => [x, y],
};
const render = (target = viewport) => {
  mockCircles.length = 0;
  tool.renderAnnotation({ viewport: target }, {});
  return mockCircles;
};

const arrow = (uid, extra = {}) => ({
  annotationUID: uid, isVisible: true,
  metadata: { FrameOfReferenceUID: '2.25.7001', viewPlaneNormal: [0, 0, 1] },
  data: { label: 'Lesion margin', handles: { points: [[10, 20, 30], [30, 40, 30]] } },
  ...extra,
});

beforeEach(() => {
  mockAnnotations.ArrowAnnotate = [];
  mockAnnotations.SonadorSRDisplay = [];
  mockHidden.clear();
  mockDrawnBySlice.clear();
  onActivate.mockClear();
});

it("rings the tip of an arrow the pane's slice does not draw, in its color", () => {
  mockAnnotations.ArrowAnnotate = [arrow('a-1')];
  const [ring] = render();
  expect(ring).toMatchObject({ center: [10, 20], radius: 4, options: { color: 'color-of:a-1' } });
  expect(mockMarkers.map(marker => marker.label)).toEqual(['Lesion margin']);
});

it('draws no ring for an arrow the slice draws, a hidden arrow, another Frame of Reference, or in a 3D view', () => {
  mockAnnotations.ArrowAnnotate = [arrow('drawn'), arrow('hidden'), arrow('other', { metadata: { FrameOfReferenceUID: '2.25.9' } })];
  mockDrawnBySlice.add('drawn');
  mockHidden.add('hidden');
  expect(render()).toEqual([]);
  mockAnnotations.ArrowAnnotate = [arrow('a-1')];
  expect(render({ ...viewport, type: 'volume3d' })).toEqual([]);
});

it('rings a read-only DICOM-SR arrow the read-only display does not draw here', () => {
  mockAnnotations.SonadorSRDisplay = [
    { annotationUID: 'sr-1', isVisible: true, data: {
      TrackingIdentifier: 'cornerstoneTools@^4.0.0:ArrowAnnotate', handles: { points: [[5, 6, 31]] },
      labels: [{ label: 'CORNERSTONEFREETEXT', value: 'Saved arrow' }], displayColor: { Line: '#FF8800' },
    } },
    { annotationUID: 'sr-2', isVisible: true, data: {
      TrackingIdentifier: 'cornerstoneTools@^4.0.0:ArrowAnnotate', handles: { points: [[1, 2, 30]] }, viewableHere: true, labels: [],
    } },
    { annotationUID: 'sr-3', isVisible: true, data: { TrackingIdentifier: 'cornerstoneTools@^4.0.0:Length', handles: { points: [[1, 2, 30]] } } },
  ];
  const rings = render();
  expect(rings.map(ring => [ring.center, ring.options.color])).toEqual([[[5, 6], '#FF8800']]);
  expect(mockMarkers.map(marker => marker.label)).toEqual(['Saved arrow']);
});

it('brings the panes to the tip, with the arrow plane, when its ring is pressed', () => {
  mockAnnotations.ArrowAnnotate = [arrow('a-1')];
  render();
  mockMarkers[0].activate();
  expect(onActivate).toHaveBeenCalledWith({ worldPoint: [10, 20, 30], viewPlaneNormal: [0, 0, 1], viewport });
});

it('rings only the tips less than one slice spacing from the slice', () => {
  const at = z => arrow(`z-${z}`, { data: { label: `z ${z}`, handles: { points: [[10, 20, z], [30, 40, z]] } } });
  // A tip on a neighbouring slice (z = 27, 33) is not near this one
  mockAnnotations.ArrowAnnotate = [at(30), at(32), at(27.5), at(33), at(27), at(33.5), at(26)];
  render();
  expect(mockMarkers.map(marker => marker.label)).toEqual(['z 30', 'z 32', 'z 27.5']);
});

describe('the Inspector', () => {
  const camera0 = (viewPlaneNormal, viewUp) => ({ focalPoint: [0, 0, 0], position: viewPlaneNormal.map(x => x * 100), viewPlaneNormal, viewUp });
  const inspector = (camera) => ({
    getCamera: () => ({ ...camera }), setCamera: update => Object.assign(camera, update), render: jest.fn(),
    worldToCanvas: () => [50, 50], canvas: { clientWidth: 100, clientHeight: 100 },
  });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const expectUsable = (camera) => {
    // A unit up in the view's plane
    expect(Math.hypot(...camera.viewUp)).toBeCloseTo(1, 9);
    expect(dot(camera.viewUp, camera.viewPlaneNormal)).toBeCloseTo(0, 9);
  };

  it("turns onto a sagittal arrow's plane from an axial view (90 degrees), at its tip", () => {
    const camera = camera0([0, 0, 1], [0, -1, 0]);
    const view = inspector(camera);
    turnViewOntoArrow({ worldPoint: [10, 20, 30], viewPlaneNormal: [1, 0, 0], viewport: view });
    expect(Math.abs(camera.viewPlaneNormal[0])).toBeCloseTo(1, 9);
    expect(dot(camera.focalPoint, [1, 0, 0])).toBeCloseTo(10, 9);
    expectUsable(camera);
    expect(view.render).toHaveBeenCalled();
  });

  it("turns onto a plane whose normal is the view's up, with an up in the new plane", () => {
    const camera = camera0([0, 0, 1], [0, -1, 0]);
    turnViewOntoArrow({ worldPoint: [10, 20, 30], viewPlaneNormal: [0, 1, 0], viewport: inspector(camera) });
    expect(Math.abs(camera.viewPlaneNormal[1])).toBeCloseTo(1, 9);
    expectUsable(camera);
  });

  it('moves onto the tip without turning when the arrow has no known plane', () => {
    const camera = camera0([0, 0, 1], [0, -1, 0]);
    turnViewOntoArrow({ worldPoint: [10, 20, 30], viewport: inspector(camera) });
    expect(camera.viewPlaneNormal).toEqual([0, 0, 1]);
    expect(camera.focalPoint[2]).toBeCloseTo(30, 9);
  });
});

it("clears a disabled viewport's rings", () => {
  const element = {};
  mockCoreListeners.CORNERSTONE_ELEMENT_DISABLED({ detail: { element } });
  expect(mockCleared).toContain(element);
});
