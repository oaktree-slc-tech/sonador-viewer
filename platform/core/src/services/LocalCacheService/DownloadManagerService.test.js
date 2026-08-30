// Unit tests for the offline-cache download queue's transfer modes (ohif-viewers#129) and its
// series-scoped jobs (ohif-viewers#130).
//
// What is covered here is what the run loop owns and the transfer module does not: the per-series
// fan-out, the already-cached skip, the retry-then-fall-back-to-per-instance path, the roll-up of
// series counters into the study-scoped `progress` every existing consumer reads, and the
// cancellation cleanup. Extraction itself is covered in seriesArchiveTransfer.test.js.
//
// Enumeration is stubbed at StaticWadoClient, which is the module both `_enumerateInstances` and
// `_makeWadoClient` construct -- so one mock covers QIDO, series metadata, and the per-instance
// WADO-RS retrieve the fallback uses.

import { zipSync } from 'fflate';
import dcmjs from 'dcmjs';

import user from '../../user.js';
import LocalCacheService from './LocalCacheService';
import DownloadManagerService, { JOB_STATES, TRANSFER_MODES } from './DownloadManagerService';

jest.mock('../../studies/services/qido/StaticWadoClient', () => {
  // One shared double: the service constructs it twice per job (enumeration + WADO-RS) and both
  // are driven from the same script.
  const script = {
    series: [],
    instancesBySeries: {},
    retrieveInstance: null,
  };

  class StaticWadoClientStub {
    constructor(config) {
      this.config = config;
      this.wadoURL = config.url;
    }

    async searchForSeries() {
      return script.series;
    }

    async retrieveSeriesMetadata({ seriesInstanceUID }) {
      return script.instancesBySeries[seriesInstanceUID] || [];
    }

    async _httpGetMultipartApplicationDicom(url) {
      return [await script.retrieveInstance(url)];
    }
  }

  StaticWadoClientStub.__script = script;

  return { __esModule: true, default: StaticWadoClientStub };
});

// eslint-disable-next-line import/first
import StaticWadoClient from '../../studies/services/qido/StaticWadoClient';

const script = StaticWadoClient.__script;

// Jest 29 runs in a node environment here; PubSubService mirrors every event onto document.body.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const SERVER = { wadoRoot: 'https://example.test/dicom-web', qidoRoot: 'https://example.test/dicom-web' };
const STUDY = '1.2.826.0.1.3680043.777.1';
const SERIES_A = `${STUDY}.1`;
const SERIES_B = `${STUDY}.2`;

// SOP UIDs must be genuine dotted-numeric UIDs: dcmjs applies UI value formatting on write, so a
// placeholder like 'a1' does not survive the round trip through a real Part 10 stream.
const A1 = `${SERIES_A}.1`;
const A2 = `${SERIES_A}.2`;
const B1 = `${SERIES_B}.1`;
const B2 = `${SERIES_B}.2`;

function part10(SOPInstanceUID, SeriesInstanceUID) {
  const { DicomDict, DicomMetaDictionary } = dcmjs.data;
  const dict = new DicomDict({
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00020003': { vr: 'UI', Value: [SOPInstanceUID] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
  });
  dict.dict = DicomMetaDictionary.denaturalizeDataset({
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    SOPInstanceUID,
    StudyInstanceUID: STUDY,
    SeriesInstanceUID,
    Modality: 'CT',
    SeriesNumber: SeriesInstanceUID === SERIES_A ? 1 : 2,
    PatientName: 'Doe^Jane',
    // Group 0028 sits AFTER the identity parse cutoff (0020,0013), so these are what prove an
    // archive-only instance was re-read deeply enough to be describable rather than merely
    // identifiable.
    Rows: 64,
    Columns: 64,
    BitsAllocated: 16,
    PhotometricInterpretation: 'MONOCHROME2',
  });
  return new Uint8Array(dict.write());
}

