// The classic viewport's arrow markers: the arrows of the image's series whose tip is less than one
// slice spacing from the image, and that the image does not draw (made on another slice, out-of-plane,
// read-only DICOM-SR), show a ring at their tip, projected onto the image, in their line color; hidden
// arrows and other series' arrows do not; a press on a ring scrolls the stack to the slice nearest the
// tip.

// Axial slices 3 mm apart (z = 0, 3, 6, 9) of series 2.25.1002; one image of another series
const mockPlanes = {};
[0, 1, 2, 3].forEach((index) => {
  mockPlanes[`synthetic:${index}`] = {
    imagePositionPatient: [0, 0, 3 * index], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.7001',
  };
});
mockPlanes['other:0'] = { ...mockPlanes['synthetic:0'] };
// An irregular stack: z = 0, 3, 8, 12
[0, 3, 8, 12].forEach((z) => {
  mockPlanes[`irregular:${z}`] = { ...mockPlanes['synthetic:0'], imagePositionPatient: [0, 0, z] };
});
const mockDisabled = {};
const mockRecords = [];
const mockSRAnnotations = [];
const mockToolState = {};
const mockDrawn = [];
const mockScroll = jest.fn();

jest.mock('cornerstone-core', () => ({
  EVENTS: { ELEMENT_DISABLED: 'cornerstoneelementdisabled' },
  events: { addEventListener: (name, fn) => { mockDisabled[name] = fn; } },
  metaData: {
    get: (type, imageId) => (type === 'generalSeriesModule'
      ? { seriesInstanceUID: imageId.startsWith('other:') ? '2.25.2002' : '2.25.1002' } : undefined),
  },
  // Canvas pixels: twice the image pixels
  pixelToCanvas: (element, { x, y }) => ({ x: 2 * x, y: 2 * y }),
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  importInternal: (name) => ({
    'base/BaseTool': class { constructor(props) { Object.assign(this, props); } },
    'drawing/drawCircle': (context, element, center, radius, options) => mockDrawn.push({ center, radius, options }),
    'drawing/getNewContext': () => ({}),
    'util/scrollToIndex': (...args) => mockScroll(...args),
  })[name],
  getToolState: (element, name) => mockToolState[name],
  toolColors: { getToolColor: () => 'rgb(255, 255, 0)' },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      arrowGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/arrowGeometry'),
      srDisplayAnnotations: { getSRDisplayAnnotations: () => mockSRAnnotations },
    },
    displayAttributes: { getLineTextColor: carrier => ({ line: ((carrier.displayAttributes || carrier).Color || {}).Line || null }) },
    measurements: { MeasurementApi: { Instance: { measurementService: { getMeasurements: () => mockRecords } } } },
  },
}), { virtual: true });
jest.mock('./imagePlaneOf', () => ({ __esModule: true, default: imageId => mockPlanes[imageId] }));
jest.mock('../components/ArrowMarkerTooltip', () => ({ ensureArrowMarkerTooltip: () => {} }));

import ArrowMarkerTool from './ArrowMarkerTool';
import { arrowMarkerAt, subscribeArrowMarkerHover } from '../utils/arrowMarkers';

