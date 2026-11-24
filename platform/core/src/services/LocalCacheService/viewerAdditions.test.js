// A report saved for a study with an offline copy stays in that copy across what else the cache
// does while it is saved: a download of the study that enumerated it beforehand and commits its
// metadata afterwards, a clear of local storage, and the removal of another report of the study.
// What a clear empties stays empty.
//
// Runs the real save (stowSRFromMeasurements, dcmjs serialization), the real download queue and
// the real cache over an in-memory idb-keyval with IndexedDB's asynchronous shape and structured
// cloning. What a reload would find is read through a second cache instance over the same stores.

global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };
// Makes the cache create its stores; the stores themselves are the idb-keyval double below
global.indexedDB = global.indexedDB || {};

jest.setTimeout(30000);

jest.mock('idb-keyval', () => {
  // On the global, so a cache loaded again (the reload) sees the same data
  global.__idbStores = global.__idbStores || new Map();
  const stores = global.__idbStores;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const storeOf = handle => {
    if (!stores.has(handle.name)) {
      stores.set(handle.name, new Map());
    }
    return stores.get(handle.name);
  };
  return {
    createStore: (dbName, storeName) => ({ name: `${dbName}/${storeName}` }),
    get: async (key, handle) => {
      await tick();
      // A test can make one operation fail (see failNext)
      global.__idbFailHook?.('get', key);
      const value = storeOf(handle).get(key);
      const copy = value === undefined ? undefined : structuredClone(value);
      // A test can hold a read after it has captured its value (see holdNextRead)
      if (global.__idbReadHook) {
        await global.__idbReadHook(key);
      }
      return copy;
    },
    set: async (key, value, handle) => {
      const copy = structuredClone(value);
      await tick();
      // A test can hold a write before it lands (see holdNextWrite)
      if (global.__idbWriteHook) {
        await global.__idbWriteHook(key);
      }
      global.__idbFailHook?.('set', key);
      storeOf(handle).set(key, copy);
    },
    del: async (key, handle) => {
      await tick();
      storeOf(handle).delete(key);
    },
    clear: async handle => {
      await tick();
      storeOf(handle).clear();
    },
  };
});

jest.mock('../../studies/services/qido/StaticWadoClient', () => {
  const script = { series: [], instancesBySeries: {}, retrieveInstance: null };
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

// The save's upload and the parts of the SR module this save does not exercise
const mockStoreInstances = jest.fn(() => Promise.resolve());
const mockParse = jest.fn();
jest.mock('dicomweb-client', () => ({
  api: { DICOMwebClient: class { storeInstances(...args) { return mockStoreInstances(...args); } } },
}), { virtual: true });
jest.mock('../../DICOMSR/parseMeasurementsData', () => ({ __esModule: true, default: (...args) => mockParse(...args) }));
jest.mock('../../DICOMSR/parseDicomStructuredReport', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/Cornerstone3d/utils/getAllDisplaySets', () => ({ __esModule: true, default: () => [] }));
jest.mock('../DicomMetadataStore', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../../measurements', () => ({ __esModule: true, default: { MeasurementApi: { Instance: {} } } }));
jest.mock('../../display', () => ({
  __esModule: true,
  default: {
    Enums: { EVENTS: { DCM_LOCAL_CREATE: 'create' } },
    DisplaySetApi: { Instance: { displaySetService: { triggerApiEvent: () => {} } } },
  },
}));

const dcmjs = require('dcmjs');
const user = require('../../user.js').default;
const LocalCacheService = require('./LocalCacheService').default;
const { default: DownloadManagerService, JOB_STATES } = require('./DownloadManagerService');
const { stowSRFromMeasurements } = require('../../DICOMSR/handleStructuredReport');
const script = require('../../studies/services/qido/StaticWadoClient').default.__script;

const SERVER = { wadoRoot: 'https://example.test/dicom-web', qidoRoot: 'https://example.test/dicom-web' };
const STUDY = '1.2.826.0.1.3680043.778.1';
const SERIES_A = `${STUDY}.1`;
const SERIES_B = `${STUDY}.2`;
const CT = [[`${SERIES_A}.1`, SERIES_A], [`${SERIES_A}.2`, SERIES_A], [`${SERIES_B}.1`, SERIES_B], [`${SERIES_B}.2`, SERIES_B]];
const SR_SERIES = `${STUDY}.9`;
const SR = `${SR_SERIES}.1`;

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
  });
  return new Uint8Array(dict.write());
}

const instanceJson = (sop, series) => ({
  '00080018': { vr: 'UI', Value: [sop] },
  '0020000D': { vr: 'UI', Value: [STUDY] },
  '0020000E': { vr: 'UI', Value: [series] },
  '00080060': { vr: 'CS', Value: ['CT'] },
});

const REPORT = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34',
  SOPInstanceUID: SR,
  StudyInstanceUID: STUDY,
  SeriesInstanceUID: SR_SERIES,
  Modality: 'SR',
  SeriesNumber: 9001,
  _meta: { FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer] } },
};