/** QIDO/WADO-RS shaped enumeration for two series of two instances each. */
function scriptTwoSeries() {
  script.series = [
    { '0020000E': { Value: [SERIES_A] }, '00200011': { Value: [1] }, '00080060': { Value: ['CT'] } },
    { '0020000E': { Value: [SERIES_B] }, '00200011': { Value: [2] }, '00080060': { Value: ['CT'] } },
  ];
  script.instancesBySeries = {
    [SERIES_A]: [instanceJson(A1, SERIES_A), instanceJson(A2, SERIES_A)],
    [SERIES_B]: [instanceJson(B1, SERIES_B), instanceJson(B2, SERIES_B)],
  };
  script.retrieveInstance = async url => {
    const sop = url.split('/').pop();
    return part10(sop, url.includes(SERIES_A) ? SERIES_A : SERIES_B).buffer;
  };
}

function instanceJson(sop, seriesUid) {
  return {
    '00080018': { vr: 'UI', Value: [sop] },
    '0020000D': { vr: 'UI', Value: [STUDY] },
    '0020000E': { vr: 'UI', Value: [seriesUid] },
    '00080060': { vr: 'CS', Value: ['CT'] },
    '00200011': { vr: 'IS', Value: [seriesUid === SERIES_A ? 1 : 2] },
  };
}

/** Stream an archive built from an explicit member map (contents need not match enumeration). */
function archiveWithMembers(members, { headers = {} } = {}) {
  return streamArchive(zipSync(members, { level: 0 }), { headers });
}

function archiveFor(seriesUid, { headers = {}, onChunk } = {}) {
  const sops = seriesUid === SERIES_A ? [A1, A2] : [B1, B2];
  const members = {};
  sops.forEach((sop, index) => {
    members[`IM${index}`] = part10(sop, seriesUid);
  });
  return streamArchive(zipSync(members, { level: 0 }), { headers, onChunk });
}

function streamArchive(bytes, { headers = {}, onChunk } = {}) {
  let offset = 0;
  let chunkIndex = 0;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: name => headers[name] ?? null },
    text: async () => '',
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.length) {
            return { done: true };
          }
          const value = bytes.slice(offset, offset + 128);
          offset += 128;
          onChunk?.(chunkIndex++);
          return { done: false, value };
        },
        cancel: async () => {},
      }),
    },
    __size: bytes.length,
  };
}

/**
 * Park every per-instance retrieve until the test releases it, so a job can be held mid-flight.
 * Cancellation is cooperative (checked between instances), so the parked retrieves must be settled
 * for the run loop to unwind -- a stub that simply never answered would strand the job.
 */
function parkRetrieves() {
  const previous = script.retrieveInstance;
  const settlers = [];
  script.retrieveInstance = () =>
    new Promise((resolve, reject) => settlers.push({ resolve, reject }));

  return {
    // Restores the working retrieve before settling the parked ones, so a job that starts AFTER
    // this one unwinds is not itself parked forever.
    releaseAll: () => {
      script.retrieveInstance = previous;
      settlers.splice(0).forEach(settler => settler.reject(new Error('request aborted')));
    },
  };
}

