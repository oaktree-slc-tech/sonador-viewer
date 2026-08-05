// Unit tests for the archive-export queue (ohif-viewers#52).
//
// The behaviours covered here are the ones the old `response.blob()` implementation could not
// express at all, and are the easiest to regress silently: de-duplication, both flavours of
// cancellation, an absent Content-Length, progress throttling, terminal-only dismiss, and the
// concurrency bound.

import ArchiveDownloadService, {
  ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
} from './ArchiveDownloadService';

// Jest 29 runs in a node environment here (jest-environment-jsdom is not installed), and
// PubSubService._broadcastEvent mirrors every event onto document.body as a CustomEvent. Same
// shims as LocalCacheService.test.js / downloadNotifications.test.js, plus the download machinery
// the service reaches for when a transfer completes.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};

const savedFiles = [];

const anchorStub = () => ({
  href: '',
  download: '',
  click() {
    savedFiles.push(this.download);
  },
  remove() {},
});

global.document = global.document || {
  body: { dispatchEvent: () => {}, appendChild: () => {} },
  createElement: anchorStub,
};
global.document.createElement = anchorStub;
global.document.body.appendChild = global.document.body.appendChild || (() => {});

global.window = global.window || {};
global.window.URL = { createObjectURL: () => 'blob:archive', revokeObjectURL: () => {} };

const SERVER = { wadoRoot: 'https://example.test/dicom-web' };

const DESCRIPTOR = {
  PatientName: 'Doe^Jane',
  PatientID: 'MRN0042',
  StudyDescription: 'CT CHEST',
  StudyDate: '20260314',
};

/** Response double with a readable stream body, so the read loop is exercised for real. */
function streamingResponse({ chunks, headers = {}, ok = true, status = 200 }) {
  let index = 0;

  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: name => headers[name] ?? null },
    text: async () => 'error body',
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
        cancel: async () => {},
      }),
    },
  };
}

/**
 * A body that never ends on its own, so a job can be held mid-stream. Each `read()` parks until the
 * test resolves or rejects it, which is what lets the cancellation path be driven deterministically
 * rather than raced.
 */
function hangingResponse({ headers = {} } = {}) {
  let pending = null;

  return {
    isWaiting: () => !!pending,
    resolveNext(value) {
      const settle = pending;
      pending = null;
      settle?.resolve({ done: false, value });
    },
    rejectNext(error) {
      const settle = pending;
      pending = null;
      settle?.reject(error);
    },
    response: {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: name => headers[name] ?? null },
      body: {
        getReader: () => ({
          read: () => new Promise((resolve, reject) => { pending = { resolve, reject }; }),
          cancel: async () => {},
        }),
      },
    },
  };
}

function abortError() {
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  return error;
}

/**
 * A fetch that never answers but DOES honour the abort signal, the way the real one does. Tests
 * that only need a job parked in flight use this; a stub that ignored the signal would strand jobs
 * in the shared singleton and leak them into the next test.
 */
function pendingFetch() {
  return jest.fn(
    (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()));
      })
  );
}

function bytes(n, fill = 1) {
  return new Uint8Array(n).fill(fill);
}

/** Settle the microtask queue so the fire-and-forget run loop advances. */
const tick = async (times = 6) => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

/** Poll until the predicate holds, so tests never depend on a fixed number of microtask turns. */
async function waitFor(predicate, label = 'condition') {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(async () => {
  savedFiles.length = 0;
  // Start every test from an empty queue: the service is a module singleton shared across tests,
  // and cancelling a streaming job settles asynchronously, so wait for the drain before clearing.
  ArchiveDownloadService.cancelAllActive();
  await waitFor(() => ArchiveDownloadService.listActiveJobs().length === 0, 'the queue to drain');
  ArchiveDownloadService.clearTerminal();
});

afterEach(() => {
  delete global.fetch;
});

describe('enqueue and de-duplication', () => {
  it('names the archive from the descriptor rather than the UID', () => {
    global.fetch = pendingFetch();

    const job = ArchiveDownloadService.enqueueStudy({
      server: SERVER,
      StudyInstanceUID: '1.2.3',
      descriptor: DESCRIPTOR,
    });

    expect(job.filename).toBe('Doe-Jane_CT-CHEST_20260314.zip');
    expect(job.kind).toBe('study');
    expect(job.StudyInstanceUID).toBe('1.2.3');
  });

  it('returns the existing job instead of starting a second request (FR-14)', async () => {
    global.fetch = pendingFetch();

    const first = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await tick();
    const second = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });

    expect(second.id).toBe(first.id);
    expect(ArchiveDownloadService.listJobs()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keys series jobs on the Series UID, so a study and one of its series can run together', async () => {
    global.fetch = pendingFetch();

    ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    ArchiveDownloadService.enqueueSeries({
      server: SERVER,
      StudyInstanceUID: '1.2.3',
      SeriesInstanceUID: '1.2.3.4',
    });
    await tick();

    expect(ArchiveDownloadService.listJobs()).toHaveLength(2);
    expect(ArchiveDownloadService.getActiveJobForResource('1.2.3.4').kind).toBe('series');
  });
});

