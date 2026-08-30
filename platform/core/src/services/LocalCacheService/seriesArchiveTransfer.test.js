// Unit tests for per-series archive retrieval into the offline cache (ohif-viewers#129).
//
// The behaviours here are the ones that cannot be inferred from reading the module: which archive
// members become cache instances and which are skipped, that instance identity comes from the
// dataset rather than the member filename, that a quota rejection propagates rather than being
// swallowed, and that the request shape stays the one proven against the deployed server (AR-5).
//
// The zip fixtures are built with fflate at level 0 (STORED members), so extraction runs through
// the pass-through decoder and no worker is involved -- the compressed path is covered separately
// with a deflated fixture.

import { zipSync } from 'fflate';
import dcmjs from 'dcmjs';

import user from '../../user.js';
import LocalCacheService from './LocalCacheService';
import transferSeriesArchive, {
  MAX_OPEN_MEMBERS,
  SeriesArchiveRequestError,
} from './seriesArchiveTransfer';

// Jest 29 runs in a node environment here (jest-environment-jsdom is not installed), and
// PubSubService._broadcastEvent mirrors every event onto document.body as a CustomEvent. Same
// shims as LocalCacheService.test.js.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const SERVER = { wadoRoot: 'https://example.test/dicom-web' };
const STUDY = '1.2.826.0.1.3680043.999.1';
const SERIES = '1.2.826.0.1.3680043.999.1.1';

/** A minimal but genuine Part 10 stream: real preamble, real file-meta, real dataset. */
function part10({ SOPInstanceUID, SeriesInstanceUID = SERIES, StudyInstanceUID = STUDY, ...rest }) {
  const { DicomDict, DicomMetaDictionary } = dcmjs.data;

  const dict = new DicomDict({
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00020003': { vr: 'UI', Value: [SOPInstanceUID] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
  });
  dict.dict = DicomMetaDictionary.denaturalizeDataset({
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    SOPInstanceUID,
    StudyInstanceUID,
    SeriesInstanceUID,
    Modality: 'CT',
    SeriesNumber: 3,
    PatientName: 'Doe^Jane',
    PatientID: 'MRN0042',
    ...rest,
  });

  return new Uint8Array(dict.write());
}

/** Naturalized metadata for an instance, as `_enumerateInstances` would have produced it. */
function enumerated(SOPInstanceUID, extra = {}) {
  return {
    StudyInstanceUID: STUDY,
    SeriesInstanceUID: SERIES,
    SOPInstanceUID,
    Modality: 'CT',
    SeriesNumber: 3,
    SeriesDescription: 'Axial 2mm',
    PatientName: [{ Alphabetic: 'Doe^Jane' }],
    PatientID: 'MRN0042',
    ...extra,
  };
}

function zip(members, { level = 0 } = {}) {
  return zipSync(members, { level });
}

/** Response double streaming `bytes` in small chunks, so the read loop runs for real. */
function archiveResponse(bytes, { headers = {}, chunkSize = 64 } = {}) {
  let offset = 0;

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
          const value = bytes.slice(offset, offset + chunkSize);
          offset += chunkSize;
          return { done: false, value };
        },
        cancel: async () => {},
      }),
    },
  };
}

function errorResponse(status, body = 'Forbidden') {
  return {
    ok: false,
    status,
    statusText: 'Forbidden',
    headers: { get: () => null },
    text: async () => body,
  };
}

const run = (overrides = {}) =>
  transferSeriesArchive({
    server: SERVER,
    StudyInstanceUID: STUDY,
    SeriesInstanceUID: SERIES,
    metadataBySOP: {},
    isCancelled: () => false,
    ...overrides,
  });

beforeEach(async () => {
  await LocalCacheService.ready();
  await LocalCacheService.clearAll();
  user.getAccessToken = () => 'test-token';
});

afterEach(() => {
  delete global.fetch;
  user.getAccessToken = () => null;
});

