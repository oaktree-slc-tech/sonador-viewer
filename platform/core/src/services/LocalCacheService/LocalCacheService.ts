// Persistent, browser-side local/offline cache for downloaded DICOM studies (ohif-viewers#125).
//
// Backing store: IndexedDB (via idb-keyval). Two logical
// stores are used because idb-keyval models each `createStore` as its own single-object-store DB:
//   - instances : keyed by SOPInstanceUID -> { uids, bytes (Part10 ArrayBuffer), metadata, byteSize }
//   - index     : a single serialisable summary document (no ArrayBuffers) enabling fast, SYNCHRONOUS
//                 cached/not-cached lookups by Study/Series/SOP UID from React render paths.
//
// Rationale for the Part10-bytes storage choice (AR-1 documents the decision in §5.1): storing the
// raw Part10 instance keeps the read path modality-agnostic (SR/SEG/DOC/image all round-trip through
// the same `@cornerstonejs/dicom-image-loader` decode pipeline the local-upload flow already uses),
// and lets DicomMetadataStore be rehydrated straight from bytes (FR-3) exactly like an upload.
//
// The in-memory index (+ membership Sets) is what makes FR-2's preferential imageId selection cheap:
// `getImageId()` is synchronous and cannot await IndexedDB, so it consults `isInstanceCachedSync`.

import { get, set, del, clear, createStore } from 'idb-keyval';

import { PubSubService } from '../_shared/pubSubServiceInterface';

const EVENTS = {
  // A single instance's bytes+metadata landed in (or left) the cache.
  INSTANCE_CACHED: 'event::localCacheService:instanceCached',
  INSTANCE_REMOVED: 'event::localCacheService:instanceRemoved',
  // A study-level summary changed (instance added/removed, study removed). UI badges subscribe here.
  STUDY_CACHE_UPDATED: 'event::localCacheService:studyCacheUpdated',
  // The whole store was wiped via clearAll(). Bulk counterpart to INSTANCE_REMOVED — clearAll does
  // not enumerate per-instance events, so session caches keyed by SOP subscribe here to reset.
  CACHE_CLEARED: 'event::localCacheService:cacheCleared',
};

const INDEX_KEY = 'index';
const INDEX_VERSION = 1;

// Instance-store key prefix for per-study raw DICOM+JSON metadata payloads. The '::' cannot occur
// in a SOPInstanceUID (UI VR is digits and dots), so these keys can never collide with records.
const STUDY_META_KEY_PREFIX = '__studymeta__::';

// Instance-store key prefix for the instances the viewer itself added to a cached study (a saved
// report), as DICOM+JSON. Every write of the study's metadata payload folds them in, so a payload
// enumerated from the server before they existed cannot drop them (see cacheViewerInstance).
const VIEWER_ADDITIONS_KEY_PREFIX = '__studyadds__::';

/** One viewer-created instance, in the shapes the metadata payload holds. */
interface ViewerAddition {
  SeriesInstanceUID: string;
  // WADO-RS metadata entry (DICOM+JSON) for the instance
  instance: Record<string, any>;
  // QIDO-RS series entry (DICOM+JSON) for its series
  series: Record<string, any>;
}

type ViewerAdditions = Record<string, ViewerAddition>;

// Fields lifted off the first cached instance's naturalized metadata so the Download Manager's
// "Locally Stored" tab can search without re-reading every instance blob (FR-5 / AC-9).
interface SeriesSummary {
  SeriesInstanceUID: string;
  SeriesDescription?: string;
  SeriesNumber?: string | number;
  Modality?: string;
  totalBytes: number;
  instances: Record<string, { byteSize: number }>;
}

interface StudySummary {
  StudyInstanceUID: string;
  PatientName?: string;
  PatientID?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  // Service Episode ID (0038,0060) — used by Sonador sites as a patient-lookup handle, so it must
  // be identifiable when reviewing/clearing cached studies.
  ServiceEpisodeID?: string;
  StudyDate?: string;
  ModalitiesInStudy: string[];
  cachedAt: number;
  totalBytes: number;
  series: Record<string, SeriesSummary>;
  // True when the raw DICOM+JSON study metadata payload is stored alongside the instances,
  // enabling a fully local (network-free) study open (see put/getStudyMetadataPayload).
  hasMetadataPayload?: boolean;
  // True when that payload describes only SOME of the study's series -- what a series-scoped
  // download stores. A partial payload can reconstruct the series it covers, but it must not be
  // replayed in place of the network, or the series it omits would look as though they do not
  // exist (ohif-viewers#130).
  metadataPayloadPartial?: boolean;
  // True when instances the viewer created are kept for the study (see cacheViewerInstance), so
  // payload writes read them only for the studies that have some
  hasViewerAdditions?: boolean;
}

interface CacheIndex {
  version: number;
  studies: Record<string, StudySummary>;
}

/** A mutation's claim on the cache state it started from. See _beginCacheMutation. */
interface CacheMutationToken {
  generation: number;
  clearing: boolean;
}

interface InstanceUIDs {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
}

interface InstanceRecord extends InstanceUIDs {
  bytes: ArrayBuffer;
  metadata: Record<string, unknown>;
  byteSize: number;
  cachedAt: number;
}

function _emptyIndex(): CacheIndex {
  return { version: INDEX_VERSION, studies: {} };
}

/** The stored record of an instance, with its metadata reduced to what IndexedDB can clone. */
function _instanceRecord(uids: InstanceUIDs, bytes: ArrayBuffer, metadata: Record<string, any>): InstanceRecord {
  return {
    ...uids,
    bytes,
    // Structured-clone-safe copy — raw naturalized datasets throw DataCloneError in IndexedDB.
    metadata: _toStorableMetadata(metadata),
    byteSize: bytes.byteLength,
    cachedAt: Date.now(),
  };
}

/**
 * A copy of DICOM+JSON that IndexedDB can store. dcmjs hands out datasets whose values include
 * Proxy objects (its person-name values stay Proxies even after denaturalizing), and the
 * structured clone behind every IndexedDB write rejects a Proxy with a DataCloneError. Objects
 * and arrays are copied member by member, which reads through a Proxy; binary values are kept as
 * they are, since IndexedDB stores them natively; functions are dropped.
 *
 * @input value {any} the DICOM+JSON value to copy
 * @returns {any} a plain, structured-cloneable copy
 */
function _toCloneable(value: any, seen: WeakMap<object, any> = new WeakMap()): any {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? undefined : value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (Array.isArray(value)) {
    const copy: any[] = [];
    seen.set(value, copy);
    for (let i = 0; i < value.length; i += 1) {
      copy.push(_toCloneable(value[i], seen));
    }
    return copy;
  }
  const copy: Record<string, any> = {};
  seen.set(value, copy);
  Object.keys(value).forEach(key => {
    const member = _toCloneable(value[key], seen);
    if (member !== undefined) {
      copy[key] = member;
    }
  });
  return copy;
}

