// Where an imported segment's geometry came from, kept with the editor session
// (ohif-viewers#151 FR-5, FR-6; integration item 6).
//
// A model imported from an STL file or an M3D series lands on the working segmentation's grid
// after a unit was declared for it, read from its source, or left unknown. The record keeps the
// three facts apart that a later reader needs: the source's unit and how it was known, the scale
// applied to bring it to the grid's units (once, or not at all), and whether the grid itself is
// calibrated. They are kept for the serializer (ohif-viewers#141) to read when it writes the
// segmentation; the import's report states them to the user.
//
// The records live with the session, as the synchronization ledger does: they are keyed by the
// working segmentation and segment, and reset when the editor closes. A segment painted by hand
// has none.
//
// A segment index is not an identity: the segmentation service gives a new segment the index after
// the highest remaining one, so removing the last imported segment and adding another reuses its
// index. watchSegmentProvenance follows the segment's lifecycle so that a record never outlives
// its segment: a removal takes the record off the segment and keeps it with the Undo entry that
// can restore the segment (the service's segment-index memo, which names its segment); Undo of
// that entry puts the record back, Redo takes it off again. A removal nothing can undo drops it,
// and a segment added at an index is never given the record of the one removed before it.
//
// This module is the handoff to the serializer (ohif-viewers#141), which is not connected yet:
// the records are kept on the working copy for it to read.

import { eventTarget as c3dEventTarget, utilities as c3dUtilities } from '@cornerstonejs/core';

/** How a source's unit was known. */
export const PROVENANCE_ORIGIN = {
  // The user named the unit at import
  declared: 'declared',
  // The source carried it (an M3D instance's Measurement Units Code Sequence)
  encoded: 'encoded',
  // Imported as read: the unit is unknown, and nothing physical is claimed for the geometry
  asRead: 'as-read',
};

/**
 * @typedef {Object} SegmentProvenance
 * @property {string} sourceUnit - 'mm', 'µm', 'cm', 'in', 'm', or 'unknown'
 * @property {string} origin - PROVENANCE_ORIGIN
 * @property {number|null} scale - the factor the source's coordinates were multiplied by to reach
 *   the grid's units, or null when they were placed as read
 * @property {string} destination - the grid's calibration when the segment was imported: 'mm' or
 *   'unknown' (utils/segEditorUnits CALIBRATION)
 */

const _records = new Map();
// The records of removed segments, by the id of the Undo entry that restores the segment:
// memo id -> { segmentationId, segmentIndex, record }. Bounded like the history ring.
const _parked = new Map();
const MAX_PARKED = 64;

// HistoryMemo's event names at the pinned @cornerstonejs/core (not exported by the package)
export const HISTORY_EVENTS = {
  undo: 'CORNERSTONE_TOOLS_HISTORY_UNDO',
  redo: 'CORNERSTONE_TOOLS_HISTORY_REDO',
};
const SEGMENT_INDEX_MEMO = 'segmentIndex';

function _forSegmentation(segmentationId, create = false) {
  let records = _records.get(segmentationId);
  if (!records && create) {
    records = new Map();
    _records.set(segmentationId, records);
  }
  return records;
}

/** Record where a segment's geometry came from. */
export function recordSegmentProvenance(segmentationId, segmentIndex, record) {
  if (!segmentationId || !(segmentIndex > 0) || !record) {
    return;
  }
  _forSegmentation(segmentationId, true).set(segmentIndex, Object.freeze({
    sourceUnit: record.sourceUnit || 'unknown',
    origin: record.origin || PROVENANCE_ORIGIN.asRead,
    scale: Number.isFinite(record.scale) ? record.scale : null,
    destination: record.destination || 'unknown',
  }));
}

/** @returns {SegmentProvenance|undefined} */
export function getSegmentProvenance(segmentationId, segmentIndex) {
  return _forSegmentation(segmentationId)?.get(segmentIndex);
}

/** Every recorded segment of a segmentation, in import order: [{ segmentIndex, ...record }]. */
export function listSegmentProvenance(segmentationId) {
  const records = _forSegmentation(segmentationId);
  return records ? [...records.entries()].map(([segmentIndex, record]) => ({ segmentIndex, ...record })) : [];
}