/** Hold every instance retrieve except those in `pass` until `release()`. */
function gateRetrieves(pass = []) {
  const held = [];
  let open = false;
  script.retrieveInstance = url => {
    const sop = url.split('/').pop();
    const bytes = () => part10(sop, url.includes(SERIES_A) ? SERIES_A : SERIES_B).buffer;
    if (open || pass.includes(sop)) {
      return Promise.resolve(bytes());
    }
    return new Promise(resolve => held.push(() => resolve(bytes())));
  };
  return {
    held,
    release: () => {
      open = true;
      held.splice(0).forEach(resume => resume());
    },
  };
}

/**
 * Hold the next read of `key` after it has captured the stored value, until `release()`: the
 * interleaving where a read-modify-write has read and something else runs before it writes.
 */
function holdNextRead(key) {
  let release;
  let held = false;
  const gate = new Promise(resolve => { release = resolve; });
  global.__idbReadHook = async readKey => {
    if (readKey === key && !held) {
      held = true;
      await gate;
    }
  };
  return { isHeld: () => held, release };
}

const ADDITIONS_KEY = `__studyadds__::${STUDY}`;
const instanceStoreKeys = () => [...global.__idbStores.get('sonador-local-cache/instances').keys()];

/** Save a report with its own SOP and series UIDs through the real save path. */
function saveReport(SOPInstanceUID, SeriesInstanceUID) {
  mockParse.mockReturnValueOnce({ dataset: { ...REPORT, SOPInstanceUID, SeriesInstanceUID } });
  return stowSRFromMeasurements({}, SERVER.wadoRoot);
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function download() {
  const job = DownloadManagerService.enqueueStudy({ server: SERVER, StudyInstanceUID: STUDY });
  return job;
}

async function finished(job) {
  await waitFor(
    () => [JOB_STATES.COMPLETED, JOB_STATES.CANCELLED, JOB_STATES.ERROR].includes(job.state),
    'the download to finish'
  );
  return job;
}

/** What a reload finds: a cache started fresh over the same stores. */
async function reloaded() {
  let cache;
  jest.isolateModules(() => {
    cache = require('./LocalCacheService').default;
  });
  await cache.ready();
  return cache;
}

const payloadSops = payload =>
  Object.values(payload?.instancesBySeries || {}).flat().map(entry => entry['00080018'].Value[0]);

beforeEach(async () => {
  await LocalCacheService.ready();
  await LocalCacheService.clearAll();
  DownloadManagerService.cancelAllActive();
  DownloadManagerService.listJobs().forEach(job => DownloadManagerService.dismiss(job.id));
  user.getAccessToken = () => 'test-token';
  mockStoreInstances.mockReset();
  mockStoreInstances.mockImplementation(() => Promise.resolve());
  mockParse.mockReturnValue({ dataset: REPORT });
  script.series = [
    { '0020000E': { Value: [SERIES_A] }, '00080060': { Value: ['CT'] } },
    { '0020000E': { Value: [SERIES_B] }, '00080060': { Value: ['CT'] } },
  ];
  script.instancesBySeries = {
    [SERIES_A]: CT.filter(([, s]) => s === SERIES_A).map(([sop, s]) => instanceJson(sop, s)),
    [SERIES_B]: CT.filter(([, s]) => s === SERIES_B).map(([sop, s]) => instanceJson(sop, s)),
  };
  gateRetrieves().release();
});

afterEach(() => {
  user.getAccessToken = () => null;
  delete global.__idbReadHook;
  delete global.__idbFailHook;
  delete global.__idbWriteHook;
  delete global.fetch;
  DownloadManagerService.setArchiveTransferEnabled(false);
});

it('keeps a report saved during the first download of the study in the payload that download commits', async () => {
  const gate = gateRetrieves([CT[0][0]]);
  const job = await download();
  await waitFor(() => LocalCacheService.isInstanceCachedSync(CT[0][0]) && gate.held.length > 0, 'one instance cached');
  expect(LocalCacheService.hasStudyMetadataPayloadSync(STUDY)).toBe(false);

  // Saved after the download enumerated the study, before it commits a payload
  await stowSRFromMeasurements({}, SERVER.wadoRoot);
  expect(LocalCacheService.isInstanceCachedSync(SR)).toBe(true);

  gate.release();
  await finished(job);
  expect(job.state).toBe(JOB_STATES.COMPLETED);

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).toEqual(expect.arrayContaining([...CT.map(([sop]) => sop), SR]));
  expect(sops).toHaveLength(5);
  expect((await cache.getInstanceBytes(SR)).byteLength).toBeGreaterThan(132);
});

