// The import provenance records of a session (ohif-viewers#151 FR-6)

import {
  forgetSegmentProvenance,
  getSegmentProvenance,
  HISTORY_EVENTS,
  listSegmentProvenance,
  PROVENANCE_ORIGIN,
  recordSegmentProvenance,
  resetImportProvenance,
  watchSegmentProvenance,
} from './importProvenance';

jest.mock('@cornerstonejs/core', () => ({ eventTarget: null, utilities: {} }), { virtual: true });

// The pinned library's HistoryMemo, loaded from its own file, announcing Undo and Redo on a hub
// the watch listens on
const mockHub = (() => {
  const listeners = {};
  return {
    addEventListener: (type, listener) => { (listeners[type] = listeners[type] || new Set()).add(listener); },
    removeEventListener: (type, listener) => listeners[type]?.delete(listener),
    dispatchEvent: event => { listeners[event.type]?.forEach(listener => listener(event)); return true; },
  };
})();
jest.mock('../../../../node_modules/@cornerstonejs/core/dist/esm/eventTarget', () => ({
  __esModule: true, default: mockHub,
}));
const { HistoryMemo } = require('../../../../node_modules/@cornerstonejs/core/dist/esm/utilities/historyMemo/index.js');

// OHIF's SegmentationService as far as segments come and go (extensions/cornerstone
// SegmentationService: addSegment, getNextAvailableSegmentIndex, createSegmentIndexMemo,
// removeSegment), over a plain segment table and the given history
function segmentationServiceOver(history) {
  const EVENTS = { SEGMENT_ADDED: 'event::segment_added', SEGMENT_REMOVED: 'event::segment_removed' };
  const subscribers = { [EVENTS.SEGMENT_ADDED]: new Set(), [EVENTS.SEGMENT_REMOVED]: new Set() };
  const broadcast = (name, detail) => subscribers[name].forEach(callback => callback(detail));
  const segments = { seg: {} };
  const service = {
    EVENTS,
    segments,
    subscribe(name, callback) {
      subscribers[name].add(callback);
      return { unsubscribe: () => subscribers[name].delete(callback) };
    },
    getNextAvailableSegmentIndex(segmentationId) {
      const indices = Object.keys(segments[segmentationId]).map(Number);
      return indices.length ? Math.max(...indices) + 1 : 1;
    },
    addSegment(segmentationId, config = {}) {
      const segmentIndex = config.segmentIndex ?? service.getNextAvailableSegmentIndex(segmentationId);
      segments[segmentationId][segmentIndex] = { label: config.label || `Segment ${segmentIndex}` };
      broadcast(EVENTS.SEGMENT_ADDED, { segmentationId, segmentIndex });
      return segmentIndex;
    },
    createSegmentIndexMemo(segmentationId, segmentIndex) {
      const segmentState = { segmentIndex, label: segments[segmentationId][segmentIndex].label };
      return {
        id: `memo-${Math.random()}`,
        operationType: 'segmentIndex',
        segmentationId,
        segmentIndex,
        restoreMemo(undo) {
          if (undo === true) {
            service.addSegment(segmentationId, segmentState);
          } else {
            // Redo removes the segment through the library, with no service event
            delete segments[segmentationId][segmentIndex];
          }
        },
      };
    },
    removeSegment(segmentationId, segmentIndex, options) {
      if (!options?.skipRecordingHistory) {
        const memo = service.createSegmentIndexMemo(segmentationId, segmentIndex);
        history.startGroupRecording();
        // The library's own labelmap memo for the cleared voxels
        history.push({ id: `voxels-${Math.random()}`, operationType: 'labelmap', restoreMemo: () => {} });
        delete segments[segmentationId][segmentIndex];
        history.push(memo);
        history.endGroupRecording();
      } else {
        delete segments[segmentationId][segmentIndex];
      }
      broadcast(EVENTS.SEGMENT_REMOVED, { segmentationId, segmentIndex });
    },
  };
  return service;
}


beforeEach(() => resetImportProvenance());