describe('extraction and indexing', () => {
  it('caches every DICOM member and skips DICOMDIR and non-DICOM members', async () => {
    const archive = zip({
      'STUDY/SERIES/IM0001': part10({ SOPInstanceUID: '1.1' }),
      'STUDY/SERIES/IM0002': part10({ SOPInstanceUID: '1.2' }),
      DICOMDIR: new Uint8Array([1, 2, 3, 4]),
      'README.txt': new TextEncoder().encode('packed by orthanc'),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const result = await run({
      metadataBySOP: { '1.1': enumerated('1.1'), '1.2': enumerated('1.2') },
    });

    expect(result.stored).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(2);
    expect(LocalCacheService.isInstanceCachedSync('1.1')).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync('1.2')).toBe(true);
  });

  it('extracts deflated members as well as stored ones', async () => {
    const archive = zip(
      {
        'IM0001': part10({ SOPInstanceUID: '2.1' }),
        'IM0002': part10({ SOPInstanceUID: '2.2' }),
      },
      { level: 6 }
    );
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const result = await run({
      metadataBySOP: { '2.1': enumerated('2.1'), '2.2': enumerated('2.2') },
    });

    expect(result.stored).toBe(2);
    expect(LocalCacheService.isInstanceCachedSync('2.2')).toBe(true);
  });

  it('skips a member that fails isUsablePart10 and still caches the rest (AR-9)', async () => {
    // Part 10 magic but no TransferSyntaxUID in the meta group: the exact shape isUsablePart10
    // exists to reject, and the reason the per-instance path has a normalized refetch.
    const broken = new Uint8Array(400);
    broken.set([0x44, 0x49, 0x43, 0x4d], 128);

    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '3.1' }),
      'IM0002': broken,
      'IM0003': part10({ SOPInstanceUID: '3.3' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const result = await run({
      metadataBySOP: { '3.1': enumerated('3.1'), '3.3': enumerated('3.3') },
    });

    expect(result.stored).toBe(2);
    expect(result.failed).toBe(1);
    expect(LocalCacheService.isInstanceCachedSync('3.1')).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync('3.3')).toBe(true);
  });

  it('caches an instance that is absent from the enumerated metadata (FR-5)', async () => {
    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '4.1' }),
      // In the archive, but the metadata response did not mention it.
      'IM0002': part10({ SOPInstanceUID: '4.2', SeriesDescription: 'Axial 2mm' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const result = await run({ metadataBySOP: { '4.1': enumerated('4.1') } });

    expect(result.unmatched).toBe(1);
    expect(result.stored).toBe(2);
    expect(LocalCacheService.isInstanceCachedSync('4.2')).toBe(true);
    // Metadata came from the instance's own bytes, so the index still knows what it is.
    const summary = LocalCacheService.getSeriesSummary(STUDY, SERIES);
    expect(summary.Modality).toBe('CT');
    expect(summary.instanceCount).toBe(2);
  });

  it('identifies instances from the dataset, not the member filename', async () => {
    const archive = zip({
      'z-last-alphabetically': part10({ SOPInstanceUID: '5.1' }),
      'a-first-alphabetically': part10({ SOPInstanceUID: '5.2' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    await run({ metadataBySOP: { '5.1': enumerated('5.1'), '5.2': enumerated('5.2') } });

    expect(LocalCacheService.isInstanceCachedSync('5.1')).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync('5.2')).toBe(true);
  });

  it('does not count an instance that was already cached as newly stored', async () => {
    await LocalCacheService.putInstance({
      StudyInstanceUID: STUDY,
      SeriesInstanceUID: SERIES,
      SOPInstanceUID: '6.1',
      bytes: new ArrayBuffer(10),
      metadata: enumerated('6.1'),
    });

    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '6.1' }),
      'IM0002': part10({ SOPInstanceUID: '6.2' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const result = await run({
      metadataBySOP: { '6.1': enumerated('6.1'), '6.2': enumerated('6.2') },
      alreadyCached: new Set(['6.1']),
    });

    expect(result.stored).toBe(1);
  });
});

describe('flow control (FR-14)', () => {
  it('does not read the next chunk until the members the last one completed are stored', async () => {
    // The claim under test is that back-pressure is enforced, not incidental: extraction and
    // storage must sit between two body reads, so the network cannot run ahead of IndexedDB.
    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '12.1' }),
      'IM0002': part10({ SOPInstanceUID: '12.2' }),
      'IM0003': part10({ SOPInstanceUID: '12.3' }),
    });

    const events = [];
    let releaseWrite;
    const putInstance = jest.spyOn(LocalCacheService, 'putInstance').mockImplementation(
      async args => {
        events.push(`write:start:${args.SOPInstanceUID}`);
        // Hold the write open so a read racing ahead of it would be unmistakable in `events`.
        await new Promise(resolve => {
          releaseWrite = resolve;
          setTimeout(resolve, 5);
        });
        events.push(`write:end:${args.SOPInstanceUID}`);
      }
    );

    let offset = 0;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => '',
      body: {
        getReader: () => ({
          read: async () => {
            if (offset >= archive.length) {
              return { done: true };
            }
            events.push('read');
            const value = archive.slice(offset, offset + 96);
            offset += 96;
            return { done: false, value };
          },
          cancel: async () => {},
        }),
      },
    }));

    await run({
      metadataBySOP: {
        '12.1': enumerated('12.1'),
        '12.2': enumerated('12.2'),
        '12.3': enumerated('12.3'),
      },
    });

    putInstance.mockRestore();
    expect(releaseWrite).toBeDefined();

    // Every write that started must have finished before the next read was issued.
    let openWrites = 0;
    events.forEach(event => {
      if (event === 'read') {
        expect(openWrites).toBe(0);
      } else if (event.startsWith('write:start')) {
        openWrites += 1;
      } else {
        openWrites -= 1;
      }
    });

    expect(events.filter(e => e.startsWith('write:start'))).toHaveLength(3);
  });

  it('bounds how many members may be mid-decode before more body is read', async () => {
    // A guard on the constant itself: raising MAX_OPEN_MEMBERS without thought would let the
    // async decoder accumulate copied input without limit, which is the bound FR-14 exists for.
    // 1 would deadlock (the member currently being fed needs the chunks the loop is withholding).
    expect(MAX_OPEN_MEMBERS).toBeGreaterThan(1);
    expect(MAX_OPEN_MEMBERS).toBeLessThanOrEqual(8);
  });
});