it('keeps a report saved while an existing offline copy is topped up', async () => {
  await finished(await download());
  expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);

  // One instance went missing; the next download fetches it and commits the payload it enumerated
  await LocalCacheService.removeInstance(STUDY, SERIES_B, CT[3][0]);
  const gate = gateRetrieves();
  const job = await download();
  await waitFor(() => gate.held.length > 0, 'the top-up to start fetching');

  await stowSRFromMeasurements({}, SERVER.wadoRoot);
  expect(payloadSops(await LocalCacheService.getStudyMetadataPayload(STUDY))).toContain(SR);

  gate.release();
  await finished(job);
  expect(job.state).toBe(JOB_STATES.COMPLETED);

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).toEqual(expect.arrayContaining([...CT.map(([sop]) => sop), SR]));
  expect(sops).toHaveLength(5);
  expect(cache.isInstanceCachedSync(SR)).toBe(true);
});

it('leaves nothing behind when the upload completes while local storage is being cleared', async () => {
  await finished(await download());

  let clearing;
  mockStoreInstances.mockImplementationOnce(() => {
    clearing = LocalCacheService.clearAll();
    return Promise.resolve();
  });
  await stowSRFromMeasurements({}, SERVER.wadoRoot);
  await clearing;

  expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
  const cache = await reloaded();
  expect(cache.isStudyCachedSync(STUDY)).toBe(false);
  expect(await cache.getInstanceMetadata(SR)).toBeNull();
  expect(await cache.getStudyMetadataPayload(STUDY)).toBeNull();
  expect([...global.__idbStores.get('sonador-local-cache/instances').keys()]).toEqual([]);
});

it('leaves no viewer additions in storage when a clear lands while a series removal is pruning them', async () => {
  await finished(await download());
  const SR_SERIES_2 = `${STUDY}.10`;
  const SR_2 = `${SR_SERIES_2}.1`;
  await saveReport(SR, SR_SERIES);
  await saveReport(SR_2, SR_SERIES_2);

  // The removal has read both additions and is about to write back the one it keeps
  const read = holdNextRead(ADDITIONS_KEY);
  const removal = LocalCacheService.removeSeries(STUDY, SR_SERIES);
  await waitFor(read.isHeld, 'the prune to read the additions');
  await LocalCacheService.clearAll();
  read.release();
  await removal;

  expect(instanceStoreKeys()).toEqual([]);
  const cache = await reloaded();
  expect(cache.isStudyCachedSync(STUDY)).toBe(false);
});

it('keeps the addition of a report saved while another report of the study is being removed', async () => {
  await finished(await download());
  const SR_2 = `${SR_SERIES}.2`;
  await saveReport(SR, SR_SERIES);

  // The removal has read the additions; the save of a second report arrives before it writes
  const read = holdNextRead(ADDITIONS_KEY);
  const removal = LocalCacheService.removeInstance(STUDY, SR_SERIES, SR);
  await waitFor(read.isHeld, 'the prune to read the additions');
  const reachedCache = jest.spyOn(LocalCacheService, 'cacheViewerInstance');
  const saving = saveReport(SR_2, SR_SERIES);
  await waitFor(() => reachedCache.mock.calls.length > 0, 'the save to reach the cache');
  // Room for the save to do whatever it can before the removal resumes: with nothing to
  // serialise them, that is the whole save
  await new Promise(resolve => setTimeout(resolve, 50));
  read.release();
  await Promise.all([removal, saving]);
  reachedCache.mockRestore();

  // A later download commits the payload it enumerated, which lists neither report
  await finished(await download());

  const cache = await reloaded();
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).toContain(SR_2);
  expect(sops).not.toContain(SR);
  expect(cache.isInstanceCachedSync(SR_2)).toBe(true);
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
});

