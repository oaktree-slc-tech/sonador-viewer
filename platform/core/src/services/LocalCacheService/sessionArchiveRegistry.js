// The series the session archive loader is fetching, or will fetch, for the studies open in the
// viewer, and the instances it still owes (imaging-development-env#103). Kept apart from the loader
// so getImageId and the local image reader, which run on the render path and are imported widely,
// can consult it without pulling in the transfer code.
//
// An imageId is memoised the first time an instance is asked for, usually before any archive has
// landed. A series registered here therefore gets a `sonadorlocal:` id up front: the local reader
// serves the instance from the cache once its archive member is stored, and while the member is
// still owed it waits for it (`whenInstanceAvailable`) rather than fetching the image on its own --
// otherwise every image of the series on screen would be requested twice, once by the archive and
// once per instance. When the archive fails or is cancelled the owed instances are released and the
// reader falls back to the per-instance request (the FR-10 miss path).

const _scheduled = new Set();

// SOPInstanceUID -> { promise, resolve } for the instances an archive in flight still owes
const _pending = new Map();

export function scheduleSeries(SeriesInstanceUID) {
  if (SeriesInstanceUID) {
    _scheduled.add(SeriesInstanceUID);
  }
}

export function unscheduleSeries(SeriesInstanceUID) {
  _scheduled.delete(SeriesInstanceUID);
}

export function isSeriesScheduledSync(SeriesInstanceUID) {
  return !!SeriesInstanceUID && _scheduled.has(SeriesInstanceUID);
}

export function clearScheduledSeries() {
  _scheduled.clear();
  releaseAllPendingInstances();
}

/** The instances an archive now in flight is expected to deliver. */
export function markInstancesPending(SOPInstanceUIDs) {
  (SOPInstanceUIDs || []).forEach(sop => {
    if (sop && !_pending.has(sop)) {
      let resolve;
      const promise = new Promise(res => { resolve = res; });
      _pending.set(sop, { promise, resolve });
    }
  });
}

/** An owed instance has landed (or will never land): whoever waits for it may go on. */
export function releasePendingInstance(SOPInstanceUID) {
  const entry = _pending.get(SOPInstanceUID);
  if (entry) {
    _pending.delete(SOPInstanceUID);
    entry.resolve();
  }
}

export function releasePendingInstances(SOPInstanceUIDs) {
  (SOPInstanceUIDs || []).forEach(releasePendingInstance);
}

export function releaseAllPendingInstances() {
  Array.from(_pending.keys()).forEach(releasePendingInstance);
}

export function isInstancePendingSync(SOPInstanceUID) {
  return !!SOPInstanceUID && _pending.has(SOPInstanceUID);
}

/**
 * Resolves once the instance is no longer owed by an archive in flight: it has been stored, or its
 * archive gave up. Resolves at once for an instance no archive owes.
 */
export function whenInstanceAvailable(SOPInstanceUID) {
  const entry = SOPInstanceUID ? _pending.get(SOPInstanceUID) : undefined;
  return entry ? entry.promise : Promise.resolve();
}