async function waitFor(predicate, label = 'condition') {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForTerminal(jobId, label = 'the job to finish') {
  for (let i = 0; i < 400; i += 1) {
    const job = DownloadManagerService.getJob(jobId);
    if (job && [JOB_STATES.COMPLETED, JOB_STATES.CANCELLED, JOB_STATES.ERROR].includes(job.state)) {
      return job;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(async () => {
  await LocalCacheService.ready();
  await LocalCacheService.clearAll();
  DownloadManagerService.cancelAllActive();
  await waitFor(
    () => DownloadManagerService.listJobs().every(job => job.state !== JOB_STATES.DOWNLOADING),
    'the queue to drain between tests'
  );
  DownloadManagerService.listJobs().forEach(job => DownloadManagerService.dismiss(job.id));
  DownloadManagerService.setArchiveTransferEnabled(false);
  user.getAccessToken = () => 'test-token';
  scriptTwoSeries();
});

afterEach(() => {
  delete global.fetch;
  user.getAccessToken = () => null;
});

describe('transfer mode selection (FR-1)', () => {
  it('defaults to per-instance transfer and issues no archive request', async () => {
    global.fetch = jest.fn();

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.state).toBe(JOB_STATES.COMPLETED);
    expect(job.transferMode).toBe(TRANSFER_MODES.INSTANCES);
    expect(job.series).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(job.progress).toEqual({ total: 4, completed: 4, failed: 0 });
  });

  it('resolves the mode when the job starts, so a later preference change does not alter it', async () => {
    DownloadManagerService.setArchiveTransferEnabled(true);
    global.fetch = jest.fn(async url => archiveFor(url.includes(SERIES_A) ? SERIES_A : SERIES_B));

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    DownloadManagerService.setArchiveTransferEnabled(false);
    await waitForTerminal(job.id);

    expect(job.transferMode).toBe(TRANSFER_MODES.ARCHIVES);
  });
});

describe('archive mode (FR-2, FR-11, AR-2)', () => {
  beforeEach(() => {
    DownloadManagerService.setArchiveTransferEnabled(true);
  });

  it('fans out one archive request per series and caches every instance', async () => {
    global.fetch = jest.fn(async url => archiveFor(url.includes(SERIES_A) ? SERIES_A : SERIES_B));

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.state).toBe(JOB_STATES.COMPLETED);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${SERVER.wadoRoot}/series/${SERIES_A}/archive`,
      `${SERVER.wadoRoot}/series/${SERIES_B}/archive`,
    ]);
    expect([A1, A2, B1, B2].every(sop => LocalCacheService.isInstanceCachedSync(sop))).toBe(true);
    expect(job.series.map(s => s.state)).toEqual(['complete', 'complete']);
    expect(job.series.every(s => s.path === 'archive')).toBe(true);
  });

  it('renders as an instance-count job for a consumer that only reads progress (AR-2)', async () => {
    global.fetch = jest.fn(async url => archiveFor(url.includes(SERIES_A) ? SERIES_A : SERIES_B));

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.progress).toEqual({ total: 4, completed: 4, failed: 0 });
  });

  it('issues no request for a series whose instances are already cached (FR-11)', async () => {
    await Promise.all(
      [A1, A2].map(sop =>
        LocalCacheService.putInstance({
          StudyInstanceUID: STUDY,
          SeriesInstanceUID: SERIES_A,
          SOPInstanceUID: sop,
          bytes: new ArrayBuffer(8),
          metadata: { StudyInstanceUID: STUDY, SeriesInstanceUID: SERIES_A, SOPInstanceUID: sop },
        })
      )
    );

    global.fetch = jest.fn(async () => archiveFor(SERIES_B));

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(SERIES_B);
    expect(job.progress.completed).toBe(4);
  });

  it('reports the byte aggregate only when every series reported a size (FR-7)', async () => {
    global.fetch = jest.fn(async url =>
      archiveFor(url.includes(SERIES_A) ? SERIES_A : SERIES_B, {
        headers: { 'Content-Length': '4096' },
      })
    );

    const sized = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(sized.id);
    expect(sized.totalBytes).toBe(8192);
    expect(sized.bytesReceived).toBeGreaterThan(0);

    await LocalCacheService.clearAll();
    // One series answers chunked: the aggregate falls back to counts rather than reporting a
    // denominator that describes only half the transfer.
    global.fetch = jest.fn(async url =>
      url.includes(SERIES_A)
        ? archiveFor(SERIES_A, { headers: { 'Content-Length': '4096' } })
        : archiveFor(SERIES_B)
    );

    const mixed = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(mixed.id);
    expect(mixed.totalBytes).toBeNull();
    expect(mixed.progress.completed).toBe(4);
  });
});

describe('archive failure handling (FR-9)', () => {
  beforeEach(() => {
    DownloadManagerService.setArchiveTransferEnabled(true);
  });

  it('retries once, then falls back to per-instance retrieval for that series only', async () => {
    const attempts = [];
    global.fetch = jest.fn(async url => {
      attempts.push(url);
      if (url.includes(SERIES_A)) {
        return {
          ok: false,
          status: 500,
          statusText: 'Server Error',
          headers: { get: () => null },
          text: async () => 'packing failed',
        };
      }
      return archiveFor(SERIES_B);
    });

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    // Two attempts at the failing series, one at the healthy one.
    expect(attempts.filter(url => url.includes(SERIES_A))).toHaveLength(2);
    expect(attempts.filter(url => url.includes(SERIES_B))).toHaveLength(1);

    expect(job.state).toBe(JOB_STATES.COMPLETED);
    expect(job.series.find(s => s.SeriesInstanceUID === SERIES_A).path).toBe('instances');
    expect(job.series.find(s => s.SeriesInstanceUID === SERIES_B).path).toBe('archive');
    // The study still has a complete offline copy.
    expect([A1, A2, B1, B2].every(sop => LocalCacheService.isInstanceCachedSync(sop))).toBe(true);
    expect(job.fallbackSeriesCount).toBe(1);
  });

  it('discards the abandoned archive byte counters when a series falls back', async () => {
    // The archive for series A reports a size and delivers some bytes, then dies mid-stream. If
    // those counters survived the switch to per-instance retrieval, `_rollUpSeriesProgress` would
    // keep the job in byte mode against a total nothing is advancing any more -- a completed job
    // stuck short of 100%.
    let attempts = 0;
    global.fetch = jest.fn(async url => {
      if (!url.includes(SERIES_A)) {
        return archiveFor(SERIES_B, { headers: { 'Content-Length': '4096' } });
      }
      attempts += 1;
      const good = archiveFor(SERIES_A, { headers: { 'Content-Length': '4096' } });
      return {
        ...good,
        body: {
          getReader: () => {
            const reader = good.body.getReader();
            let served = 0;
            return {
              read: async () => {
                if (served++ === 0) {
                  return reader.read();
                }
                throw new Error('connection reset');
              },
              cancel: async () => {},
            };
          },
        },
      };
    });

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(attempts).toBe(2); // one attempt plus the single retry
    expect(job.state).toBe(JOB_STATES.COMPLETED);

    const fellBack = job.series.find(s => s.SeriesInstanceUID === SERIES_A);
    expect(fellBack.path).toBe('instances');
    expect(fellBack.totalBytes).toBeNull();
    expect(fellBack.bytesReceived).toBe(0);

    // One unknown size drops the whole job to the count-based aggregate, which does reach 100%.
    expect(job.totalBytes).toBeNull();
    expect(job.progress.completed).toBe(job.progress.total);
    expect([A1, A2, B1, B2].every(sop => LocalCacheService.isInstanceCachedSync(sop))).toBe(true);
  });

  it('marks the job ERROR when a series fails both ways, keeping the other series usable', async () => {
    global.fetch = jest.fn(async url =>
      url.includes(SERIES_A)
        ? { ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => null }, text: async () => 'nope' }
        : archiveFor(SERIES_B)
    );
    script.retrieveInstance = async url => {
      if (url.includes(SERIES_A)) {
        throw new Error('HTTP 403');
      }
      return part10(url.split('/').pop(), SERIES_B).buffer;
    };

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.state).toBe(JOB_STATES.ERROR);
    expect(job.progress.failed).toBe(2);
    expect(LocalCacheService.isInstanceCachedSync(B1)).toBe(true);
    const failedSeries = job.series.find(s => s.SeriesInstanceUID === SERIES_A);
    expect(failedSeries.state).toBe('failed');
    expect(failedSeries.details).toMatchObject({ status: 403, body: 'nope' });
  });
});

describe('archive-only instances reach the offline open', () => {
  it('adds an instance missing from the enumerated metadata to the stored study payload', async () => {
    DownloadManagerService.setArchiveTransferEnabled(true);

    // The archive for series B carries a third instance the metadata response never mentioned.
    const EXTRA = `${SERIES_B}.3`;
    global.fetch = jest.fn(async url => {
      if (url.includes(SERIES_A)) {
        return archiveFor(SERIES_A);
      }
      return archiveWithMembers({
        IM0: part10(B1, SERIES_B),
        IM1: part10(B2, SERIES_B),
        IM2: part10(EXTRA, SERIES_B),
      });
    });

    // jsdom/node has no IndexedDB, so LocalCacheService stores nothing and
    // getStudyMetadataPayload would answer null. The contract under test is what the job HANDS to
    // the store, so capture that.
    const stored = [];
    const putPayload = jest
      .spyOn(LocalCacheService, 'putStudyMetadataPayload')
      .mockImplementation(async (uid, payload) => {
        stored.push(JSON.parse(JSON.stringify(payload)));
      });

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);
    putPayload.mockRestore();

    expect(LocalCacheService.isInstanceCachedSync(EXTRA)).toBe(true);

    // Caching it is only half the job: a zero-network open is rebuilt from this payload alone
    // (buildStudyFromCachedMetadata sets seriesLoader = null), so an instance the payload does not
    // mention would be stored but invisible.
    expect(stored).toHaveLength(1);
    const payload = stored[0];
    const sopsInPayload = payload.instancesBySeries[SERIES_B].map(
      instance => instance['00080018'].Value[0]
    );
    expect(sopsInPayload).toContain(EXTRA);
    expect(sopsInPayload).toHaveLength(3);

    // The merged dataset must be describable, not just identifiable: a header truncated at the
    // identifying tags cannot become a display set.
    const extra = payload.instancesBySeries[SERIES_B].find(
      instance => instance['00080018'].Value[0] === EXTRA
    );
    expect(extra['00280010']).toBeDefined(); // Rows
    expect(extra['00280011']).toBeDefined(); // Columns
    expect(extra['7FE00010']).toBeUndefined(); // ... but not the pixels
  });

  it('does not duplicate an archive-only instance when the study is re-queued', async () => {
    DownloadManagerService.setArchiveTransferEnabled(true);
    const EXTRA = `${SERIES_B}.3`;

    const fetchImpl = async url =>
      url.includes(SERIES_A)
        ? archiveFor(SERIES_A)
        : archiveWithMembers({
            IM0: part10(B1, SERIES_B),
            IM1: part10(B2, SERIES_B),
            IM2: part10(EXTRA, SERIES_B),
          });

    // The payload is the SAME object across both runs in a real deployment (it is re-read from the
    // store), so hold one and let both jobs merge into it -- that is where a duplicate would show.
    const persisted = {};
    const putPayload = jest
      .spyOn(LocalCacheService, 'putStudyMetadataPayload')
      .mockImplementation(async (uid, payload) => {
        persisted.payload = payload;
      });

    global.fetch = jest.fn(fetchImpl);
    await waitForTerminal(
      DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY }).id
    );

    global.fetch = jest.fn(fetchImpl);
    await waitForTerminal(
      DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY }).id
    );
    putPayload.mockRestore();

    expect(persisted.payload.instancesBySeries[SERIES_B]).toHaveLength(3);
  });
});

describe('cancellation (FR-10)', () => {
  it('aborts an archive request that is still waiting for the server', async () => {
    DownloadManagerService.setArchiveTransferEnabled(true);

    // A request that never answers but does honour its signal, the way a real stalled fetch does.
    const signals = [];
    global.fetch = jest.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          signals.push(options.signal);
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitFor(() => signals.length > 0, 'the archive request to be issued');
    expect(signals[0].aborted).toBe(false);

    DownloadManagerService.cancel(job.id);

    // Nothing polls a cancellation flag while fetch() is unresolved, so this only passes if
    // cancel() reaches the controller itself.
    await waitFor(() => signals[0].aborted, 'the in-flight request to be aborted');
    await waitForTerminal(job.id);
    expect(job.state).toBe(JOB_STATES.CANCELLED);
  });

  it('removes what this job stored and leaves an earlier download intact', async () => {
    // A previous, completed download of series A.
    await Promise.all(
      [A1, A2].map(sop =>
        LocalCacheService.putInstance({
          StudyInstanceUID: STUDY,
          SeriesInstanceUID: SERIES_A,
          SOPInstanceUID: sop,
          bytes: new ArrayBuffer(8),
          metadata: { StudyInstanceUID: STUDY, SeriesInstanceUID: SERIES_A, SOPInstanceUID: sop },
        })
      )
    );

    DownloadManagerService.setArchiveTransferEnabled(true);

    let job;
    global.fetch = jest.fn(async () =>
      // The cancel lands mid-stream, while series B's archive is being extracted.
      archiveFor(SERIES_B, {
        onChunk: index => {
          if (index === 1) {
            DownloadManagerService.cancel(job.id);
          }
        },
      })
    );

    job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.state).toBe(JOB_STATES.CANCELLED);
    // Series A was cached before this job existed and must survive its cancellation.
    expect(LocalCacheService.isInstanceCachedSync(A1)).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync(A2)).toBe(true);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_B)).toBe(false);
  });

  it('keeps an instance an earlier download stored, even inside a series this job re-fetched', async () => {
    // Only PART of series A was cached before, so the archive is fetched and re-stores A1 along
    // with A2. Cancelling must evict A2 (this job put it there) and keep A1 (it did not).
    await LocalCacheService.putInstance({
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_A,
      SOPInstanceUID: A1,
      bytes: new ArrayBuffer(8),
      metadata: { StudyInstanceUID: STUDY, SeriesInstanceUID: SERIES_A, SOPInstanceUID: A1 },
    });

    DownloadManagerService.setArchiveTransferEnabled(true);

    let job;
    let chunks = 0;
    global.fetch = jest.fn(async url =>
      archiveFor(url.includes(SERIES_A) ? SERIES_A : SERIES_B, {
        onChunk: () => {
          // Cancel once a couple of chunks have been consumed across the two series archives, so
          // the cancel lands mid-extraction rather than before the first request.
          if (++chunks === 3) {
            DownloadManagerService.cancel(job.id);
          }
        },
      })
    );

    job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitForTerminal(job.id);

    expect(job.state).toBe(JOB_STATES.CANCELLED);
    expect(LocalCacheService.isInstanceCachedSync(A1)).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync(A2)).toBe(false);
  });
});

describe('one job per study at a time', () => {
  it('holds a second job for the same study until the first finishes', async () => {
    global.fetch = jest.fn();
    const parked = parkRetrieves();

    const studyJob = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    const seriesJob = DownloadManagerService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_A,
    });

    // Both are accepted -- the user asked for both -- but only one runs.
    expect(seriesJob.id).not.toBe(studyJob.id);
    await waitFor(() => studyJob.state === JOB_STATES.DOWNLOADING, 'the study job to start');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(seriesJob.state).toBe(JOB_STATES.QUEUED);

    // The queued job starts once the running one is out of the way.
    DownloadManagerService.cancel(studyJob.id);
    parked.releaseAll();
    await waitForTerminal(studyJob.id, 'the study job to unwind');
    await waitForTerminal(seriesJob.id, 'the series job to run and finish');
    expect(seriesJob.state).toBe(JOB_STATES.COMPLETED);
  });

  it('leaves a completed copy alone when a later job for the same study is cancelled', async () => {
    global.fetch = jest.fn();

    // First: a series job that completes and caches series A.
    const seriesJob = DownloadManagerService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_A,
    });
    await waitForTerminal(seriesJob.id, 'the series job to finish');
    expect(LocalCacheService.isInstanceCachedSync(A1)).toBe(true);

    // Dismissing the finished row must not weaken the copy it produced.
    DownloadManagerService.dismiss(seriesJob.id);

    // Then: a whole-study job, cancelled part way. It found A1 already cached, so A1 was never
    // its to remove.
    const parked = parkRetrieves();
    const studyJob = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await waitFor(() => studyJob.state === JOB_STATES.DOWNLOADING, 'the study job to start');
    DownloadManagerService.cancel(studyJob.id);
    parked.releaseAll();
    await waitForTerminal(studyJob.id, 'the study job to unwind');

    expect(LocalCacheService.isInstanceCachedSync(A1)).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync(A2)).toBe(true);
  });
});

describe('transfer-mode preference', () => {
  it('ignores hydration once the user has made a choice', () => {
    // The startup preference GET can resolve AFTER the user has changed the setting: a value read
    // before their change must not reinstate itself over it.
    DownloadManagerService.setArchiveTransferEnabled(true);
    DownloadManagerService.applyHydratedArchiveTransfer(false);

    expect(DownloadManagerService.isArchiveTransferEnabled()).toBe(true);
  });

  it('announces a change, so a settings form rendered before hydration can follow it', async () => {
    const seen = [];
    const { unsubscribe } = DownloadManagerService.subscribe(
      DownloadManagerService.EVENTS.TRANSFER_MODE_CHANGED,
      payload => seen.push(payload.archiveTransferEnabled)
    );

    // Hydration arriving after a form has already read the default.
    DownloadManagerService.setArchiveTransferEnabled(true);
    // A no-op write must stay silent, or every save would churn subscribers.
    DownloadManagerService.setArchiveTransferEnabled(true);
    DownloadManagerService.setArchiveTransferEnabled(false);

    unsubscribe();
    expect(seen).toEqual([true, false]);
  });
});

describe('series-scoped jobs (ohif-viewers#130)', () => {
  it('transfers only the requested series and stores a PARTIAL metadata payload for it', async () => {
    global.fetch = jest.fn();

    const stored = [];
    const mergePayload = jest
      .spyOn(LocalCacheService, 'mergeStudyMetadataPayload')
      .mockImplementation(async (uid, payload, options) => {
        stored.push({ payload: JSON.parse(JSON.stringify(payload)), options });
      });

    const job = DownloadManagerService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_B,
      descriptor: { SeriesNumber: 2, SeriesDescription: 'Axial 2mm' },
    });
    await waitForTerminal(job.id);
    mergePayload.mockRestore();

    expect(job.kind).toBe('series');
    expect(job.progress).toEqual({ total: 2, completed: 2, failed: 0 });
    expect(LocalCacheService.isSeriesCachedSync(SERIES_B)).toBe(true);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(false);

    // A payload IS stored, merged into whatever the study already had: without one the saved
    // series could not be opened at all with no network.
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0].payload.instancesBySeries)).toEqual([SERIES_B]);
    // ... and it is marked partial, which is what stops the open path replaying it in place of the
    // network and presenting series A as though it did not exist.
    expect(stored[0].options.partial).toBe(true);
  });

  it('de-duplicates on the series UID and reports the series as transferring', async () => {
    global.fetch = jest.fn();
    const parked = parkRetrieves();

    const first = DownloadManagerService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_A,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = DownloadManagerService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES_A,
    });

    expect(second.id).toBe(first.id);
    expect(DownloadManagerService.isSeriesDownloading(SERIES_A)).toBe(true);
    // A series job is not a study job: it transfers part of the study, so it must neither stand in
    // for a whole-study download nor suppress one.
    expect(DownloadManagerService.isStudyDownloading(STUDY)).toBe(false);
    // ... but it IS a transfer of this series, which is what gates the removal control (FR-8).
    expect(DownloadManagerService.isSeriesTransferInFlight(STUDY, SERIES_A)).toBe(true);

    DownloadManagerService.cancelSeries(SERIES_A);
    parked.releaseAll();
    await waitForTerminal(first.id);
  });

  it('reports a study transfer as in flight for each of its series (FR-8)', async () => {
    global.fetch = jest.fn();
    const parked = parkRetrieves();

    const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(DownloadManagerService.isSeriesTransferInFlight(STUDY, SERIES_A)).toBe(true);
    expect(DownloadManagerService.isSeriesTransferInFlight(STUDY, SERIES_B)).toBe(true);
    // A study job is not a series job: the series menu's Cancel Transfer toggle must not appear
    // for a series that has no series-scoped job of its own.
    expect(DownloadManagerService.isSeriesDownloading(SERIES_A)).toBe(false);

    DownloadManagerService.cancel(job.id);
    parked.releaseAll();
    await waitForTerminal(job.id);
  });
});