describe('request shape and progress', () => {
  it('targets the series archive endpoint with the bearer token and no redirect option (AR-5)', async () => {
    global.fetch = jest.fn(async () => archiveResponse(zip({ 'IM0001': part10({ SOPInstanceUID: '7.1' }) })));

    await run({ metadataBySOP: { '7.1': enumerated('7.1') } });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(`${SERVER.wadoRoot}/series/${SERIES}/archive`);
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.signal).toBeDefined();
    // A manual redirect yields an opaque response whose headers cannot be read; the transparent
    // 302 follow is what is proven against the deployed server.
    expect('redirect' in options).toBe(false);
  });

  it('reports Content-Length as the series total, and null when it is absent', async () => {
    const archive = zip({ 'IM0001': part10({ SOPInstanceUID: '8.1' }) });

    global.fetch = jest.fn(async () =>
      archiveResponse(archive, { headers: { 'Content-Length': String(archive.length) } })
    );
    const sized = await run({ metadataBySOP: { '8.1': enumerated('8.1') } });
    expect(sized.totalBytes).toBe(archive.length);
    expect(sized.bytesReceived).toBe(archive.length);

    await LocalCacheService.clearAll();
    global.fetch = jest.fn(async () => archiveResponse(archive));
    const chunked = await run({ metadataBySOP: { '8.1': enumerated('8.1') } });
    expect(chunked.totalBytes).toBeNull();
    expect(chunked.bytesReceived).toBe(archive.length);
  });

  it('reports a failed request with its URL, status and body (FR-13)', async () => {
    global.fetch = jest.fn(async () => errorResponse(403, 'no view grant'));

    await expect(run()).rejects.toBeInstanceOf(SeriesArchiveRequestError);

    global.fetch = jest.fn(async () => errorResponse(403, 'no view grant'));
    const error = await run().catch(e => e);
    expect(error.details.status).toBe(403);
    expect(error.details.url).toBe(`${SERVER.wadoRoot}/series/${SERIES}/archive`);
    expect(error.details.body).toBe('no view grant');
  });
});

