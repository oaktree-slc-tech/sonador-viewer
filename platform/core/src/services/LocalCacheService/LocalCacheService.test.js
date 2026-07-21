// Unit tests for LocalCacheService's index bookkeeping (ohif-viewers#125).
//
// jsdom provides no `indexedDB`, so the service constructor takes its documented degraded path:
// no idb-keyval stores are created and every persistence call is skipped. What remains is exactly
// the synchronous in-memory logic the render paths depend on (getImageId cannot await), which is
// what these tests exercise: membership sets, byte accounting, summaries, search, and events.
// Byte round-trips through real IndexedDB were verified separately with a Node harness.

import LocalCacheService from './LocalCacheService';

// Jest 29 runs in a node environment (jest-environment-jsdom is not installed in this repo).
// PubSubService._broadcastEvent additionally mirrors every event onto `document.body` as a
// CustomEvent; shim just enough of that for broadcasts to run — subscriber callbacks themselves
// are plain function calls and need no DOM. (Import-time service construction does not broadcast,
// so ordering after the import is safe.)
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const STUDY = '1.2.826.0.1.999.1';
const SERIES_A = '1.2.826.0.1.999.1.1';
const SERIES_B = '1.2.826.0.1.999.1.2';

function makeInstance(SOPInstanceUID, { SeriesInstanceUID = SERIES_A, byteLength = 100, metadata = {} } = {}) {
  return {
    StudyInstanceUID: STUDY,
    SeriesInstanceUID,
    SOPInstanceUID,
    bytes: new ArrayBuffer(byteLength),
    metadata: {
      StudyInstanceUID: STUDY,
      SeriesInstanceUID,
      SOPInstanceUID,
      // Naturalized PN values arrive as an ARRAY of person-name objects.
      PatientName: [{ Alphabetic: 'Doe^Jane' }],
      PatientID: 'PID-1',
      StudyDescription: 'CT CHEST W/O CONTRAST',
      AccessionNumber: 'ACC-9',
      ServiceEpisodeID: 'SEID-42',
      SeriesDescription: 'Axial 2mm',
      SeriesNumber: 1,
      Modality: 'CT',
      ...metadata,
    },
  };
}

describe('LocalCacheService (in-memory index)', () => {
  beforeEach(async () => {
    await LocalCacheService.ready();
    await LocalCacheService.clearAll();
  });

  it('starts empty', () => {
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
  });

  it('putInstance updates synchronous membership at study/series/instance level', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(true);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(true);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(true);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([STUDY]);
  });

  it('builds a study summary with unwrapped PatientName and byte totals', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 100 }));
    await LocalCacheService.putInstance(makeInstance('sop-2', { byteLength: 150 }));

    const summary = LocalCacheService.getStudySummary(STUDY);
    expect(summary).toMatchObject({
      PatientName: 'Doe^Jane',
      PatientID: 'PID-1',
      AccessionNumber: 'ACC-9',
      ServiceEpisodeID: 'SEID-42',
      seriesCount: 1,
      instanceCount: 2,
      totalBytes: 250,
      modalities: 'CT',
    });
  });

  it('re-caching the same instance does not double-count bytes (AC-4)', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 100 }));
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 120 }));

    const summary = LocalCacheService.getStudySummary(STUDY);
    expect(summary.instanceCount).toBe(1);
    expect(summary.totalBytes).toBe(120);
  });

  it('sorts per-series summaries numerically by SeriesNumber', async () => {
    await LocalCacheService.putInstance(
      makeInstance('sop-b', { SeriesInstanceUID: SERIES_B, metadata: { SeriesNumber: 10, SeriesDescription: 'Coronal' } })
    );
    await LocalCacheService.putInstance(makeInstance('sop-a', { metadata: { SeriesNumber: 2 } }));

    const series = LocalCacheService.getStudySeriesSummaries(STUDY);
    expect(series.map(s => s.SeriesNumber)).toEqual([2, 10]);
  });

  it('searchCachedStudies matches study- and series-level fields, case-insensitively (AC-9)', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    expect(LocalCacheService.searchCachedStudies('doe^jane')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('acc-9')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('axial')).toHaveLength(1); // SeriesDescription
    expect(LocalCacheService.searchCachedStudies(SERIES_A)).toHaveLength(1); // Series UID
    expect(LocalCacheService.searchCachedStudies('seid-42')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('no-such-value')).toHaveLength(0);
    expect(LocalCacheService.searchCachedStudies('')).toHaveLength(1); // empty term returns all
  });

  it('removeInstance prunes empty series/studies and broadcasts INSTANCE_REMOVED', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    const removed = [];
    const sub = LocalCacheService.subscribe(
      LocalCacheService.EVENTS.INSTANCE_REMOVED,
      payload => removed.push(payload.SOPInstanceUID)
    );

    await LocalCacheService.removeInstance(STUDY, SERIES_A, 'sop-1');
    sub.unsubscribe();

    expect(removed).toEqual(['sop-1']);
    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(false);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(false);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
    expect(LocalCacheService.getStudySummary(STUDY)).toBeNull();
  });

  it('removeStudy removes every series and emits INSTANCE_REMOVED per instance', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));
    await LocalCacheService.putInstance(makeInstance('sop-2', { SeriesInstanceUID: SERIES_B }));

    const removed = [];
    const sub = LocalCacheService.subscribe(
      LocalCacheService.EVENTS.INSTANCE_REMOVED,
      payload => removed.push(payload.SOPInstanceUID)
    );

    await LocalCacheService.removeStudy(STUDY);
    sub.unsubscribe();

    expect(removed.sort()).toEqual(['sop-1', 'sop-2']);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
  });

  it('clearAll empties membership and broadcasts CACHE_CLEARED', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    let cleared = false;
    const sub = LocalCacheService.subscribe(LocalCacheService.EVENTS.CACHE_CLEARED, () => {
      cleared = true;
    });

    await LocalCacheService.clearAll();
    sub.unsubscribe();

    expect(cleared).toBe(true);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(false);
  });
});