describe('importProvenance', () => {
  it('records a segment\'s source unit, origin, scale and destination, normalised and frozen', () => {
    recordSegmentProvenance('seg', 2, { sourceUnit: 'in', origin: PROVENANCE_ORIGIN.declared, scale: 25.4, destination: 'mm' });
    recordSegmentProvenance('seg', 3, { origin: PROVENANCE_ORIGIN.asRead });
    recordSegmentProvenance('seg', 4, { sourceUnit: 'mm', origin: PROVENANCE_ORIGIN.encoded, scale: 'x', destination: 'unknown' });

    expect(getSegmentProvenance('seg', 2)).toEqual({ sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' });
    expect(getSegmentProvenance('seg', 3)).toEqual({ sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'unknown' });
    expect(getSegmentProvenance('seg', 4)).toEqual({ sourceUnit: 'mm', origin: 'encoded', scale: null, destination: 'unknown' });
    expect(Object.isFrozen(getSegmentProvenance('seg', 2))).toBe(true);
    expect(listSegmentProvenance('seg').map(record => record.segmentIndex)).toEqual([2, 3, 4]);
  });

  it('keeps segmentations apart, forgets a removed segment, and resets per segmentation or wholesale', () => {
    recordSegmentProvenance('a', 1, { sourceUnit: 'mm', origin: 'declared', scale: 1, destination: 'mm' });
    recordSegmentProvenance('b', 1, { sourceUnit: 'm', origin: 'declared', scale: 1000, destination: 'mm' });
    expect(getSegmentProvenance('a', 1).sourceUnit).toBe('mm');
    expect(getSegmentProvenance('b', 1).sourceUnit).toBe('m');

    forgetSegmentProvenance('a', 1);
    expect(getSegmentProvenance('a', 1)).toBeUndefined();
    expect(listSegmentProvenance('a')).toEqual([]);

    resetImportProvenance('b');
    expect(listSegmentProvenance('b')).toEqual([]);
    recordSegmentProvenance('c', 1, { sourceUnit: 'cm', origin: 'declared', scale: 10, destination: 'mm' });
    resetImportProvenance();
    expect(listSegmentProvenance('c')).toEqual([]);
  });

  it('ignores a record without a segmentation, a segment or a body', () => {
    recordSegmentProvenance(undefined, 1, { sourceUnit: 'mm' });
    recordSegmentProvenance('seg', 0, { sourceUnit: 'mm' });
    recordSegmentProvenance('seg', 1, null);
    expect(listSegmentProvenance('seg')).toEqual([]);
    expect(getSegmentProvenance('nothing', 1)).toBeUndefined();
  });
});

describe('watchSegmentProvenance', () => {
  const INCHES = { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' };
  let history;
  let service;
  let unwatch;
  beforeEach(() => {
    history = new HistoryMemo();
    service = segmentationServiceOver(history);
    unwatch = watchSegmentProvenance({ segmentationService: service, eventTarget: mockHub, history });
  });
  afterEach(() => unwatch());

  // An import adds its segments, then records where they came from
  const importSegment = record => {
    const segmentIndex = service.addSegment('seg', { label: 'model' });
    recordSegmentProvenance('seg', segmentIndex, record);
    return segmentIndex;
  };

  it('gives a segment added after the imported one was removed no record, though it takes the same index', () => {
    service.addSegment('seg');
    const imported = importSegment(INCHES);
    expect(imported).toBe(2);
    service.removeSegment('seg', imported);
    expect(getSegmentProvenance('seg', 2)).toBeUndefined();
    // Painted by hand at the index the removal freed
    expect(service.addSegment('seg')).toBe(2);
    expect(getSegmentProvenance('seg', 2)).toBeUndefined();
  });

  it('puts the record back on Undo of the removal, and takes it off again on Redo', () => {
    const imported = importSegment(INCHES);
    service.removeSegment('seg', imported);
    expect(getSegmentProvenance('seg', imported)).toBeUndefined();

    history.undo();
    expect(service.segments.seg[imported]).toBeDefined();
    expect(getSegmentProvenance('seg', imported)).toEqual(INCHES);

    history.redo();
    expect(service.segments.seg[imported]).toBeUndefined();
    expect(getSegmentProvenance('seg', imported)).toBeUndefined();

    history.undo();
    expect(getSegmentProvenance('seg', imported)).toEqual(INCHES);
  });

  it('keeps each removed segment\'s record with its own Undo entry', () => {
    const first = importSegment(INCHES);
    const second = importSegment({ sourceUnit: 'm', origin: 'declared', scale: 1000, destination: 'mm' });
    service.removeSegment('seg', second);
    service.removeSegment('seg', first);
    history.undo();
    expect(getSegmentProvenance('seg', first)).toEqual(INCHES);
    expect(getSegmentProvenance('seg', second)).toBeUndefined();
    history.undo();
    expect(getSegmentProvenance('seg', second)).toMatchObject({ sourceUnit: 'm' });
  });

  it('drops the record of a removal nothing can undo', () => {
    const imported = importSegment(INCHES);
    // An earlier removal of the same index holds its own record
    service.removeSegment('seg', imported);
    history.undo();
    service.removeSegment('seg', imported, { skipRecordingHistory: true });
    expect(getSegmentProvenance('seg', imported)).toBeUndefined();
    service.addSegment('seg', { segmentIndex: imported });
    expect(getSegmentProvenance('seg', imported)).toBeUndefined();
  });

  it('stops following the segments when the session ends', () => {
    const imported = importSegment(INCHES);
    unwatch();
    service.removeSegment('seg', imported);
    expect(getSegmentProvenance('seg', imported)).toEqual(INCHES);
    unwatch = () => {};
  });

  it('listens on the history\'s own event names', () => {
    expect(HISTORY_EVENTS).toEqual({ undo: 'CORNERSTONE_TOOLS_HISTORY_UNDO', redo: 'CORNERSTONE_TOOLS_HISTORY_REDO' });
  });
});