/** A study metadata payload without the listed series; the payload itself when there are none. */
function _withoutSeries(payload: Record<string, any>, removed?: Set<string>): Record<string, any> {
  if (!removed || !removed.size || !payload?.instancesBySeries) {
    return payload;
  }
  const instancesBySeries = { ...payload.instancesBySeries };
  removed.forEach(uid => delete instancesBySeries[uid]);
  const series = (Array.isArray(payload.series) ? payload.series : []).filter(
    (entry: any) => !removed.has(entry?.['0020000E']?.Value?.[0])
  );
  return { ...payload, series, instancesBySeries };
}

/**
 * A study metadata payload with the viewer additions folded in: each instance appended to its
 * series once (by SOP Instance UID), and its series entry added when the payload does not list it.
 */
function _foldViewerAdditions(payload: Record<string, any>, additions: ViewerAdditions): Record<string, any> {
  const entries = Object.entries(additions);
  if (!entries.length || !payload?.instancesBySeries) {
    return payload;
  }
  const series = Array.isArray(payload.series) ? [...payload.series] : [];
  const instancesBySeries = { ...payload.instancesBySeries };
  entries.forEach(([SOPInstanceUID, addition]) => {
    const uid = addition.SeriesInstanceUID;
    const listed = instancesBySeries[uid] || [];
    if (!listed.some((entry: any) => entry?.['00080018']?.Value?.[0] === SOPInstanceUID)) {
      instancesBySeries[uid] = [...listed, addition.instance];
    }
    if (!series.some((entry: any) => entry?.['0020000E']?.Value?.[0] === uid)) {
      series.push(addition.series);
    }
  });
  return { ...payload, series, instancesBySeries };
}

/** Fill any missing study-level fields on an index entry from an instance's metadata. */
function _backfillStudyFields(study: StudySummary, metadata: Record<string, any>): boolean {
  if (!metadata) {
    return false;
  }
  let changed = false;

  if (!study.PatientName) {
    const pn = _formatPatientName(metadata.PatientName);
    if (pn) {
      study.PatientName = pn;
      changed = true;
    }
  }
  const plainFields: Array<keyof StudySummary> = [
    'PatientID', 'StudyDescription', 'AccessionNumber', 'ServiceEpisodeID', 'StudyDate',
  ];
  plainFields.forEach(field => {
    const value = metadata[field as string];
    if (!study[field] && (typeof value === 'string' || typeof value === 'number')) {
      (study as any)[field] = String(value);
      changed = true;
    }
  });

  return changed;
}

// idb-keyval's createStore opens IndexedDB eagerly, so guard it: in a non-browser env (e.g. a
// jsdom unit-test importing @ohif/core) the cache degrades to in-memory-only rather than throwing
// at import time.
function _hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

// Naturalized datasets coming out of the retrieve pipeline (dcmjs / metadata providers) carry
// values the structured-clone algorithm rejects — functions, accessors, Proxies, circular refs —
// which makes IndexedDB `put` throw DataCloneError. Reduce metadata to a JSON-safe plain object
// before persisting: functions and inline binary payloads are dropped (the authoritative pixel/
// binary data is the Part10 `bytes` blob stored alongside), circular references are cut, and
// everything else round-trips through JSON. Falls back to the handful of index/search fields if
// even that fails.
function _toStorableMetadata(metadata: Record<string, any>): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  try {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(metadata, (_key, value) => {
        if (typeof value === 'function') {
          return undefined;
        }
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          return undefined;
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return undefined; // circular reference
          }
          seen.add(value);
        }
        return value;
      })
    );
  } catch (error) {
    console.warn('[LocalCacheService] Metadata not JSON-serialisable; storing search fields only.', error);
    const fields = [
      'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID', 'SOPClassUID',
      'PatientID', 'StudyDescription', 'SeriesDescription', 'AccessionNumber',
      'ServiceEpisodeID', 'StudyDate', 'Modality', 'SeriesNumber', 'InstanceNumber',
      'NumberOfFrames',
    ];
    const subset: Record<string, unknown> = {};
    fields.forEach(f => {
      const v = metadata[f];
      if (typeof v === 'string' || typeof v === 'number') {
        subset[f] = v;
      }
    });
    subset.PatientName = _formatPatientName(metadata.PatientName);
    return subset;
  }
}

class LocalCacheServiceClass extends PubSubService {
  public readonly name = 'localCacheService';

  // Created lazily in the constructor only when IndexedDB is available (see _hasIndexedDB).
  private _instanceStore: ReturnType<typeof createStore> | null = null;
  private _indexStore: ReturnType<typeof createStore> | null = null;

  private _index: CacheIndex = _emptyIndex();

  // Synchronous membership mirrors of the index, so render paths never touch IndexedDB.
  private _sopSet = new Set<string>();
  private _seriesSet = new Set<string>();
  private _studySet = new Set<string>();

  private _ready: Promise<void>;

  // In-flight series evictions, keyed `study::series`. See removeSeries.
  private _seriesRemovals = new Map<string, Promise<void>>();

  // Series removed from the imaging server during this session, by study. A download that
  // enumerated the study before the removal would otherwise store the series again, its instances
  // through putInstance and its metadata through the payload it commits; both refuse it. Held for
  // the session, until a clear: anything that runs after a reload enumerates the server afresh.
  private _serverRemovedSeries = new Map<string, Set<string>>();

  // Serialises every mutation that touches ONE study's index entry or its metadata payload.
  // Per-series de-duplication is not enough: the payload is study-scoped, so removing series A and
  // series B at once takes two different de-duplication keys and would still interleave a
  // read-modify-write over the same document, dropping one of the two removals.
  private _studyLocks = new Map<string, Promise<unknown>>();

  // The cache-wide clear protocol. `_clearing` is true for the WHOLE of clearAll, including its
  // failure path, and `_generation` moves once when it ends. A mutation captures both before it
  // reads anything and re-checks them before it writes, which leaves no interval uncovered:
  //
  //   starts and writes before the clear   -> clean token, generation unchanged   -> writes
  //   starts before, writes during         -> a clear is running now               -> abandons
  //   starts before, writes after          -> generation moved                    -> abandons
  //   starts during (whenever it writes)   -> token was taken mid-clear           -> abandons
  //   starts and writes after              -> clean token, generation unchanged   -> writes
  //
  // A generation bump alone cannot express this: a mutation that both starts and finishes inside
  // the clear would see an unchanged generation at either end of its own lifetime.
  // Held for as long as a clear is running, and shared by any caller that asks for one while it is
  // in flight. Two overlapping clears would otherwise each own the flag, and the first to finish
  // would declare the cache quiet while the second was still emptying it.
  private _clearing: Promise<void> | null = null;
  private _generation = 0;

  constructor() {
    super(EVENTS);
    if (_hasIndexedDB()) {
      this._instanceStore = createStore('sonador-local-cache', 'instances');
      this._indexStore = createStore('sonador-local-cache-index', 'index');
    }
    this._ready = this._hydrate();
  }

  // Allows optional registration through ServicesManager while remaining a directly-importable
  // singleton (mirrors how DicomMetadataStore is consumed).
  create() {
    return this;
  }

