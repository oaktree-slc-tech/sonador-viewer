// One rule decides what is drawn: the user's choice, the search and the active timepoint are kept
// apart, and the rule writes every store (service records, API-only representations, display
// annotations, registered stores). An annotation the user hid stays hidden when its timepoint is
// left and chosen again, and clearing the search shows nothing the user or the timepoint hides.

const mockOverlays = [];
const mockSetOverlayVisible = jest.fn((uid, visible) => {
  const overlay = mockOverlays.find(entry => entry.data.TrackingUniqueIdentifier === uid);
  if (overlay) {
    overlay.isVisible = visible;
  }
});
jest.mock('../readOnly/srDisplayAnnotations', () => ({
  getSRDisplayAnnotations: () => mockOverlays,
  setSRDisplayAnnotationVisible: (...args) => mockSetOverlayVisible(...args),
}));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} } }));

import {
  activeTimepointKeys, applyAnnotationVisibility, getSearchHidden, isUserVisible, resetAnnotationVisibility, setSearchHidden, setUserVisible,
} from './annotationVisibility';
import { registerVisibilityStore } from './visibilityStores';

const DEFAULT = 'TimepointId';
const DEFINED = 'timepoint:study:2.25.7';

function session() {
  const records = new Map();
  const service = {
    getMeasurements: () => [...records.values()],
    getMeasurement: uid => records.get(uid),
    toggleVisibilityMeasurement: jest.fn((uid, visible) => { records.get(uid).isVisible = visible; }),
  };
  const api = {
    measurementService: service,
    tools: { Length: [], DICOMSRDisplayTool: [] },
    active: DEFAULT,
    getActiveTimepointId() { return this.active; },
    timepointIdOf: entity => (entity && (entity.timepoint || (entity.metadata && entity.metadata.timepoint)
      || (entity.document && entity.document.timepoint))) || DEFAULT,
    updateMeasurement: jest.fn((toolType, representation) => representation),
    syncMeasurementsAndToolData: jest.fn(),
  };
  const record = (uid, _id, timepoint) => {
    records.set(uid, { uid, isVisible: true, metadata: { _id, timepoint } });
    api.tools.Length.push({ _id, uid, measurementData: { _measurementServiceId: uid } });
  };
  const representation = (_id, trackingUid, timepoint) =>
    api.tools.DICOMSRDisplayTool.push({ _id, isReadOnly: true, TrackingUniqueIdentifier: trackingUid, metadata: { timepoint } });
  return { api, records, record, representation };
}

const landmarkStore = () => {
  const entries = [];
  const hidden = new Set();
  const store = {
    id: 'landmarkSets',
    entries: () => entries,
    keyOf: entry => entry.key,
    isVisible: entry => !hidden.has(entry.key),
    setVisible: jest.fn((entry, visible) => (visible ? hidden.delete(entry.key) : hidden.add(entry.key))),
  };
  return { store, entries, hidden };
};

beforeEach(() => {
  resetAnnotationVisibility();
  mockOverlays.length = 0;
  mockSetOverlayVisible.mockClear();
});

it('draws an annotation when the user has not hidden it, the search keeps it and its timepoint is active', () => {
  const { api, records, record, representation } = session();
  record('svc-1', 'len-1', DEFAULT);
  record('svc-2', 'len-2', DEFINED);
  representation('ro-1', 'track-1', DEFAULT);
  representation('ro-2', 'track-2', DEFINED);
  mockOverlays.push({ isVisible: true, data: { TrackingUniqueIdentifier: 'track-2', srDocument: {} } });
  api.timepointIdOf = entity => (entity && entity.metadata && entity.metadata.srDocument ? DEFINED : (entity.metadata && entity.metadata.timepoint) || DEFAULT);

  expect(applyAnnotationVisibility(api)).toBe(3);
  expect(records.get('svc-1').isVisible).toBe(true);
  expect(records.get('svc-2').isVisible).toBe(false);
  expect(api.tools.DICOMSRDisplayTool[0].visible).not.toBe(false);
  expect(api.tools.DICOMSRDisplayTool[1].visible).toBe(false);
  // The display annotation follows the representation that holds its tracking UID
  expect(mockSetOverlayVisible).toHaveBeenCalledWith('track-2', false);

  api.active = DEFINED;
  applyAnnotationVisibility(api);
  expect(records.get('svc-1').isVisible).toBe(false);
  expect(records.get('svc-2').isVisible).toBe(true);
  expect(mockOverlays[0].isVisible).toBe(true);
});

it('keeps the user reason when the timepoint is left and chosen again, and apart from the search', () => {
  const { api, records, record } = session();
  record('svc-1', 'len-1', DEFAULT);
  record('svc-2', 'len-2', DEFAULT);
  setUserVisible('len-1', false);
  applyAnnotationVisibility(api);
  expect(records.get('svc-1').isVisible).toBe(false);
  expect(records.get('svc-2').isVisible).toBe(true);

  api.active = DEFINED;
  applyAnnotationVisibility(api);
  expect(records.get('svc-2').isVisible).toBe(false);
  api.active = DEFAULT;
  applyAnnotationVisibility(api);
  expect(records.get('svc-1').isVisible).toBe(false);
  expect(records.get('svc-2').isVisible).toBe(true);

  setSearchHidden(['len-2']);
  applyAnnotationVisibility(api);
  expect(records.get('svc-2').isVisible).toBe(false);
  expect([...getSearchHidden()]).toEqual(['len-2']);
  setSearchHidden([]);
  applyAnnotationVisibility(api);
  expect(records.get('svc-1').isVisible).toBe(false);
  expect(records.get('svc-2').isVisible).toBe(true);
  expect(isUserVisible('len-1')).toBe(false);
});

it('writes a registered store and lists the keys of the active timepoint', () => {
  const { api, record } = session();
  const { store, entries, hidden } = landmarkStore();
  const unregister = registerVisibilityStore(store);
  try {
    record('svc-1', 'len-1', DEFAULT);
    entries.push({ key: 'doc-a::set-1', document: { timepoint: DEFINED } }, { key: 'doc-b::set-2', document: { timepoint: DEFAULT } });

    applyAnnotationVisibility(api);
    expect([...hidden]).toEqual(['doc-a::set-1']);
    expect(activeTimepointKeys(api)).toEqual(['len-1', 'doc-b::set-2']);

    api.active = DEFINED;
    applyAnnotationVisibility(api);
    expect([...hidden]).toEqual(['doc-b::set-2']);
    expect(activeTimepointKeys(api)).toEqual(['doc-a::set-1']);
  } finally {
    unregister();
  }
});

it('resets every reason with the session', () => {
  setUserVisible('x', false);
  setSearchHidden(['y']);
  resetAnnotationVisibility();
  expect(isUserVisible('x')).toBe(true);
  expect(getSearchHidden().size).toBe(0);
});
