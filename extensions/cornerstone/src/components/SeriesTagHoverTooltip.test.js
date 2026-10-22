jest.mock('@ohif/ui-next', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ getToolForElement: (element) => element.tool }), { virtual: true });
jest.mock('cornerstone-core', () => ({
  EVENTS: { IMAGE_RENDERED: 'cornerstoneimagerendered', NEW_IMAGE: 'cornerstonenewimage' },
  getEnabledElement: element => element.enabled,
}), { virtual: true });
jest.mock('../state', () => ({ getEnabledElement: () => null }));

const mockStore = {
  instances: {
    'image:1': { StudyInstanceUID: 'study', SeriesInstanceUID: 'series-1', SOPInstanceUID: 'sop-1', SeriesNumber: 4, Modality: 'CT' },
    'image:3': { StudyInstanceUID: 'study', SeriesInstanceUID: 'series-3', SOPInstanceUID: 'sop-3', SeriesNumber: 9, Modality: 'PT' },
  },
  series: {
    'series-1': { SeriesNumber: 4, Modality: 'CT', instances: [] },
    'series-2': { SeriesNumber: 2, Modality: 'MR', instances: [] },
    'series-3': { SeriesNumber: 9, Modality: 'PT', instances: [] },
  },
};
jest.mock('@ohif/core', () => ({
  displayAttributes: jest.requireActual('../../../../platform/core/src/displayAttributes'),
  utils: { referenceIdentifiers: jest.requireActual('../../../../platform/core/src/utils/referenceIdentifiers').default },
  DicomMetadataStore: {
    getInstanceByImageId: imageId => mockStore.instances[imageId],
    getInstance: (study, series, sop) => Object.values(mockStore.instances).find(i => i.SOPInstanceUID === sop),
    getSeries: (study, series) => mockStore.series[series],
  },
}));

const { seriesTagDetails, seriesIdentifiers, tooltipState } = require('./SeriesTagHoverTooltip');

const viewport = ({ data, region = { left: 100, top: 400, right: 200, bottom: 430 }, imageId = 'image:1' }) => {
  const element = {
    enabled: { image: { imageId } },
    tool: { getTagAtCanvasPoint: () => (data ? { ...region, data } : null) },
    querySelector: () => ({ width: 1000, height: 800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }) }),
  };
  return element;
};
const POINT = { clientX: 75, clientY: 205 };

describe('seriesTagDetails', () => {
  it('returns the tag text when a description is present', () => {
    expect(seriesTagDetails({ value: 'RID1301', text: 'Lung', description: 'Upper lobe', metadata: { location: 'Left' } }))
      .toEqual({ value: 'RID1301', meaning: 'Lung', description: 'Upper lobe', location: 'Left',
        color: { Background: null, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' } });
    expect(seriesTagDetails({ value: 'RID1301', metadata: { text: 'Lung', description: 'Upper lobe' } }).meaning).toBe('Lung');
  });

  it('carries the finding colors for the value and meaning', () => {
    const details = seriesTagDetails({ value: 'A', text: 'B', description: 'C', displayAttributes: { Color: { Value: '#FF0000', Meaning: '#0000FF' } } });
    expect([details.color.Value, details.color.Meaning]).toEqual(['#FF0000', '#0000FF']);
  });

  it('offers no tooltip without a description', () => {
    expect(seriesTagDetails({ value: 'RID1301', text: 'Lung', metadata: { location: 'Left' } })).toBeNull();
    expect(seriesTagDetails({ value: 'RID1301', text: 'Lung', description: '' })).toBeNull();
    expect(seriesTagDetails(null)).toBeNull();
  });
});

describe('seriesIdentifiers', () => {
  it('reads the series of the displayed image', () => {
    expect(seriesIdentifiers(viewport({}), {})).toEqual({ seriesNumber: 4, modality: 'CT' });
  });

  it('uses series summary metadata for the series the tag references', () => {
    expect(seriesIdentifiers({ enabled: undefined }, { metadata: { SeriesInstanceUID: 'series-2' } })).toEqual({ seriesNumber: 2, modality: 'MR' });
    expect(seriesIdentifiers({ enabled: undefined }, {})).toBeNull();
  });
});

describe('tooltipState', () => {
  it('maps the tag region from canvas to client pixels', () => {
    const state = tooltipState(viewport({ data: { value: 'A', description: 'First' } }), POINT);
    expect(state.rect).toEqual({ left: 50, top: 200, width: 50, height: 15 });
    expect(state.series).toEqual({ seriesNumber: 4, modality: 'CT' });
  });

  it('reflects an in-place edit of the hovered tag', () => {
    const data = { value: 'A', description: 'First' };
    const element = viewport({ data });
    expect(tooltipState(element, POINT).details.description).toBe('First');
    data.description = 'Edited';
    expect(tooltipState(element, POINT).details.description).toBe('Edited');
  });

  it('is cleared when the tag is removed, loses its description, or the pointer leaves', () => {
    expect(tooltipState(viewport({ data: null }), POINT)).toBeNull();
    expect(tooltipState(viewport({ data: { value: 'A' } }), POINT)).toBeNull();
    expect(tooltipState(viewport({ data: { value: 'A', description: 'B' } }), null)).toBeNull();
  });

  it('follows a moved region and a replaced series', () => {
    const data = { value: 'A', description: 'B' };
    const moved = tooltipState(viewport({ data, region: { left: 0, top: 0, right: 40, bottom: 20 } }), POINT);
    expect(moved.rect).toEqual({ left: 0, top: 0, width: 20, height: 10 });

    const replaced = tooltipState(viewport({ data, imageId: 'image:3' }), POINT);
    expect(replaced.series).toEqual({ seriesNumber: 9, modality: 'PT' });
  });
});