describe('streaming', () => {
  it('reports totalBytes from Content-Length and saves the assembled file', async () => {
    global.fetch = jest.fn(async () =>
      streamingResponse({
        chunks: [bytes(4), bytes(6)],
        headers: { 'Content-Length': '10' },
      })
    );

    const job = ArchiveDownloadService.enqueueStudy({
      server: SERVER,
      StudyInstanceUID: '1.2.3',
      descriptor: DESCRIPTOR,
    });

    await waitFor(() => job.state === ARCHIVE_JOB_STATES.COMPLETED, 'completion');

    expect(job.totalBytes).toBe(10);
    expect(job.bytesReceived).toBe(10);
    expect(savedFiles).toEqual(['Doe-Jane_CT-CHEST_20260314.zip']);
  });

  it('leaves totalBytes null when Content-Length is absent, and still completes (FR-6)', async () => {
    global.fetch = jest.fn(async () => streamingResponse({ chunks: [bytes(8), bytes(8)] }));

    const job = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });

    // Observed during the transfer, before the completion transition overwrites it with the final
    // byte count -- the indeterminate bar depends on this being null while downloading.
    const seen = [];
    const sub = ArchiveDownloadService.subscribe(
      ArchiveDownloadServiceEvents.JOB_PROGRESS,
      ({ job: j }) => seen.push(j.totalBytes)
    );

    await waitFor(() => job.state === ARCHIVE_JOB_STATES.COMPLETED, 'completion');
    sub.unsubscribe();

    expect(seen.every(value => value === null)).toBe(true);
    expect(job.bytesReceived).toBe(16);
    expect(savedFiles).toHaveLength(1);
  });

  it('prefers a Content-Disposition filename only when the caller gave no descriptor', async () => {
    global.fetch = jest.fn(async () =>
      streamingResponse({
        chunks: [bytes(2)],
        headers: { 'Content-Disposition': 'attachment; filename="orthanc-archive.zip"' },
      })
    );

    const bare = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await waitFor(() => bare.state === ARCHIVE_JOB_STATES.COMPLETED, 'bare completion');
    expect(bare.filename).toBe('orthanc-archive.zip');

    const described = ArchiveDownloadService.enqueueStudy({
      server: SERVER,
      StudyInstanceUID: '9.9.9',
      descriptor: DESCRIPTOR,
    });
    await waitFor(() => described.state === ARCHIVE_JOB_STATES.COMPLETED, 'described completion');
    expect(described.filename).toBe('Doe-Jane_CT-CHEST_20260314.zip');
  });

  it('throttles progress events rather than emitting one per chunk (AR-8)', async () => {
    // 40 small chunks in a tight loop: under the 200 ms / 1 MB thresholds, only the forced final
    // event should get through.
    const chunks = Array.from({ length: 40 }, () => bytes(16));
    global.fetch = jest.fn(async () => streamingResponse({ chunks }));

    let progressEvents = 0;
    const sub = ArchiveDownloadService.subscribe(
      ArchiveDownloadServiceEvents.JOB_PROGRESS,
      () => { progressEvents += 1; }
    );

    const job = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await waitFor(() => job.state === ARCHIVE_JOB_STATES.COMPLETED, 'completion');
    sub.unsubscribe();

    expect(progressEvents).toBeLessThan(chunks.length);
    expect(progressEvents).toBeGreaterThan(0);
  });

  it('captures url, status and body on a failed request for the Issues list (FR-12)', async () => {
    global.fetch = jest.fn(async () =>
      streamingResponse({ chunks: [], ok: false, status: 503 })
    );

    const job = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await waitFor(() => job.state === ARCHIVE_JOB_STATES.ERROR, 'error');

    expect(job.details.status).toBe(503);
    expect(job.details.body).toBe('error body');
    expect(job.details.url).toBe('https://example.test/dicom-web/studies/1.2.3/archive');
    expect(savedFiles).toHaveLength(0);
  });
});