it('keeps a report whose dataset dcmjs naturalized, person-name Proxies and all', async () => {
  await finished(await download());

  // What the measurement writer hands over: a dcmjs-naturalized dataset. dcmjs keeps person-name
  // values as Proxies even once denaturalized, and IndexedDB's structured clone rejects a Proxy.
  const { naturalizeDataset, denaturalizeDataset } = dcmjs.data.DicomMetaDictionary;
  const naturalized = naturalizeDataset(denaturalizeDataset({
    ...REPORT,
    _meta: undefined,
    PatientName: 'Test^Patient',
    ReferringPhysicianName: 'Test^Physician',
  }));
  naturalized._meta = REPORT._meta;
  mockParse.mockReturnValueOnce({ dataset: naturalized });
  await stowSRFromMeasurements({}, SERVER.wadoRoot);

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  expect(payloadSops(await cache.getStudyMetadataPayload(STUDY))).toContain(SR);
  expect(cache.isInstanceCachedSync(SR)).toBe(true);
});

it('takes a report removed from the server out of the offline copy, which stays complete', async () => {
  await finished(await download());
  await saveReport(SR, SR_SERIES);
  expect(payloadSops(await LocalCacheService.getStudyMetadataPayload(STUDY))).toContain(SR);

  // What a series removal does after the server has deleted the report's series
  await LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true });
  expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  expect(payloadSops(await LocalCacheService.getStudyMetadataPayload(STUDY))).not.toContain(SR);

  // Nor does a later download's payload bring it back
  await finished(await download());

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).not.toContain(SR);
  expect(sops).toHaveLength(4);
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
  expect(instanceStoreKeys()).not.toContain(SR);
  expect(instanceStoreKeys()).not.toContain(ADDITIONS_KEY);
});


// ---- A series removed from the server stays removed ------------------------------------------

/** Make the next `op` ('get' or 'set') of `key` fail, as an IndexedDB request would. */
function failNext(op, key) {
  let failed = false;
  global.__idbFailHook = (actual, actualKey) => {
    if (!failed && actual === op && actualKey === key) {
      failed = true;
      throw Object.assign(new Error(`${op} failed`), { name: 'UnknownError' });
    }
  };
}

const META_KEY = `__studymeta__::${STUDY}`;

/** The report as the server lists it, so a download enumerates it. */
function serverListsReport() {
  script.series = [...script.series, { '0020000E': { Value: [SR_SERIES] }, '00080060': { Value: ['SR'] } }];
  script.instancesBySeries = { ...script.instancesBySeries, [SR_SERIES]: [{ ...instanceJson(SR, SR_SERIES), '00080060': { vr: 'CS', Value: ['SR'] } }] };
}

/** Bytes for any SOP of the study, by the series in the request URL. */
function bytesFor(url) {
  const sop = url.split('/').pop();
  const series = url.includes(SR_SERIES) ? SR_SERIES : url.includes(SERIES_A) ? SERIES_A : SERIES_B;
  return part10(sop, series).buffer;
}

/** A streamed zip of `members`, the shape seriesArchiveTransfer reads from fetch. */
function archiveResponse(members) {
  const { zipSync } = require('fflate');
  const bytes = zipSync(members, { level: 0 });
  let offset = 0;
  return {
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => null },
    text: async () => '',
    body: { getReader: () => ({
      read: async () => {
        if (offset >= bytes.length) return { done: true };
        const value = bytes.slice(offset, offset + 128);
        offset += 128;
        return { done: false, value };
      },
      cancel: async () => {},
    }) },
  };
}

const retainedCt = async cache => {
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  return CT.every(([sop]) => sops.includes(sop) && cache.isInstanceCachedSync(sop));
};

it('keeps a removed report out of the copy when a study download enumerated it before the removal', async () => {
  serverListsReport();
  script.retrieveInstance = async url => bytesFor(url);
  await finished(await download());
  expect(LocalCacheService.isInstanceCachedSync(SR)).toBe(true);

  // The report has to be fetched again, so the next download is held with it in its enumeration
  await LocalCacheService.removeInstance(STUDY, SR_SERIES, SR);
  const held = [];
  script.retrieveInstance = url => new Promise(resolve => held.push(() => resolve(bytesFor(url))));
  const job = await download();
  await waitFor(() => held.length > 0, 'the download to fetch the report');

  await LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true });
  held.splice(0).forEach(resume => resume());
  await finished(job);

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).not.toContain(SR);
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
  expect(instanceStoreKeys()).not.toContain(SR);
  expect(await retainedCt(cache)).toBe(true);
});