const tool = new ArrowMarkerTool();
const canvas = { width: 400, clientWidth: 200, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const element = { addEventListener: () => {} };

function render(imageId) {
  mockDrawn.length = 0;
  tool.renderToolData({ detail: { element, image: { imageId }, canvasContext: { canvas } } });
  return mockDrawn;
}

const STACK = ['synthetic:0', 'synthetic:1', 'synthetic:2', 'synthetic:3'];

beforeEach(() => {
  mockRecords.length = 0;
  mockSRAnnotations.length = 0;
  Object.keys(mockToolState).forEach(key => delete mockToolState[key]);
  mockToolState.stack = { data: [{ imageIds: STACK, currentImageIdIndex: 0 }] };
  mockScroll.mockClear();
});

const arrow = (extra = {}) => ({
  uid: 'arrow-1', toolName: 'ArrowAnnotate', label: 'Lesion margin', metadata: { text: 'Lesion margin' },
  referencedImageId: 'synthetic:3', referenceSeriesUID: '2.25.1002', points: [{ x: 10.5, y: 20.5 }, { x: 30.5, y: 40.5 }],
  displayAttributes: { Color: { Line: '#FF8800' } },
  ...extra,
});
// An arrow drawn out-of-plane, its tip at z
const outOfPlane = (z, extra = {}) => arrow({
  referencedImageId: undefined, referenceSeriesUID: undefined, points: [[12, 0, z], [12, 30, z]],
  metadata: { outOfPlane: true, sourceSeries: '2.25.1002', text: 'Out of plane' }, ...extra,
});
const slicesWithRings = () => STACK.filter(imageId => render(imageId).length > 0);

it('rings a tip on the slices less than one slice spacing from it, in its line color, projected onto them', () => {
  mockRecords.push(outOfPlane(7));
  // z = 7 falls between the slices at z = 6 and z = 9
  expect(slicesWithRings()).toEqual(['synthetic:2', 'synthetic:3']);
  // Patient (12, 0) is image (12.5, 0.5) (the centre of the first pixel is (0.5, 0.5)): canvas (25, 1)
  const [ring] = render('synthetic:2');
  expect(ring.center).toEqual({ x: 25, y: 1 });
  expect(ring.options.color).toBe('#FF8800');
  // Recorded in CSS pixels (half the canvas pixels), with the label shown on hover
  expect(arrowMarkerAt(element, 12.5, 0.5).marker.label).toBe('Out of plane');
});

it('rings a tip lying on a slice there only, and an arrow its slice draws nowhere', () => {
  mockRecords.push(outOfPlane(6));
  expect(slicesWithRings()).toEqual(['synthetic:2']);
  // Drawn on the slice at z = 9; its neighbours are one slice spacing away
  mockRecords.splice(0, 1, arrow());
  expect(slicesWithRings()).toEqual([]);
});

it('draws nothing for an arrow the image draws, a hidden arrow, or an arrow of another series', () => {
  mockToolState.ArrowAnnotate = { data: [{ uid: 'arrow-1' }] };
  mockRecords.push(outOfPlane(1));
  expect(render('synthetic:0')).toEqual([]);
  delete mockToolState.ArrowAnnotate;
  mockRecords.splice(0, 1, outOfPlane(1, { isVisible: false }));
  expect(render('synthetic:0')).toEqual([]);
  mockRecords.splice(0, 1, outOfPlane(1));
  expect(render('other:0')).toEqual([]);
  expect(render('synthetic:0')).toHaveLength(1);
});

it.each([
  ['ascending', ['irregular:0', 'irregular:3', 'irregular:8', 'irregular:12']],
  ['descending', ['irregular:12', 'irregular:8', 'irregular:3', 'irregular:0']],
])('rings both slices bracketing a tip in an irregular %s stack, and only the slice a tip lies on', (order, imageIds) => {
  mockToolState.stack = { data: [{ imageIds, currentImageIdIndex: 0 }] };
  const ringed = () => imageIds.filter(imageId => render(imageId).length > 0).sort();
  // z = 6.5 lies between the slices at 3 and 8 mm (5 mm apart): 3.5 mm from one, 1.5 mm from the other
  mockRecords.push(outOfPlane(6.5));
  expect(ringed()).toEqual(['irregular:3', 'irregular:8']);
  mockRecords.splice(0, 1, outOfPlane(8));
  expect(ringed()).toEqual(['irregular:8']);
  // Past the end of the stack: the spacing to the last slice's neighbour stands in
  mockRecords.splice(0, 1, outOfPlane(14));
  expect(ringed()).toEqual(['irregular:12']);
});

it("clears a disabled element's rings and its hover", () => {
  mockRecords.push(outOfPlane(0));
  const hovers = [];
  const unsubscribe = subscribeArrowMarkerHover(hover => hovers.push(hover));
  render('synthetic:0');
  expect(arrowMarkerAt(element, 12.5, 0.5)).not.toBeNull();
  mockDisabled.cornerstoneelementdisabled({ detail: { element } });
  expect(arrowMarkerAt(element, 12.5, 0.5)).toBeNull();
  unsubscribe();
});

it('rings a read-only DICOM-SR arrow near the slice', () => {
  mockSRAnnotations.push({
    annotationUID: 'sr-1', isVisible: true,
    data: {
      TrackingIdentifier: 'cornerstoneTools@^4.0.0:ArrowAnnotate', referencedImageId: 'synthetic:2',
      handles: { points: [[5, 6, 6]] }, labels: [{ label: 'CORNERSTONEFREETEXT', value: 'Saved arrow' }], displayColor: {},
    },
  });
  // Placed on the slice at z = 6, which draws it
  expect(slicesWithRings()).toEqual([]);
  mockSRAnnotations[0].data.handles.points = [[5, 6, 7.5]];
  expect(slicesWithRings()).toEqual(['synthetic:3']);
  render('synthetic:3');
  expect(arrowMarkerAt(element, 5.5, 6.5).marker.label).toBe('Saved arrow');
});

it('scrolls the stack to the slice nearest the tip when its ring is pressed', () => {
  mockRecords.push(outOfPlane(7));
  render('synthetic:3');
  arrowMarkerAt(element, 12.5, 0.5).marker.activate();
  expect(mockScroll).toHaveBeenCalledWith(element, 2);
});
