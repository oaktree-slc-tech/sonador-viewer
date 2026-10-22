import referenceIdentifiers from './referenceIdentifiers';

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
