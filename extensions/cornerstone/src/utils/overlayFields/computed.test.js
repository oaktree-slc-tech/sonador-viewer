import {
  acquisitionMatrix,
  fieldOfView,
  neighbourSliceDistance,
  pixelSpacing,
  reconstructionMatrix,
  sliceGap,
  sliceSpacing,
} from './computed';

const axial = {
  Rows: 256,
  Columns: 512,
  PixelSpacing: [0.9375, 0.46875],
  SliceThickness: 3,
  AcquisitionMatrix: [0, 256, 192, 0],
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  ImagePositionPatient: [-120, -120, 10],
};

const series = [
  { ...axial, ImagePositionPatient: [-120, -120, 0] },
  { ...axial, ImagePositionPatient: [-120, -120, 3.5] },
  axial,
  { ...axial, ImagePositionPatient: [-120, -120, 13.5] },
  { ImagePositionPatient: null },
];

describe('fieldOfView', () => {
  it('multiplies rows and columns by pixel spacing', () => {
    expect(fieldOfView(axial)).toBe('240 x 240 mm');
  });

  it('is empty when an input is missing', () => {
    expect(fieldOfView({ Rows: 256, Columns: 256 })).toBe('');
    expect(fieldOfView({ Rows: 256, PixelSpacing: [1, 1] })).toBe('');
    expect(fieldOfView(undefined)).toBe('');
  });

  it('accepts string-valued DS attributes', () => {
    expect(fieldOfView({ Rows: '256', Columns: '256', PixelSpacing: ['0.5', '0.5'] })).toBe('128 x 128 mm');
  });
});

describe('matrices and spacing', () => {
  it('formats the reconstruction matrix as rows x columns', () => {
    expect(reconstructionMatrix(axial)).toBe('256 x 512');
    expect(reconstructionMatrix({ Rows: 256 })).toBe('');
  });

  it('picks the non-zero frequency and phase entries of the acquisition matrix', () => {
    expect(acquisitionMatrix(axial)).toBe('256 x 192');
    expect(acquisitionMatrix({ AcquisitionMatrix: [128, 0, 0, 96] })).toBe('128 x 96');
    expect(acquisitionMatrix({ AcquisitionMatrix: [0, 0, 0, 0] })).toBe('');
    expect(acquisitionMatrix({ AcquisitionMatrix: [128, 0] })).toBe('');
  });

  it('formats pixel spacing with two decimals', () => {
    expect(pixelSpacing(axial)).toBe('0.94 x 0.47 mm');
    expect(pixelSpacing({})).toBe('');
  });
});

describe('neighbourSliceDistance', () => {
  it('measures the nearest neighbour along the slice normal', () => {
    expect(neighbourSliceDistance(axial, series)).toBeCloseTo(3.5);
  });

  it('ignores the instance itself and instances without a position', () => {
    expect(neighbourSliceDistance(axial, [axial, { Rows: 1 }])).toBeNull();
  });

  it('uses the orientation, not the raw z coordinate', () => {
    const sagittal = { ...axial, ImageOrientationPatient: [0, 1, 0, 0, 0, -1], ImagePositionPatient: [5, 0, 0] };
    const neighbour = { ...sagittal, ImagePositionPatient: [7, 50, 50] };

    expect(neighbourSliceDistance(sagittal, [sagittal, neighbour])).toBeCloseTo(2);
  });

  it('returns null without orientation, position or a series', () => {
    expect(neighbourSliceDistance({ ImagePositionPatient: [0, 0, 0] }, series)).toBeNull();
    expect(neighbourSliceDistance({ ImageOrientationPatient: axial.ImageOrientationPatient }, series)).toBeNull();
    expect(neighbourSliceDistance(axial, undefined)).toBeNull();
  });
});

describe('sliceSpacing and sliceGap', () => {
  it('prefers Spacing Between Slices when declared', () => {
    const declared = { ...axial, SpacingBetweenSlices: 4 };

    expect(sliceSpacing(declared, series)).toBe('4 mm');
    expect(sliceGap(declared, series)).toBe('1 mm');
  });

  it('falls back to the neighbour distance', () => {
    expect(sliceSpacing(axial, series)).toBe('3.5 mm');
    expect(sliceGap(axial, series)).toBe('0.5 mm');
  });

  it('reports a negative gap for overlapping slices', () => {
    expect(sliceGap({ ...axial, SliceThickness: 5 }, series)).toBe('-1.5 mm');
  });

  it('is empty when spacing or thickness cannot be determined', () => {
    expect(sliceSpacing(axial, [axial])).toBe('');
    expect(sliceGap(axial, [axial])).toBe('');
    expect(sliceGap({ ...axial, SliceThickness: undefined }, series)).toBe('');
  });
});