describe('cancellation and quota', () => {
  it('stops storing members once the job is cancelled (FR-10)', async () => {
    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '9.1' }),
      'IM0002': part10({ SOPInstanceUID: '9.2' }),
      'IM0003': part10({ SOPInstanceUID: '9.3' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive, { chunkSize: 32 }));

    let cancelled = false;
    const result = await run({
      metadataBySOP: {
        '9.1': enumerated('9.1'),
        '9.2': enumerated('9.2'),
        '9.3': enumerated('9.3'),
      },
      isCancelled: () => cancelled,
      onInstanceStored: () => {
        // Cancel as soon as the first instance lands.
        cancelled = true;
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.stored).toBe(1);
    expect(LocalCacheService.isInstanceCachedSync('9.3')).toBe(false);
  });

  it('aborts a request still waiting for response headers', async () => {
    // Cooperative cancellation cannot help here: nothing polls `isCancelled()` while `fetch()` is
    // unresolved. Only aborting the signal ends this, so the transfer must publish its controller
    // before it issues the request.
    let signal;
    global.fetch = jest.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          signal = options.signal;
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    let controller;
    const transfer = run({
      onRequestStarted: c => {
        controller = c;
      },
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(controller).toBeDefined();
    expect(signal.aborted).toBe(false);

    controller.abort();

    const result = await transfer;
    expect(signal.aborted).toBe(true);
    // An abort is a cancellation, not a request failure: it must not throw, or the run loop would
    // retry and then fall back to fetching the series image by image.
    expect(result.cancelled).toBe(true);
    expect(result.stored).toBe(0);
  });

  it('aborts a read that stalls mid-body', async () => {
    let rejectRead;
    let signal;
    const archive = zip({ 'IM0001': part10({ SOPInstanceUID: '11.1' }) });

    global.fetch = jest.fn(async (url, options) => {
      signal = options.signal;
      let first = true;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => '',
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve, reject) => {
                if (first) {
                  first = false;
                  resolve({ done: false, value: archive.slice(0, 16) });
                  return;
                }
                // Server stopped sending: this read never settles on its own.
                rejectRead = reject;
                options.signal.addEventListener('abort', () => {
                  const error = new Error('aborted');
                  error.name = 'AbortError';
                  reject(error);
                });
              }),
            cancel: async () => {},
          }),
        },
      };
    });

    let controller;
    const transfer = run({
      onRequestStarted: c => {
        controller = c;
      },
    }).catch(error => error);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(rejectRead).toBeDefined();

    controller.abort();
    await transfer;

    expect(signal.aborted).toBe(true);
  });

  it('propagates a quota rejection rather than swallowing it (FR-12)', async () => {
    const archive = zip({
      'IM0001': part10({ SOPInstanceUID: '10.1' }),
      'IM0002': part10({ SOPInstanceUID: '10.2' }),
    });
    global.fetch = jest.fn(async () => archiveResponse(archive));

    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const putInstance = jest.spyOn(LocalCacheService, 'putInstance').mockRejectedValueOnce(quota);

    await expect(
      run({ metadataBySOP: { '10.1': enumerated('10.1'), '10.2': enumerated('10.2') } })
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });

    // Extraction stopped at the failure rather than unpacking members it cannot store.
    expect(putInstance).toHaveBeenCalledTimes(1);
    putInstance.mockRestore();
  });
});