  /** Resolves once the in-memory index has been hydrated from IndexedDB. */
  ready(): Promise<void> {
    return this._ready;
  }

  /**
   * Re-reads the persisted index from IndexedDB, replacing the in-memory index and membership
   * sets. The backing stores are shared across browsing contexts, so another tab/window can
   * change them without any event reaching this one — UI surfaces expose this as an explicit
   * refresh. Broadcasts STUDY_CACHE_UPDATED so subscribed views re-render.
   */
  async rehydrate(): Promise<void> {
    await this._ready;
    this._ready = this._hydrate();
    await this._ready;
    this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, {});
  }

  private async _hydrate(): Promise<void> {
    if (!this._indexStore) {
      this._index = _emptyIndex();
      return;
    }
    try {
      const persisted = (await get<CacheIndex>(INDEX_KEY, this._indexStore)) || _emptyIndex();
      this._index = persisted.version === INDEX_VERSION ? persisted : _emptyIndex();
    } catch (error) {
      console.warn('[LocalCacheService] Failed to hydrate cache index; starting empty.', error);
      this._index = _emptyIndex();
    }
    this._rebuildMembership();
    await this._repairIndexFromRecords();
  }

  /**
   * One idb read per incomplete study: earlier builds indexed studies with missing patient/episode
   * fields (e.g. array-typed PatientName was dropped). The instance records still hold the
   * metadata, so repair the index from them at startup instead of requiring a re-download.
   */
  private async _repairIndexFromRecords(): Promise<void> {
    if (!this._instanceStore) {
      return;
    }
    let dirty = false;

    // Fields can be spread across instances/series, so scan several records per incomplete study
    // (bounded, stopping early once every field is filled).
    const MAX_REPAIR_READS_PER_STUDY = 25;
    const isComplete = (study: StudySummary) =>
      !!(study.PatientName && study.PatientID && study.StudyDescription && study.AccessionNumber && study.ServiceEpisodeID);

    for (const study of Object.values(this._index.studies)) {
      if (isComplete(study)) {
        continue;
      }
      const sopUids: string[] = [];
      Object.values(study.series).forEach(series => sopUids.push(...Object.keys(series.instances)));

      for (const sop of sopUids.slice(0, MAX_REPAIR_READS_PER_STUDY)) {
        try {
          const record = await get<InstanceRecord>(sop, this._instanceStore);
          if (record?.metadata && _backfillStudyFields(study, record.metadata as Record<string, any>)) {
            dirty = true;
          }
        } catch (error) {
          console.warn('[LocalCacheService] Index repair read failed for', sop, error);
        }
        if (isComplete(study)) {
          break;
        }
      }
    }

    if (dirty) {
      await this._persistIndex();
    }
  }

  private _rebuildMembership(): void {
    this._sopSet.clear();
    this._seriesSet.clear();
    this._studySet.clear();

    Object.values(this._index.studies).forEach(study => {
      this._studySet.add(study.StudyInstanceUID);
      Object.values(study.series).forEach(series => {
        this._seriesSet.add(series.SeriesInstanceUID);
        Object.keys(series.instances).forEach(sop => this._sopSet.add(sop));
      });
    });
  }

  /**
   * Run `mutate` with exclusive access to one study's index entry and metadata payload.
   *
   * A plain promise chain per study: each caller waits on the previous one, so mutations queue in
   * arrival order instead of interleaving their awaits. Failures do not poison the chain -- the
   * next waiter runs regardless -- and the map entry is dropped once nothing is queued behind it.
   */
  private _withStudyLock<T>(StudyInstanceUID: string, mutate: () => Promise<T>): Promise<T> {
    const previous = this._studyLocks.get(StudyInstanceUID) || Promise.resolve();
    const result = previous.catch(() => undefined).then(mutate);

    const settled = result.catch(() => undefined);
    this._studyLocks.set(StudyInstanceUID, settled);
    settled.then(() => {
      if (this._studyLocks.get(StudyInstanceUID) === settled) {
        this._studyLocks.delete(StudyInstanceUID);
      }
    });

    return result;
  }

  /**
   * Eligibility for a cache mutation, captured BEFORE it awaits anything.
   *
   * Taking it after a read would misclassify an operation that began mid-clear as one that began
   * after the clear, because by then the generation has already settled.
   */
  private _beginCacheMutation(): CacheMutationToken {
    return { generation: this._generation, clearing: !!this._clearing };
  }

  /** True when the cache has not been wiped since `token` was taken, and is not being wiped now. */
  private _mutationStillValid(token: CacheMutationToken): boolean {
    return !token.clearing && !this._clearing && token.generation === this._generation;
  }

  private async _persistIndex(): Promise<void> {
    if (!this._indexStore) {
      return;
    }
    // The index holds no ArrayBuffers, so it is safe to structured-clone into IndexedDB.
    await set(INDEX_KEY, this._index, this._indexStore);
  }

  // ---- Synchronous membership (safe from React render / getImageId) --------------------------

  isInstanceCachedSync(SOPInstanceUID?: string): boolean {
    return !!SOPInstanceUID && this._sopSet.has(SOPInstanceUID);
  }

  isSeriesCachedSync(SeriesInstanceUID?: string): boolean {
    return !!SeriesInstanceUID && this._seriesSet.has(SeriesInstanceUID);
  }

  isStudyCachedSync(StudyInstanceUID?: string): boolean {
    return !!StudyInstanceUID && this._studySet.has(StudyInstanceUID);
  }

  getCachedStudyUIDsSync(): string[] {
    return Array.from(this._studySet);
  }

  /** Running summary for FR-6/FR-8 hover popups; O(1), read from the maintained index. */
  getStudySummary(StudyInstanceUID: string) {
    const study = this._index.studies[StudyInstanceUID];
    if (!study) {
      return null;
    }
    const seriesList = Object.values(study.series);
    return {
      StudyInstanceUID,
      PatientName: study.PatientName,
      PatientID: study.PatientID,
      StudyDescription: study.StudyDescription,
      AccessionNumber: study.AccessionNumber,
      ServiceEpisodeID: study.ServiceEpisodeID,
      StudyDate: study.StudyDate,
      modalities: study.ModalitiesInStudy.join('/'),
      seriesCount: seriesList.length,
      instanceCount: seriesList.reduce((n, s) => n + Object.keys(s.instances).length, 0),
      totalBytes: study.totalBytes,
      cachedAt: study.cachedAt,
    };
  }

  getSeriesSummary(StudyInstanceUID: string, SeriesInstanceUID: string) {
    const series = this._index.studies[StudyInstanceUID]?.series[SeriesInstanceUID];
    if (!series) {
      return null;
    }
    return {
      SeriesInstanceUID,
      SeriesDescription: series.SeriesDescription,
      SeriesNumber: series.SeriesNumber,
      Modality: series.Modality,
      instanceCount: Object.keys(series.instances).length,
      totalBytes: series.totalBytes,
    };
  }

  // ---- Study metadata payload (network-free study open, ohif-viewers#125) --------------------

  /**
   * Store the raw DICOM+JSON metadata for a study: `{ series: <QIDO series JSON[]>,
   * instancesBySeries: { [SeriesInstanceUID]: <WADO-RS series-metadata JSON[]> } }` — exactly the
   * payloads the online retrieve pipeline consumes, so a cached study can be opened by replaying
   * them through the same code path with zero network requests.
   */
  putStudyMetadataPayload(
    StudyInstanceUID: string,
    payload: Record<string, unknown>,
    options: { partial?: boolean } = {}
  ): Promise<void> {
    if (!StudyInstanceUID || !payload || !this._instanceStore) {
      return Promise.resolve();
    }
    // Taken here, not inside the callback: waiting for the lock is itself an await, so a request
    // made before a wipe could otherwise acquire the lock afterwards and take a token that looks
    // clean for input that is already stale.
    const token = this._beginCacheMutation();

    // Under the study lock: this writes the same document a concurrent series removal prunes.
    return this._withStudyLock(StudyInstanceUID, () =>
      this._putStudyMetadataPayload(StudyInstanceUID, payload, { ...options, token })
    );
  }

  /**
   * Fold `payload` into whatever is stored for this study, atomically.
   *
   * The read, the merge and the write all happen inside the study's critical section. A caller that
   * read the stored payload itself and then asked for a write would have done its read outside the
   * lock, which is the interleaving this exists to prevent.
   */
  mergeStudyMetadataPayload(
    StudyInstanceUID: string,
    payload: Record<string, any>,
    options: { partial?: boolean } = {}
  ): Promise<void> {
    if (!StudyInstanceUID || !payload || !this._instanceStore) {
      return Promise.resolve();
    }

    // Before the lock wait AND before the read below: an operation that begins mid-clear, or that
    // is queued behind another study mutation while a wipe happens, must still be recognisable as
    // predating the wipe once the generation has settled.
    const token = this._beginCacheMutation();

    return this._withStudyLock(StudyInstanceUID, async () => {
      let stored: Record<string, any> | null = null;
      try {
        stored = (await get(STUDY_META_KEY_PREFIX + StudyInstanceUID, this._instanceStore)) || null;
      } catch (error) {
        stored = null;
      }

      const merged = stored?.instancesBySeries
        ? _mergePayloads(stored, payload)
        : payload;

      // A study-scoped payload supersedes; a series-scoped one must not downgrade a complete
      // payload that is already stored. Read inside the lock, so it cannot change under us.
      const partial =
        !!options.partial && !this.hasCompleteStudyMetadataPayloadSync(StudyInstanceUID);

      return this._putStudyMetadataPayload(StudyInstanceUID, merged, { partial, token });
    });
  }

  /**
   * Add an instance the viewer created (a saved report) to the cached copy of its study, so a
   * cached open, which replays only the study's metadata payload, presents it.
   *
   * The bytes are stored as an instance record and the DICOM+JSON entries are kept with the study
   * as a viewer addition. Every later write of the study's metadata payload folds the additions in,
   * so a download that enumerated the study before the instance existed, and commits its payload
   * afterwards, keeps it; so does the first payload of a study still being downloaded. When a
   * payload is stored already it is updated now, keeping its complete or partial coverage.
   *
   * Under the study lock and the cache-clear protocol: nothing is written for a study that is not
   * cached when the lock is taken, and what was written is taken back if the cache is cleared
   * while it is in flight.
   *
   * @input StudyInstanceUID {string} the study the instance belongs to
   * @input bytes {ArrayBuffer} the instance as Part 10 bytes
   * @input metadata {object} the instance as a naturalized dataset
   * @input instance {object} the instance as DICOM+JSON, the shape of a WADO-RS metadata entry
   * @input series {object} its series as DICOM+JSON, the shape of a QIDO-RS series entry
   * @returns {Promise<boolean>} whether the instance was added
   */
  cacheViewerInstance({
    StudyInstanceUID,
    bytes,
    metadata,
    instance,
    series,
  }: {
    StudyInstanceUID: string;
    bytes: ArrayBuffer;
    metadata: Record<string, any>;
    instance: Record<string, any>;
    series: Record<string, any>;
  }): Promise<boolean> {
    const SeriesInstanceUID = instance?.['0020000E']?.Value?.[0];
    const SOPInstanceUID = instance?.['00080018']?.Value?.[0];
    if (!StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID || !bytes) {
      return Promise.resolve(false);
    }
    // Before the lock wait, like the other mutations: a request made before a clear must not take
    // a clean token by acquiring the lock after it
    const token = this._beginCacheMutation();

    return this._withStudyLock(StudyInstanceUID, async () => {
      if (!this._mutationStillValid(token) || !this._index.studies[StudyInstanceUID]) {
        return false;
      }
      // A save whose series was removed from the server first (its upload acknowledged after the
      // removal, or queued behind it) stores nothing: see _serverRemovedSeries
      if (this._isServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID)) {
        return false;
      }
      const uids = { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID };
      const record = _instanceRecord(uids, bytes, metadata);
      const additionsKey = VIEWER_ADDITIONS_KEY_PREFIX + StudyInstanceUID;
      const addition: ViewerAddition = {
        SeriesInstanceUID,
        instance: _toCloneable(instance),
        series: _toCloneable(series),
      };

      if (this._instanceStore) {
        await set(SOPInstanceUID, record, this._instanceStore);
        if (!this._mutationStillValid(token)) {
          await del(SOPInstanceUID, this._instanceStore).catch(() => {});
          return false;
        }
        try {
          const additions = await this._readViewerAdditions(StudyInstanceUID);
          additions[SOPInstanceUID] = addition;
          await set(additionsKey, additions, this._instanceStore);
        } catch (error) {
          // The additions document is as it was (a failed write changes nothing), and it may hold
          // other reports of the study: only this instance's record is taken back
          await del(SOPInstanceUID, this._instanceStore).catch(() => {});
          throw error;
        }
        const study = this._index.studies[StudyInstanceUID];
        if (study) {
          study.hasViewerAdditions = true;
        }
        if (!this._mutationStillValid(token)) {
          await del(SOPInstanceUID, this._instanceStore).catch(() => {});
          await del(additionsKey, this._instanceStore).catch(() => {});
          return false;
        }
      }

      // The series was removed from the server while this save was writing (the removal records
      // it at once and then waits for this lock): take back this instance's record and its own
      // addition, leaving the other reports' additions
      if (this._isServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID)) {
        if (this._instanceStore) {
          await del(SOPInstanceUID, this._instanceStore).catch(() => {});
        }
        await this._pruneViewerAdditions(StudyInstanceUID, { SOPInstanceUID }, token).catch(() => {});
        return false;
      }

      // Checked again without an await before it: the study may have been removed meanwhile
      if (!this._mutationStillValid(token) || !this._index.studies[StudyInstanceUID]) {
        if (this._instanceStore) {
          await del(SOPInstanceUID, this._instanceStore).catch(() => {});
          await del(additionsKey, this._instanceStore).catch(() => {});
        }
        return false;
      }
      this._indexInstance(uids, record.byteSize, record.metadata as Record<string, any>);
      await this._persistIndex();
      this._broadcastEvent(EVENTS.INSTANCE_CACHED, uids);
      this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });

      if (this._instanceStore && this.hasStudyMetadataPayloadSync(StudyInstanceUID)) {
        const stored = await this.getStudyMetadataPayload(StudyInstanceUID).catch(() => null);
        if (stored?.instancesBySeries) {
          // The additions are folded in by the write itself
          const partial = !this.hasCompleteStudyMetadataPayloadSync(StudyInstanceUID);
          await this._putStudyMetadataPayload(StudyInstanceUID, stored, { partial, token });
        }
      }
      return this._mutationStillValid(token);
    });
  }

  /** Whether the series was removed from the imaging server during this session. */
  private _isServerRemovedSeries(StudyInstanceUID: string, SeriesInstanceUID: string): boolean {
    return !!this._serverRemovedSeries.get(StudyInstanceUID)?.has(SeriesInstanceUID);
  }

  /** The viewer additions stored for a study, keyed by SOP Instance UID; empty when there are none. */
  private async _readViewerAdditions(StudyInstanceUID: string): Promise<ViewerAdditions> {
    if (!this._instanceStore || !this._index.studies[StudyInstanceUID]?.hasViewerAdditions) {
      return {};
    }
    try {
      return (await get<ViewerAdditions>(VIEWER_ADDITIONS_KEY_PREFIX + StudyInstanceUID, this._instanceStore)) || {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Forget the viewer additions of a study that no longer apply: all of them, or those of one
   * series, or one instance. The key is deleted once none remain.
   *
   * Callers hold the study lock, which serialises this read-modify-write with saves of the study.
   * A partial prune writes the survivors back only while `token` is still valid: after a clear the
   * document is gone, and writing the survivors would put them back in storage the user emptied.
   * Deleting the whole document needs no such check.
   */
  private async _pruneViewerAdditions(
    StudyInstanceUID: string,
    { SeriesInstanceUID, SOPInstanceUID }: { SeriesInstanceUID?: string; SOPInstanceUID?: string } = {},
    token?: CacheMutationToken
  ): Promise<void> {
    if (!this._instanceStore) {
      return;
    }
    const key = VIEWER_ADDITIONS_KEY_PREFIX + StudyInstanceUID;
    const study = this._index.studies[StudyInstanceUID];
    if (!SeriesInstanceUID && !SOPInstanceUID) {
      // Unconditional: the study's index entry may already be gone
      await del(key, this._instanceStore).catch(() => {});
      if (study) {
        study.hasViewerAdditions = false;
      }
      return;
    }
    if (!study?.hasViewerAdditions) {
      return;
    }
    const claim = token || this._beginCacheMutation();
    if (!this._mutationStillValid(claim)) {
      return;
    }
    const additions = await this._readViewerAdditions(StudyInstanceUID);
    if (!this._mutationStillValid(claim)) {
      return;
    }
    let changed = false;
    Object.entries(additions).forEach(([sop, addition]) => {
      if (sop === SOPInstanceUID || addition.SeriesInstanceUID === SeriesInstanceUID) {
        delete additions[sop];
        changed = true;
      }
    });
    if (!changed) {
      return;
    }
    if (Object.keys(additions).length) {
      await set(key, additions, this._instanceStore).catch(() => {});
    } else {
      await del(key, this._instanceStore).catch(() => {});
      study.hasViewerAdditions = false;
    }
  }

  private async _putStudyMetadataPayload(
    StudyInstanceUID: string,
    payload: Record<string, unknown>,
    {
      partial = false,
      token,
    }: { partial?: boolean; token?: CacheMutationToken } = {}
  ): Promise<void> {
    // The caller's token, not one taken here: for a merge, "here" is already past its read.
    const claim = token || this._beginCacheMutation();
    if (!this._mutationStillValid(claim)) {
      return;
    }

    // Every payload write carries the viewer additions, whatever enumeration it was built from, and
    // none of the series removed from the server since that enumeration
    const additions = await this._readViewerAdditions(StudyInstanceUID);
    if (!this._mutationStillValid(claim)) {
      return;
    }
    const written = _withoutSeries(
      _foldViewerAdditions(payload, additions),
      this._serverRemovedSeries.get(StudyInstanceUID)
    );
    await set(STUDY_META_KEY_PREFIX + StudyInstanceUID, written, this._instanceStore);

    const study = this._index.studies[StudyInstanceUID];
    if (!this._mutationStillValid(claim) || !study) {
      // Either the cache was wiped while this was in flight, or the study is not in the index and
      // nothing could ever reach this document. Both leave an orphan if the key is kept.
      await del(STUDY_META_KEY_PREFIX + StudyInstanceUID, this._instanceStore).catch(() => {});
      return;
    }

    study.hasMetadataPayload = true;
    study.metadataPayloadPartial = partial;
    await this._persistIndex();
    this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
  }

  /** Synchronous check used by the study-open path: is a payload of any kind stored? */
  hasStudyMetadataPayloadSync(StudyInstanceUID?: string): boolean {
    return !!StudyInstanceUID && !!this._index.studies[StudyInstanceUID]?.hasMetadataPayload;
  }

  /**
   * True only when the stored payload covers the WHOLE study, which is what makes a network-free
   * open safe: a study rebuilt from a partial payload would present the series it omits as
   * non-existent rather than as not-yet-cached.
   */
  hasCompleteStudyMetadataPayloadSync(StudyInstanceUID?: string): boolean {
    const study = StudyInstanceUID ? this._index.studies[StudyInstanceUID] : undefined;
    return !!study?.hasMetadataPayload && !study?.metadataPayloadPartial;
  }

  async getStudyMetadataPayload(StudyInstanceUID: string): Promise<Record<string, any> | null> {
    if (!this._instanceStore) {
      return null;
    }
    return (await get(STUDY_META_KEY_PREFIX + StudyInstanceUID, this._instanceStore)) || null;
  }

  private async _removeStudyMetadataPayload(StudyInstanceUID: string): Promise<void> {
    if (this._instanceStore) {
      await del(STUDY_META_KEY_PREFIX + StudyInstanceUID, this._instanceStore).catch(() => {});
    }
    await this._pruneViewerAdditions(StudyInstanceUID);
    const study = this._index.studies[StudyInstanceUID];
    if (study) {
      study.hasMetadataPayload = false;
      study.metadataPayloadPartial = false;
    }
  }

  /**
   * Drop one series from the stored metadata payload, leaving the rest of the study's intact.
   *
   * A series evicted from this browser leaves the payload partial: it no longer describes the
   * whole study, so it must not be replayed in place of the network. A series removed from the
   * server is different: the payload still describes the whole study as the server now holds it,
   * so `keepCoverage` leaves a complete payload complete.
   */
  private async _pruneSeriesFromMetadataPayload(
    StudyInstanceUID: string,
    SeriesInstanceUID: string,
    token: CacheMutationToken,
    { keepCoverage = false, strict = false }: { keepCoverage?: boolean; strict?: boolean } = {}
  ): Promise<void> {
    const study = this._index.studies[StudyInstanceUID];
    if (!this._instanceStore || !study?.hasMetadataPayload) {
      return;
    }

    try {
      const key = STUDY_META_KEY_PREFIX + StudyInstanceUID;
      const payload = await get<Record<string, any>>(key, this._instanceStore);
      if (!payload) {
        study.hasMetadataPayload = false;
        study.metadataPayloadPartial = false;
        return;
      }

      const instancesBySeries = { ...(payload.instancesBySeries || {}) };
      delete instancesBySeries[SeriesInstanceUID];

      const series = (payload.series || []).filter(
        (entry: any) => entry?.['0020000E']?.Value?.[0] !== SeriesInstanceUID
      );

      if (!Object.keys(instancesBySeries).length) {
        await del(key, this._instanceStore).catch(() => {});
        study.hasMetadataPayload = false;
        study.metadataPayloadPartial = false;
        return;
      }

      if (!this._mutationStillValid(token)) {
        // The cache was wiped while the payload was being read; writing the survivor back now
        // would resurrect a document for a study the cache no longer holds.
        return;
      }

      await set(key, { ...payload, series, instancesBySeries }, this._instanceStore);
      if (!keepCoverage) {
        study.metadataPayloadPartial = true;
      }
    } catch (error) {
      // `strict` (a series removed from the server): the caller has to know, since the payload
      // still lists a series that no longer exists
      if (strict) {
        throw error;
      }
      console.warn(
        '[LocalCacheService] Failed to prune the removed series from the study metadata payload.',
        error
      );
    }
  }

  /**
   * Prune a series removed from the server from the payload and the viewer additions. A prune
   * that fails leaves the payload partial, so a cached open no longer replays it in place of the
   * server, and rethrows so the removal can say the offline copy was not updated.
   */
  private async _pruneServerRemovedSeries(
    StudyInstanceUID: string,
    SeriesInstanceUID: string,
    token: CacheMutationToken
  ): Promise<void> {
    try {
      await this._pruneSeriesFromMetadataPayload(StudyInstanceUID, SeriesInstanceUID, token, {
        keepCoverage: true,
        strict: true,
      });
    } catch (error) {
      const study = this._index.studies[StudyInstanceUID];
      if (study?.hasMetadataPayload && this._mutationStillValid(token)) {
        study.metadataPayloadPartial = true;
        await this._persistIndex().catch(() => {});
        this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
      }
      throw error;
    }
  }

  /** Per-series summaries for a cached study (backs the Download Manager hover-details card). */
  getStudySeriesSummaries(StudyInstanceUID: string) {
    const study = this._index.studies[StudyInstanceUID];
    if (!study) {
      return [];
    }
    return Object.values(study.series)
      .map(series => ({
        SeriesInstanceUID: series.SeriesInstanceUID,
        SeriesNumber: series.SeriesNumber,
        SeriesDescription: series.SeriesDescription,
        Modality: series.Modality,
        instanceCount: Object.keys(series.instances).length,
        totalBytes: series.totalBytes,
      }))
      .sort((a, b) => Number(a.SeriesNumber || 0) - Number(b.SeriesNumber || 0));
  }

  /** All cached studies as summaries (backs the Download Manager "Locally Stored" tab). */
  getAllStudySummaries() {
    return Object.keys(this._index.studies)
      .map(uid => this.getStudySummary(uid))
      .filter(Boolean);
  }

  /**
   * Cached-study summaries whose study- OR series-level fields match `term` (case-insensitive).
   * Backs the "Locally Stored" tab search across all seven fields required by FR-5/AC-9:
   * Study UID, Series UID, Patient Name, PatientID, Study Description, Series Description,
   * Accession Number.
   */
  searchCachedStudies(term: string) {
    const summaries = this.getAllStudySummaries();
    const needle = (term || '').trim().toLowerCase();
    if (!needle) {
      return summaries;
    }

    return summaries.filter(summary => {
      const study = this._index.studies[summary!.StudyInstanceUID];
      const haystack: string[] = [
        summary!.StudyInstanceUID,
        summary!.PatientName,
        summary!.PatientID,
        summary!.StudyDescription,
        summary!.AccessionNumber,
        summary!.ServiceEpisodeID,
      ].filter(Boolean) as string[];

      if (study) {
        Object.values(study.series).forEach(series => {
          haystack.push(series.SeriesInstanceUID);
          if (series.SeriesDescription) {
            haystack.push(series.SeriesDescription);
          }
        });
      }

      return haystack.some(value => value.toLowerCase().includes(needle));
    });
  }

  // ---- Reads (async, IndexedDB) --------------------------------------------------------------

  async getInstanceBytes(SOPInstanceUID: string): Promise<ArrayBuffer | null> {
    if (!this._instanceStore || !this.isInstanceCachedSync(SOPInstanceUID)) {
      return null;
    }
    const record = await get<InstanceRecord>(SOPInstanceUID, this._instanceStore);
    return record?.bytes || null;
  }

  async getInstanceMetadata(SOPInstanceUID: string): Promise<Record<string, unknown> | null> {
    if (!this._instanceStore) {
      return null;
    }
    const record = await get<InstanceRecord>(SOPInstanceUID, this._instanceStore);
    return record?.metadata || null;
  }

  /** Returns the cached Part10 bytes for every instance of a study (used to rehydrate metadata). */
  async getStudyInstanceRecords(StudyInstanceUID: string): Promise<InstanceRecord[]> {
    const study = this._index.studies[StudyInstanceUID];
    if (!study || !this._instanceStore) {
      return [];
    }
    const sopUids: string[] = [];
    Object.values(study.series).forEach(series => sopUids.push(...Object.keys(series.instances)));

    const records = await Promise.all(
      sopUids.map(sop => get<InstanceRecord>(sop, this._instanceStore))
    );
    return records.filter(Boolean) as InstanceRecord[];
  }

  // ---- Writes --------------------------------------------------------------------------------

  /**
   * Persist a single instance. `metadata` must be the naturalized dataset (carrying the UID +
   * search fields). Throws on quota exhaustion so the caller (DownloadManagerService) can surface a
   * visible error rather than failing silently (AC-10).
   */
  async putInstance({
    StudyInstanceUID,
    SeriesInstanceUID,
    SOPInstanceUID,
    bytes,
    metadata,
  }: {
    StudyInstanceUID: string;
    SeriesInstanceUID: string;
    SOPInstanceUID: string;
    bytes: ArrayBuffer;
    metadata: Record<string, any>;
  }): Promise<void> {
    if (!StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID) {
      throw new Error('[LocalCacheService] putInstance requires Study/Series/SOP InstanceUID.');
    }

    // A series removed from the server is not stored again, whoever fetched it (see
    // _serverRemovedSeries). Checked before the write and again after it, with no await between
    // that check and the indexing: a removal can land while the bytes are being written.
    if (this._isServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID)) {
      return;
    }

    const record = _instanceRecord({ StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID }, bytes, metadata);
    const { byteSize } = record;
    const storableMetadata = record.metadata;

    // Write the (large) blob first. If IndexedDB is over quota this rejects before we mutate the
    // index, keeping the in-memory summary consistent with what is actually persisted.
    if (this._instanceStore) {
      await set(SOPInstanceUID, record, this._instanceStore);
      if (this._isServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID)) {
        await del(SOPInstanceUID, this._instanceStore).catch(() => {});
        return;
      }
    }

    this._indexInstance({ StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID }, byteSize, storableMetadata);
    try {
      await this._persistIndex();
    } catch (error) {
      // The record IS stored and the in-memory index reflects it, so subscribers must still hear
      // about it — only the on-disk index summary is stale. Because _persistIndex writes the whole
      // index document, ANY later successful persist heals this; until then a reload would leave
      // the record orphaned (clearAll's store-level clear sweeps orphans). Rethrow so the caller
      // still surfaces the quota condition (AC-10).
      this._broadcastEvent(EVENTS.INSTANCE_CACHED, { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID });
      this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
      throw error;
    }

    this._broadcastEvent(EVENTS.INSTANCE_CACHED, {
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID,
    });
    this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
  }

  private _indexInstance(uids: InstanceUIDs, byteSize: number, metadata: Record<string, any>): void {
    const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = uids;

    let study = this._index.studies[StudyInstanceUID];
    if (!study) {
      study = {
        StudyInstanceUID,
        PatientName: _formatPatientName(metadata?.PatientName),
        PatientID: metadata?.PatientID,
        StudyDescription: metadata?.StudyDescription,
        AccessionNumber: metadata?.AccessionNumber,
        ServiceEpisodeID: metadata?.ServiceEpisodeID,
        StudyDate: metadata?.StudyDate,
        ModalitiesInStudy: [],
        cachedAt: Date.now(),
        totalBytes: 0,
        series: {},
      };
      this._index.studies[StudyInstanceUID] = study;
    }

    // Backfill ANY study-level identifier that was absent on the first-seen instance — later
    // instances (or series) frequently carry fields the first one lacked.
    _backfillStudyFields(study, metadata);

    let series = study.series[SeriesInstanceUID];
    if (!series) {
      series = {
        SeriesInstanceUID,
        SeriesDescription: metadata?.SeriesDescription,
        SeriesNumber: metadata?.SeriesNumber,
        Modality: metadata?.Modality,
        totalBytes: 0,
        instances: {},
      };
      study.series[SeriesInstanceUID] = series;
    }

    if (metadata?.Modality && study.ModalitiesInStudy.indexOf(metadata.Modality) === -1) {
      study.ModalitiesInStudy.push(metadata.Modality);
    }

    // Idempotent re-cache of the same instance must not double-count bytes (AC-4).
    const existing = series.instances[SOPInstanceUID];
    if (existing) {
      study.totalBytes += byteSize - existing.byteSize;
      series.totalBytes += byteSize - existing.byteSize;
    } else {
      study.totalBytes += byteSize;
      series.totalBytes += byteSize;
    }
    series.instances[SOPInstanceUID] = { byteSize };

    this._studySet.add(StudyInstanceUID);
    this._seriesSet.add(SeriesInstanceUID);
    this._sopSet.add(SOPInstanceUID);
  }

  /**
   * Remove one cached instance. Under the study lock, like the other mutations of the study's
   * entry and its viewer additions, so it cannot interleave with a save of the same study.
   */
  removeInstance(StudyInstanceUID: string, SeriesInstanceUID: string, SOPInstanceUID: string): Promise<void> {
    // Taken before the lock wait, for the same reason as the other mutations
    const token = this._beginCacheMutation();
    return this._withStudyLock(StudyInstanceUID, () =>
      this._removeInstance(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, token)
    );
  }

  private async _removeInstance(
    StudyInstanceUID: string,
    SeriesInstanceUID: string,
    SOPInstanceUID: string,
    token: CacheMutationToken
  ): Promise<void> {
    if (this._instanceStore) {
      await del(SOPInstanceUID, this._instanceStore);
    }

    const study = this._index.studies[StudyInstanceUID];
    const series = study?.series[SeriesInstanceUID];
    const entry = series?.instances[SOPInstanceUID];
    if (study && series && entry) {
      study.totalBytes -= entry.byteSize;
      series.totalBytes -= entry.byteSize;
      delete series.instances[SOPInstanceUID];

      if (Object.keys(series.instances).length === 0) {
        delete study.series[SeriesInstanceUID];
        this._seriesSet.delete(SeriesInstanceUID);
      }
      if (Object.keys(study.series).length === 0) {
        delete this._index.studies[StudyInstanceUID];
        this._studySet.delete(StudyInstanceUID);
        await this._removeStudyMetadataPayload(StudyInstanceUID);
      } else {
        await this._pruneViewerAdditions(StudyInstanceUID, { SOPInstanceUID }, token);
      }
    }
    this._sopSet.delete(SOPInstanceUID);
    await this._persistIndex();

    this._broadcastEvent(EVENTS.INSTANCE_REMOVED, {
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID,
    });
    this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
  }

  /**
   * Evict one series' local copy.
   *
   * De-duplicated per series while a removal is in flight. Every UI caller fires this without
   * awaiting it -- a menu item, a popover button -- so two quick activations would otherwise both
   * read the same `series` object before the first `await` resolves, and both subtract its
   * `totalBytes` from the study on the way out, leaving the index reporting a size the cache does
   * not have. The second caller now joins the first instead of racing it.
   */
  //
  // `removedFromServer` is for a series deleted from the imaging server rather than evicted from
  // this browser: the study's payload keeps its complete or partial coverage, since it still
  // describes the whole study as the server holds it, and the series is pruned from the payload
  // and the viewer additions even when this browser holds none of its instances.
  //
  // Deliberately not `async`: an async function adopts the promise it returns rather than handing
  // back the same object, so a joining caller could not be given the in-flight removal itself.
  removeSeries(
    StudyInstanceUID: string,
    SeriesInstanceUID: string,
    { removedFromServer = false }: { removedFromServer?: boolean } = {}
  ): Promise<void> {
    if (removedFromServer && StudyInstanceUID && SeriesInstanceUID) {
      // Recorded at once, before the lock wait: from here on nothing stores the series again
      const removed = this._serverRemovedSeries.get(StudyInstanceUID) || new Set<string>();
      removed.add(SeriesInstanceUID);
      this._serverRemovedSeries.set(StudyInstanceUID, removed);
    }

    const key = `${StudyInstanceUID}::${SeriesInstanceUID}`;
    const inFlight = this._seriesRemovals.get(key);
    if (inFlight) {
      return inFlight;
    }

    // Taken before the lock wait, for the same reason as the payload writers.
    const token = this._beginCacheMutation();

    const removal = this._withStudyLock(StudyInstanceUID, () =>
      this._removeSeries(StudyInstanceUID, SeriesInstanceUID, token, { removedFromServer })
    ).finally(() => {
      this._seriesRemovals.delete(key);
    });
    this._seriesRemovals.set(key, removal);
    return removal;
  }

  private async _removeSeries(
    StudyInstanceUID: string,
    SeriesInstanceUID: string,
    token: CacheMutationToken,
    { removedFromServer = false }: { removedFromServer?: boolean } = {}
  ): Promise<void> {
    const series = this._index.studies[StudyInstanceUID]?.series[SeriesInstanceUID];
    if (!series) {
      // Nothing of the series is stored here, but a series the server no longer holds must not
      // stay listed in the payload or the viewer additions either
      if (removedFromServer && this._index.studies[StudyInstanceUID] && this._mutationStillValid(token)) {
        let pruneError: unknown;
        await this._pruneServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID, token).catch(error => {
          pruneError = error;
        });
        await this._pruneViewerAdditions(StudyInstanceUID, { SeriesInstanceUID }, token);
        await this._persistIndex();
        this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
        if (pruneError) {
          throw pruneError;
        }
      }
      return;
    }
    const sopUids = Object.keys(series.instances);
    if (this._instanceStore) {
      await Promise.all(sopUids.map(sop => del(sop, this._instanceStore)));
    }

    // Re-read after the await: the in-flight guard covers repeat activation of THIS series, but the
    // index is shared mutable state and anything that ran while the deletes were pending (a study
    // removal, a clearAll) may already have taken this entry out. Subtracting its bytes twice is
    // the corruption the guard exists to prevent, so do not do it here either.
    const study = this._index.studies[StudyInstanceUID];
    if (!study || !study.series[SeriesInstanceUID]) {
      return;
    }
    study.totalBytes -= series.totalBytes;
    delete study.series[SeriesInstanceUID];
    this._seriesSet.delete(SeriesInstanceUID);
    sopUids.forEach(sop => this._sopSet.delete(sop));

    // A failed prune of a series removed from the server is reported once the rest of the removal
    // has run: the viewer additions must go regardless, or a later payload write restores them
    let pruneError: unknown;
    if (Object.keys(study.series).length === 0) {
      delete this._index.studies[StudyInstanceUID];
      this._studySet.delete(StudyInstanceUID);
      await this._removeStudyMetadataPayload(StudyInstanceUID);
    } else {
      // Other series remain, so the payload survives -- but it must stop describing this one.
      // Left alone, an offline open would reconstruct the removed series from stale DICOM JSON and
      // present images that are no longer stored, and its metadata would linger in IndexedDB after
      // the user asked for it to be gone.
      if (removedFromServer) {
        await this._pruneServerRemovedSeries(StudyInstanceUID, SeriesInstanceUID, token).catch(error => {
          pruneError = error;
        });
      } else {
        await this._pruneSeriesFromMetadataPayload(StudyInstanceUID, SeriesInstanceUID, token);
      }
      // Its viewer additions too, or the next payload write would list instances no longer stored
      await this._pruneViewerAdditions(StudyInstanceUID, { SeriesInstanceUID }, token);
    }
    await this._persistIndex();

    sopUids.forEach(SOPInstanceUID =>
      this._broadcastEvent(EVENTS.INSTANCE_REMOVED, {
        StudyInstanceUID,
        SeriesInstanceUID,
        SOPInstanceUID,
      })
    );
    this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID });
    if (pruneError) {
      throw pruneError;
    }
  }

  async removeStudy(StudyInstanceUID: string) {
    const study = this._index.studies[StudyInstanceUID];
    if (!study) {
      return;
    }
    const seriesUids = Object.keys(study.series);
    // Sequentially remove series so membership Sets and the persisted index stay consistent even if
    // a later delete fails partway through.
    for (const seriesUid of seriesUids) {
      await this.removeSeries(StudyInstanceUID, seriesUid);
    }
  }

  /**
   * Remove EVERY cached instance and reset the index (the Download Manager's "clear all local
   * storage" action). Uses the store-level clear rather than per-study deletes, so it is O(1)-ish
   * and also sweeps any orphaned instance records that a corrupted index no longer references.
   */
  clearAll(): Promise<void> {
    // A second request while one is running joins it rather than starting another. The Clear
    // Storage control returns as soon as the click is handled, so two clears overlapping is one
    // impatient double-click away -- and two of them interleaved would each believe they owned the
    // clearing state. Joining is safe because no mutation can land during a clear to be missed by
    // the one already running.
    if (this._clearing) {
      return this._clearing;
    }

    const running = this._clearAll().finally(() => {
      this._generation += 1;
      this._clearing = null;
    });

    // Assigned synchronously, before anything can await, so a mutation starting on the next tick
    // already sees it. The promise itself is stored rather than a swallowed copy, so a joining
    // caller sees a failed clear fail.
    this._clearing = running;
    return running;
  }

  private async _clearAll(): Promise<void> {
    const studyUids = Array.from(this._studySet);

    if (this._instanceStore) {
      await clear(this._instanceStore);
    }
    this._index = _emptyIndex();
    this._rebuildMembership();
    // Downloads are cancelled before a clear (DownloadManagerService.cancelAllActive), so nothing
    // that enumerated a removed series survives it to store the series again
    this._serverRemovedSeries.clear();
    await this._persistIndex();

    this._broadcastEvent(EVENTS.CACHE_CLEARED, {});
    studyUids.forEach(StudyInstanceUID =>
      this._broadcastEvent(EVENTS.STUDY_CACHE_UPDATED, { StudyInstanceUID })
    );
  }
}

