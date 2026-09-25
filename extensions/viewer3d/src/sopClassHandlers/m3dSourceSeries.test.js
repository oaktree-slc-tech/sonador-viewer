// The imaging series a 3D model series was made from (ohif-viewers#143, FR-5)

import { findM3DSourceDisplaySet, getM3DSourceSeriesUID } from './m3dSourceSeries';


const FOR = '1.2.840.for';
const m3d = (metadata = {}) => ({
  metadata: {
    FrameOfReferenceUID: FOR,
    ReferencedSeriesSequence: [{ SeriesInstanceUID: 'mr-series', ReferencedInstanceSequence: [] }],
    ...metadata,
  },
});
const series = (overrides = {}) => ({
  SeriesInstanceUID: 'mr-series',
  Modality: 'MR',
  isReconstructable: true,
  images: [{ getData: () => ({ metadata: { FrameOfReferenceUID: FOR } }) }],
  ...overrides,
});

describe('getM3DSourceSeriesUID', () => {
  it('reads ReferencedSeriesSequence', () => {
    expect(getM3DSourceSeriesUID(m3d())).toBe('mr-series');
    expect(getM3DSourceSeriesUID(m3d({ ReferencedSeriesSequence: { SeriesInstanceUID: 'one' } }))).toBe('one');
    expect(getM3DSourceSeriesUID(m3d({ ReferencedSeriesSequence: undefined }))).toBeUndefined();
  });
});

describe('findM3DSourceDisplaySet', () => {
  it('finds the referenced CT/MR volume in the same frame of reference', () => {
    const source = series();
    expect(findM3DSourceDisplaySet(m3d(), [series({ SeriesInstanceUID: 'other' }), source])).toBe(source);
  });

  it('ignores series that cannot be segmented', () => {
    expect(findM3DSourceDisplaySet(m3d(), [series({ isReconstructable: false })])).toBeUndefined();
    expect(findM3DSourceDisplaySet(m3d(), [series({ Modality: 'SEG' })])).toBeUndefined();
  });

  it('ignores a series in another frame of reference', () => {
    const other = series({ images: [{ getData: () => ({ metadata: { FrameOfReferenceUID: 'x' } }) }] });
    expect(findM3DSourceDisplaySet(m3d(), [other])).toBeUndefined();
  });

  it('finds nothing without a reference', () => {
    expect(findM3DSourceDisplaySet(m3d({ ReferencedSeriesSequence: undefined }), [series()])).toBeUndefined();
    expect(findM3DSourceDisplaySet(undefined, [series()])).toBeUndefined();
  });
});
