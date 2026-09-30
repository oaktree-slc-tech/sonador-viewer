// Segmentation table event handlers shared by the segmentation panels

import { attachSegmentationRepresentationTableEvents, c3dSeg2SegmentationTableData } from './cornerstone3dSegmentations';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
const c3dState = { segmentation: null };
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: {
    state: {
      getSegmentation: () => c3dState.segmentation,
      getViewportIdsWithSegmentation: () => ['vp'],
    },
    config: {
      color: { getSegmentIndexColor: (viewportId, segmentationId, idx) => [idx, idx, idx, 255] },
      visibility: { getSegmentationRepresentationVisibility: () => true, getSegmentIndexVisibility: () => true },
      style: { getStyle: () => ({ fillAlpha: 0.5, outlineWidth: 1 }) },
    },
    segmentIndex: { getActiveSegmentIndex: () => 1 },
    segmentLocking: { isSegmentIndexLocked: () => false },
  },
}), { virtual: true });
jest.mock('@cornerstonejs/tools/enums', () => ({ SegmentationRepresentations: { Labelmap: 'Labelmap' } }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    display: { DisplaySetApi: { Instance: { displaySetService: { getDisplaySetByUID: () => undefined } } } },
    utils: { color: { hex2rgb: () => [0, 0, 0] } },
  },
}), { virtual: true });


function segmentationWith(indices) {
  return {
    segmentationId: 'work',
    label: 'Seg',
    segments: Object.fromEntries(indices.map(i => [i, { segmentIndex: i, label: `Segment ${i}`, active: i === 1 }])),
  };
}

function attach() {
  const handlers = {};
  const segmentationService = {
    EVENTS: { SEGMENTATION_REPRESENTATION_MODIFIED: 'rep', SEGMENTATION_STYLE_MODIFIED: 'style' },
    subscribe: jest.fn((event, handler) => { handlers[event] = handler; return { unsubscribe: jest.fn() }; }),
  };
  const setSegmentations = jest.fn();
  const segmentationsRef = { current: [] };
  attachSegmentationRepresentationTableEvents({
    segmentationService,
    setSegmentations,
    segmentationsRef,
    setActiveSegmentationId: jest.fn(),
    segmentationIdRef: { current: 'work' },
    setFillAlphaState: jest.fn(), fillAlphaRef: { current: 0.5 },
    setRenderOutlineWidthState: jest.fn(), outlineWidthRef: { current: 1 },
  }, { logPrefix: 'test' });
  return { fire: () => handlers.rep({ segmentationId: 'work', viewportId: 'vp' }), setSegmentations, segmentationsRef };
}

const rowsOf = tableSeg => Object.keys(tableSeg.representation.segments).map(Number);

describe('attachSegmentationRepresentationTableEvents', () => {
  beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { console.log.mockRestore(); });

  it('regenerates the table when segments were added since the table in the ref was built', () => {
    // The table the ref still holds knows one segment; the segmentation now has three (an import
    // added two and set their colours in the same tick)
    c3dState.segmentation = segmentationWith([1]);
    const { fire, setSegmentations, segmentationsRef } = attach();
    segmentationsRef.current = [c3dSeg2SegmentationTableData(c3dState.segmentation)];
    c3dState.segmentation = segmentationWith([1, 2, 3]);

    fire();

    const [[[tableSeg]]] = setSegmentations.mock.calls;
    expect(rowsOf(tableSeg)).toEqual([1, 2, 3]);
    expect(tableSeg.representation.segments[3].label).toBe('Segment 3');
  });

  it('keeps syncing the existing table when the segment count is unchanged', () => {
    c3dState.segmentation = segmentationWith([1, 2]);
    const { fire, setSegmentations, segmentationsRef } = attach();
    const table = c3dSeg2SegmentationTableData(c3dState.segmentation);
    table.representation.segments[2].visible = false;   // a table-only state the sync must keep
    segmentationsRef.current = [table];
    c3dState.segmentation.segments[2].label = 'Renamed';

    fire();

    const [[[tableSeg]]] = setSegmentations.mock.calls;
    expect(rowsOf(tableSeg)).toEqual([1, 2]);
    expect(tableSeg.representation.segments[2].label).toBe('Renamed');
    expect(tableSeg.representation.segments[2].visible).toBe(false);
  });
});