/** Drop a segment's record (the segment was removed, or a new one took its index). */
export function forgetSegmentProvenance(segmentationId, segmentIndex) {
  _forSegmentation(segmentationId)?.delete(segmentIndex);
}

/** Drop a segmentation's records, or every record (the editor closing; tests). */
export function resetImportProvenance(segmentationId) {
  if (segmentationId === undefined) {
    _records.clear();
    _parked.clear();
  } else {
    _records.delete(segmentationId);
    [..._parked].forEach(([memoId, parked]) => parked.segmentationId === segmentationId && _parked.delete(memoId));
  }
}

// The entries Undo can still reach, newest first, each group flattened (HistoryMemo's ring)
function* _undoableMemos(history) {
  const ring = history?.ring || [];
  const size = history?.size || ring.length;
  for (let i = 0; i < (history?.undoAvailable || 0) && size; i++) {
    const item = ring[((history.position - i) % size + size) % size];
    yield* (Array.isArray(item) ? [...item].reverse() : [item]);
  }
}

// The Undo entry that restores the removed segment: the newest segment-index memo naming it that
// holds no record yet. A removal made outside the history has none.
function _removalMemo(history, segmentationId, segmentIndex) {
  for (const memo of _undoableMemos(history)) {
    if (memo?.operationType === SEGMENT_INDEX_MEMO && memo.segmentationId === segmentationId
        && memo.segmentIndex === segmentIndex && memo.id && !_parked.has(memo.id)) {
      return memo;
    }
  }
  return null;
}

/**
 * Keep the records with their segments through removal, Undo and Redo (see the header), for the
 * life of an editor session.
 *
 * @param {Object} params
 * @param {Object} params.segmentationService - OHIF's: SEGMENT_REMOVED and SEGMENT_ADDED
 * @param {Object} [params.eventTarget] - where HistoryMemo announces Undo and Redo
 * @param {Object} [params.history] - the history the segmentation service records removals in
 * @returns {Function} stop watching
 */
export function watchSegmentProvenance({
  segmentationService,
  eventTarget = c3dEventTarget,
  history = c3dUtilities?.HistoryMemo?.DefaultHistoryMemo,
}) {
  const subscriptions = [];
  const events = segmentationService?.EVENTS || {};

  if (events.SEGMENT_REMOVED) {
    subscriptions.push(segmentationService.subscribe(events.SEGMENT_REMOVED, ({ segmentationId, segmentIndex }) => {
      const record = getSegmentProvenance(segmentationId, segmentIndex);
      forgetSegmentProvenance(segmentationId, segmentIndex);
      const memo = record && _removalMemo(history, segmentationId, segmentIndex);
      if (memo) {
        if (_parked.size >= MAX_PARKED) {
          _parked.delete(_parked.keys().next().value);
        }
        _parked.set(memo.id, { segmentationId, segmentIndex, record });
      }
    }));
  }
  if (events.SEGMENT_ADDED) {
    // A segment added at an index starts without a record. Undo restores a removed segment's
    // record after the service has added it back (HistoryMemo announces the Undo once the entry
    // is restored), and an import records its segments after adding them.
    subscriptions.push(segmentationService.subscribe(events.SEGMENT_ADDED, ({ segmentationId, segmentIndex }) => {
      forgetSegmentProvenance(segmentationId, segmentIndex);
    }));
  }

  const onHistory = event => {
    const { memo, isUndo } = event?.detail || {};
    const parked = memo?.operationType === SEGMENT_INDEX_MEMO && _parked.get(memo.id);
    if (!parked) {
      return;
    }
    if (isUndo) {
      _forSegmentation(parked.segmentationId, true).set(parked.segmentIndex, parked.record);
    } else {
      forgetSegmentProvenance(parked.segmentationId, parked.segmentIndex);
    }
  };
  if (eventTarget) {
    eventTarget.addEventListener(HISTORY_EVENTS.undo, onHistory);
    eventTarget.addEventListener(HISTORY_EVENTS.redo, onHistory);
  }

  return () => {
    subscriptions.forEach(subscription => subscription?.unsubscribe?.());
    if (eventTarget) {
      eventTarget.removeEventListener(HISTORY_EVENTS.undo, onHistory);
      eventTarget.removeEventListener(HISTORY_EVENTS.redo, onHistory);
    }
  };
}