it('keeps a removed report out of a first archive download of the study, held before anything was cached', async () => {
  serverListsReport();
  DownloadManagerService.setArchiveTransferEnabled(true);
  const held = [];
  global.fetch = jest.fn(url => new Promise(resolve => held.push(() => {
    const series = [SERIES_A, SERIES_B, SR_SERIES].find(uid => url.includes(uid));
    const sops = series === SR_SERIES ? [SR] : CT.filter(([, s]) => s === series).map(([sop]) => sop);
    const members = {};
    sops.forEach((sop, i) => { members[`IM${i}`] = part10(sop, series); });
    resolve(archiveResponse(members));
  })));

  const job = await download();
  await waitFor(() => held.length > 0, 'the archive requests to start');
  expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);

  await LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true });
  const release = () => held.splice(0).forEach(resume => resume());
  release();
  for (let i = 0; i < 20 && ![JOB_STATES.COMPLETED, JOB_STATES.ERROR, JOB_STATES.CANCELLED].includes(job.state); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 25));
    release();
  }
  await finished(job);

  const cache = await reloaded();
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  expect(payloadSops(await cache.getStudyMetadataPayload(STUDY))).not.toContain(SR);
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
  expect(instanceStoreKeys()).not.toContain(SR);
  expect(await retainedCt(cache)).toBe(true);
});

describe.each([
  ['read', 'get'],
  ['write', 'set'],
])('a removal whose metadata %s fails', (_label, op) => {
  it('rejects, and leaves the copy partial rather than complete with the removed report', async () => {
    await finished(await download());
    await saveReport(SR, SR_SERIES);
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);

    failNext(op, META_KEY);
    await expect(LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true }))
      .rejects.toMatchObject({ name: 'UnknownError' });

    const cache = await reloaded();
    expect(cache.hasStudyMetadataPayloadSync(STUDY)).toBe(true);
    expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(false);
    expect(cache.isInstanceCachedSync(SR)).toBe(false);
    expect(instanceStoreKeys()).not.toContain(SR);
    expect(instanceStoreKeys()).not.toContain(ADDITIONS_KEY);
    expect(await retainedCt(cache)).toBe(true);
  });
});


/** Hold the next write of `key` before it lands, until `release()`. */
function holdNextWrite(key) {
  let release;
  let held = false;
  const gate = new Promise(resolve => { release = resolve; });
  global.__idbWriteHook = async writtenKey => {
    if (writtenKey === key && !held) {
      held = true;
      await gate;
    }
  };
  return { isHeld: () => held, release };
}

it('does not recreate a report whose series was removed while its upload acknowledgement was pending', async () => {
  await finished(await download());

  // The report is shown (DCM_LOCAL_CREATE) before the upload is acknowledged; the server has it
  let acknowledge;
  mockStoreInstances.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  const saving = saveReport(SR, SR_SERIES);
  await waitFor(() => typeof acknowledge === 'function', 'the upload to start');

  await LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true });
  acknowledge();
  await saving;

  const cache = await reloaded();
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
  expect(payloadSops(await cache.getStudyMetadataPayload(STUDY))).not.toContain(SR);
  expect(cache.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  expect(instanceStoreKeys()).not.toContain(SR);
  expect(instanceStoreKeys()).not.toContain(ADDITIONS_KEY);
  expect(await retainedCt(cache)).toBe(true);
});

it('takes back a save whose series is removed while it writes, keeping the other reports', async () => {
  await finished(await download());
  const OTHER_SERIES = `${STUDY}.11`;
  const OTHER = `${OTHER_SERIES}.1`;
  await saveReport(OTHER, OTHER_SERIES);

  const write = holdNextWrite(SR);
  const saving = saveReport(SR, SR_SERIES);
  await waitFor(write.isHeld, 'the report record write');
  const removal = LocalCacheService.removeSeries(STUDY, SR_SERIES, { removedFromServer: true });
  write.release();
  await Promise.all([saving, removal]);

  const cache = await reloaded();
  expect(cache.isInstanceCachedSync(SR)).toBe(false);
  expect(instanceStoreKeys()).not.toContain(SR);
  const sops = payloadSops(await cache.getStudyMetadataPayload(STUDY));
  expect(sops).not.toContain(SR);
  expect(sops).toContain(OTHER);
  expect(cache.isInstanceCachedSync(OTHER)).toBe(true);
  expect(Object.keys(global.__idbStores.get('sonador-local-cache/instances').get(ADDITIONS_KEY))).toEqual([OTHER]);
});
