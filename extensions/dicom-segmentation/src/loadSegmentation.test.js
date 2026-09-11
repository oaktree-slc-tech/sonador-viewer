// The SEG importer's identity handling (!87 notes 37600/37602/37635): after import there is ONE
// operational segment identity -- the canonical voxel value. Original DICOM segment numbers above
// 255 are remapped reversibly by the planner; the colour LUT, the per-layer membership the panel
// compares against, and the ids handed to the bridge all use the canonical value.

const mockLegacySegmentationState = { series: {}, colorLutTables: {} };
const mockColorLUTSetter = jest.fn((index, lut) => {
  mockLegacySegmentationState.colorLutTables[index] = lut;
});

jest.mock('cornerstone-tools', () => ({
  getModule: () => ({
    state: mockLegacySegmentationState,
    setters: { colorLUT: (...args) => mockColorLUTSetter(...args) },
  }),
}));

jest.mock('dcmjs', () => ({
  data: {
    // Deterministic stand-in: the test only needs to see WHERE the colour lands, not its value.
    Colors: { dicomlab2RGB: () => [0.5, 0.5, 0.5] },
  },
}));

// The bridge surface the importer calls, with the real remap planner behind it -- the planner is
// pure and its placement decisions are exactly what this suite asserts.
const mockCreateCanonicalSegmentation = jest.fn();
const mockCanonicalForSeries = jest.fn(() => []);

jest.mock('@ohif/extension-vtk', () => ({
  cornerstone3dUtils: {
    planSegmentValueRemap: jest.requireActual(
      '../../vtk/src/utils/labelmapOrder.js').planSegmentValueRemap,
    createCanonicalSegmentation: (...args) => mockCreateCanonicalSegmentation(...args),
    getCanonicalSegmentationsForSeries: (...args) => mockCanonicalForSeries(...args),
  },
}), { virtual: true });

const loadSegmentation = require('./loadSegmentation.js').default;

const IMAGE_IDS = ['s0', 's1', 's2'];

function makeSegMetadata() {
  const data = [];
  data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver', ROIDisplayColor: [10, 20, 30] };
  data[300] = { SegmentNumber: 300, SegmentLabel: 'Lesion', ROIDisplayColor: [40, 50, 60] };
  return { data };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLegacySegmentationState.series = {};
  mockLegacySegmentationState.colorLutTables = { 0: [[0, 0, 0, 0]] };

  // As in production: every import registers a canonical segmentation, and the roster the
  // next-index scan consults reflects it -- with or without legacy state.
  const roster = [];
  mockCreateCanonicalSegmentation.mockImplementation(params => {
    roster.push({ segmentationId: params.segmentationId, labelmapIndex: params.labelmapIndex });
  });
  mockCanonicalForSeries.mockImplementation(() => [...roster]);
  global.document = { dispatchEvent: jest.fn() };
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = (init || {}).detail;
    }
  };
});

describe('loadSegmentation identity handling', () => {
  it('hands the bridge canonical layer segments and the reversible remap', async () => {
    const segDisplaySet = {};

    // The layer carries DICOM segments 1 and 300; the planner remaps 300 -> 2.
    await loadSegmentation(
      IMAGE_IDS, segDisplaySet, new Uint16Array(12), makeSegMetadata(), [], [[1, 300]]);

    const call = mockCreateCanonicalSegmentation.mock.calls[0][0];
    expect(call.segmentValueMap).toEqual({ 300: 2 });
    expect(call.layerSegments.sort()).toEqual([1, 2]);

    // The panel compares the clicked (canonical) segment against `labelmapSegments`, so the
    // displaySet carries canonical values too.
    expect(segDisplaySet.labelmapSegments[0].sort()).toEqual([1, 2]);
  });

  it('places a remapped segment colour at its canonical voxel value', async () => {
    await loadSegmentation(
      IMAGE_IDS, {}, new Uint16Array(12), makeSegMetadata(), [], [[1, 300]]);

    // setters.colorLUT received the table AFTER the leading shift; index N in the stored table
    // is voxel value N+1. Segment 1 at table[0], remapped segment 300 -> 2 at table[1].
    const [, storedLUT] = mockColorLUTSetter.mock.calls[0];
    expect(storedLUT[0]).toEqual([10, 20, 30, 255]);
    expect(storedLUT[1]).toEqual([40, 50, 60, 255]);
  });

  it('exposes every layer id and keeps the alias, across two imports', async () => {
    const segDisplaySet = {};
    await loadSegmentation(
      IMAGE_IDS, segDisplaySet, new Uint16Array(12), makeSegMetadata(), [], [[1]]);
    await loadSegmentation(
      IMAGE_IDS, segDisplaySet, new Uint16Array(12), makeSegMetadata(), [], [[300]]);

    expect(segDisplaySet.segmentationIds).toEqual({ 0: 's0_0', 1: 's0_1' });
    expect(segDisplaySet.segmentationId).toBe('s0_1');
    expect(segDisplaySet.labelmapSegments).toEqual({ 0: [1], 1: [2] });
  });

  it('consults the canonical roster for the next labelmap index under lazy legacy install', async () => {
    // No legacy state exists (lazyLegacyLabelmap), but the canonical roster knows index 0 is
    // taken -- the second import must not collide onto it.
    mockCanonicalForSeries.mockImplementation(
      () => [{ segmentationId: 's0_0', labelmapIndex: 0 }]);

    const labelmapIndex = await loadSegmentation(
      IMAGE_IDS, {}, new Uint16Array(12), makeSegMetadata(), [], [[1]]);

    expect(labelmapIndex).toBe(1);
    expect(mockCreateCanonicalSegmentation.mock.calls[0][0].segmentationId).toBe('s0_1');
  });
});
