/**
 * @jest-environment jsdom
 */
import referenceIdentifiers from './referenceIdentifiers';
import utils from './index';

// The utils index pulls the Cornerstone3D loaders in, which this package's jest cannot resolve
// (their `exports` maps); none of them is exercised here
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, cache: {}, metaData: {}, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });

const storeWith = ({ instances = {}, series = {} }) => ({
  getInstance: (study, seriesUid, sop) => instances[sop],
  getSeries: (study, seriesUid) => series[seriesUid],
});

describe('referenceIdentifiers', () => {
  it('reads the referenced instance', () => {
    const store = storeWith({ instances: { sop1: { SeriesNumber: 3, Modality: 'CT', InstanceNumber: 12 } }, series: { s1: { instances: [] } } });
    expect(referenceIdentifiers(store, { SeriesInstanceUID: 's1', SOPInstanceUID: 'sop1' }))
      .toEqual({ SeriesNumber: 3, Modality: 'CT', InstanceNumber: 12, SeriesDescription: undefined });
  });

  it('uses series summary metadata when no instance has loaded', () => {
    const store = storeWith({ series: { s1: { SeriesNumber: 5, Modality: 'MR', SeriesDescription: 'T1', instances: [] } } });
    expect(referenceIdentifiers(store, { SeriesInstanceUID: 's1', SOPInstanceUID: 'missing' }))
      .toEqual({ SeriesNumber: 5, Modality: 'MR', SeriesDescription: 'T1', InstanceNumber: undefined });
  });

  it('falls back to the first instance of the series', () => {
    const store = storeWith({ series: { s1: { instances: [{ SeriesNumber: 7, Modality: 'US' }] } } });
    expect(referenceIdentifiers(store, { SeriesInstanceUID: 's1' })).toMatchObject({ SeriesNumber: 7, Modality: 'US' });
  });

  it('returns null for an unknown reference', () => {
    expect(referenceIdentifiers(storeWith({}), { SeriesInstanceUID: 's1' })).toBeNull();
    expect(referenceIdentifiers(storeWith({}), {})).toBeNull();
    expect(referenceIdentifiers(null, { SeriesInstanceUID: 's1' })).toBeNull();
  });
});

describe('utils.referenceIdentifiers', () => {
  it('is reachable through the utils object the viewer and the extensions read (OHIF.utils)', () => {
    // The measurement table and the Series Tag tooltip call it through `OHIF.utils` /
    // `import { utils }`, which is this object, not the module's named exports
    expect(utils.referenceIdentifiers).toBe(referenceIdentifiers);
  });
});