describe('cancellation', () => {
  it('removes a queued job without ever issuing a request (FR-7)', async () => {
    global.fetch = pendingFetch();

    // Two jobs saturate the concurrency bound, so the third never leaves QUEUED.
    ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'a' });
    ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'b' });
    const third = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'c' });
    await tick();

    expect(third.state).toBe(ARCHIVE_JOB_STATES.QUEUED);

    ArchiveDownloadService.cancel(third.id);

    expect(third.state).toBe(ARCHIVE_JOB_STATES.CANCELLED);
    // Only the two that got slots ever reached the network.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('discards buffered bytes and writes no file when cancelled mid-stream (FR-7)', async () => {
    const stream = hangingResponse({ headers: { 'Content-Length': '1000' } });

    global.fetch = jest.fn((url, options) => {
      // Reproduce fetch's abort contract: the read in flight rejects with an AbortError.
      options.signal.addEventListener('abort', () => stream.rejectNext(abortError()));
      return Promise.resolve(stream.response);
    });

    const job = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await waitFor(() => job.state === ARCHIVE_JOB_STATES.DOWNLOADING, 'downloading');
    await waitFor(() => stream.isWaiting(), 'the first read');

    // Move some bytes, so there is a buffer for the cancel to discard.
    stream.resolveNext(bytes(64));
    await waitFor(() => job.bytesReceived === 64, 'the first chunk');
    await waitFor(() => stream.isWaiting(), 'the second read');

    ArchiveDownloadService.cancel(job.id);
    await waitFor(() => job.state === ARCHIVE_JOB_STATES.CANCELLED, 'cancellation');

    // The 64 bytes already read are dropped rather than written: no file reaches the user.
    expect(savedFiles).toHaveLength(0);
  });
});

describe('list management', () => {
  it('dismisses terminal jobs only (FR-8)', async () => {
    global.fetch = pendingFetch();

    const active = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: '1.2.3' });
    await tick();

    ArchiveDownloadService.dismiss(active.id);
    expect(ArchiveDownloadService.getJob(active.id)).toBeDefined();

    ArchiveDownloadService.cancel(active.id);
    await waitFor(
      () => ArchiveDownloadService.getJob(active.id)?.state === ARCHIVE_JOB_STATES.CANCELLED,
      'cancelled'
    );

    ArchiveDownloadService.dismiss(active.id);
    expect(ArchiveDownloadService.getJob(active.id)).toBeUndefined();
  });

  it('clearTerminal removes finished rows and leaves active ones alone (FR-8)', async () => {
    global.fetch = pendingFetch();

    const a = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'a' });
    const b = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'b' });
    await tick();

    ArchiveDownloadService.cancel(a.id);
    await waitFor(() => a.state === ARCHIVE_JOB_STATES.CANCELLED, 'a cancelled');

    ArchiveDownloadService.clearTerminal();

    expect(ArchiveDownloadService.getJob(a.id)).toBeUndefined();
    expect(ArchiveDownloadService.getJob(b.id)).toBeDefined();
  });

  it('lists jobs newest first (FR-5)', async () => {
    global.fetch = pendingFetch();

    const first = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'a' });
    // createdAt is epoch-ms; nudge the second job forward so the ordering is unambiguous.
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: 'b' });

    expect(ArchiveDownloadService.listJobs().map(job => job.id)).toEqual([second.id, first.id]);
  });
});

describe('concurrency', () => {
  it('runs at most two exports at a time and pumps the rest as slots free (AR-10)', async () => {
    const gates = [];
    global.fetch = jest.fn(
      () =>
        new Promise(resolve => {
          gates.push(resolve);
        })
    );

    const jobs = ['a', 'b', 'c', 'd'].map(uid =>
      ArchiveDownloadService.enqueueStudy({ server: SERVER, StudyInstanceUID: uid })
    );
    await tick();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(jobs.filter(j => j.state === ARCHIVE_JOB_STATES.QUEUED)).toHaveLength(2);

    // Finish the first two; the queue should immediately pump the remaining two.
    gates.forEach(resolve => resolve(streamingResponse({ chunks: [bytes(2)] })));
    await waitFor(() => global.fetch.mock.calls.length === 4, 'remaining jobs to start');

    await waitFor(
      () => jobs.every(job => job.state !== ARCHIVE_JOB_STATES.QUEUED),
      'queue to drain'
    );
  });
});