/**
 * Union two DICOM+JSON study payloads: the series lists by SeriesInstanceUID, the instance map by
 * key. `incoming` wins for a series both describe, since it is the fresher enumeration.
 */
function _mergePayloads(
  stored: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const series = Array.isArray(stored.series) ? [...stored.series] : [];
  const known = new Set(series.map(entry => entry?.['0020000E']?.Value?.[0]).filter(Boolean));

  (incoming.series || []).forEach((entry: any) => {
    const uid = entry?.['0020000E']?.Value?.[0];
    if (uid && !known.has(uid)) {
      series.push(entry);
      known.add(uid);
    }
  });

  return {
    ...stored,
    series,
    instancesBySeries: { ...stored.instancesBySeries, ...incoming.instancesBySeries },
  };
}

function _formatPatientName(pn: any): string | undefined {
  if (!pn) {
    return undefined;
  }
  // Naturalized PN values are typically an ARRAY of person-name objects: [{ Alphabetic: 'Last^First' }].
  if (Array.isArray(pn)) {
    return _formatPatientName(pn[0]);
  }
  if (typeof pn === 'string') {
    return pn;
  }
  if (typeof pn === 'object') {
    return pn.Alphabetic || pn.alphabetic || undefined;
  }
  return undefined;
}

const LocalCacheService = new LocalCacheServiceClass();

export { LocalCacheService, EVENTS as LocalCacheServiceEvents };
export default LocalCacheService;
