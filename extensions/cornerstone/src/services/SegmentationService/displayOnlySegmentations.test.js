// Display-only segmentation filtering (!87 note 37636).
//
// The labelmap bridge materialises one segmentation entry per extra rendering engine (the
// inspection modal) so a second WebGL context can carry its own labelmap volume. Those entries
// are presentation state: the service must keep them out of the domain roster and absorb their
// source add/remove/modified events, so opening and closing the lightbox is invisible to
// application consumers.
//
// The service under test is TypeScript; the mocks below cover exactly the module-load surface it
// destructures. The Cornerstone3D segmentation state is a plain Map the cases seed.

const mockSegmentationState = new Map();

jest.mock('@cornerstonejs/core', () => ({
  cache: {},
  Enums: {},
  eventTarget: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  geometryLoader: {},
  getEnabledElementByViewportId: jest.fn(),
  imageLoader: {},
  utilities: { HistoryMemo: { DefaultHistoryMemo: {} } },
  metaData: {},
}), { virtual: true });

jest.mock('@cornerstonejs/core/enums', () => ({ ViewportType: {} }), { virtual: true });

jest.mock('@cornerstonejs/tools', () => ({
  Enums: {
    SegmentationRepresentations: { Labelmap: 'Labelmap', Contour: 'Contour', Surface: 'Surface' },
    Events: {
      SEGMENTATION_MODIFIED: 'CORNERSTONE_TOOLS_SEGMENTATION_MODIFIED',
      SEGMENTATION_REMOVED: 'CORNERSTONE_TOOLS_SEGMENTATION_REMOVED',
      SEGMENTATION_DATA_MODIFIED: 'CORNERSTONE_TOOLS_SEGMENTATION_DATA_MODIFIED',
      SEGMENTATION_REPRESENTATION_MODIFIED: 'CORNERSTONE_TOOLS_SEGMENTATION_REPRESENTATION_MODIFIED',
      SEGMENTATION_REPRESENTATION_ADDED: 'CORNERSTONE_TOOLS_SEGMENTATION_REPRESENTATION_ADDED',
      SEGMENTATION_REPRESENTATION_REMOVED: 'CORNERSTONE_TOOLS_SEGMENTATION_REPRESENTATION_REMOVED',
      SEGMENTATION_ADDED: 'CORNERSTONE_TOOLS_SEGMENTATION_ADDED',
    },
  },
  segmentation: {
    getLabelmapImageIds: jest.fn(),
    helpers: { convertStackToVolumeLabelmap: jest.fn() },
    state: {
      addColorLUT: jest.fn(),
      updateLabelmapSegmentationImageReferences: jest.fn(),
      getSegmentation: id => mockSegmentationState.get(id),
      getSegmentations: () => [...mockSegmentationState.values()],
    },
    triggerSegmentationEvents: { triggerSegmentationRepresentationModified: jest.fn() },
  },
  annotation: {},
}), { virtual: true });

jest.mock('@ohif/core', () => {
  class PubSubService {
    constructor(EVENTS) {
      this.EVENTS = EVENTS;
      this.listeners = {};
    }
    subscribe(eventName, callback) {
      (this.listeners[eventName] = this.listeners[eventName] || []).push(callback);
      return { unsubscribe: () => {} };
    }
    _broadcastEvent(eventName, data) {
      (this.listeners[eventName] || []).forEach(callback => callback(data));
    }
    reset() {
      this.listeners = {};
    }
  }
  return { PubSubService };
}, { virtual: true });

jest.mock('@ohif/i18n', () => ({}), { virtual: true });
jest.mock('./RTSTRUCT/mapROIContoursToRTStructData', () => ({
  mapROIContoursToRTStructData: jest.fn(),
}));

const SegmentationService = require('./SegmentationService').default;

const CANONICAL_ID = 'series0_0';
const DERIVED_ID = `${CANONICAL_ID}::inspection`;

function seedCanonical() {
  mockSegmentationState.set(CANONICAL_ID, {
    segmentationId: CANONICAL_ID,
    cachedStats: { sonadorCanonicalSegmentation: true },
  });
}

function seedDerived() {
  mockSegmentationState.set(DERIVED_ID, {
    segmentationId: DERIVED_ID,
    cachedStats: { sonadorDerivedFromSegmentation: CANONICAL_ID },
  });
}

function recorded(service, eventName) {
  const events = [];
  service.subscribe(eventName, detail => events.push(detail));
  return events;
}

let service;

beforeEach(() => {
  mockSegmentationState.clear();
  service = new SegmentationService({ servicesManager: { services: {} } });
});

describe('display-only segmentations stay out of the domain roster', () => {
  it('getSegmentations returns only the canonical segmentation', () => {
    seedCanonical();
    seedDerived();

    const roster = service.getSegmentations();
    expect(roster.map(s => s.segmentationId)).toEqual([CANONICAL_ID]);
  });

  it('lightbox open/close raises no domain add or remove', () => {
    seedCanonical();
    const added = recorded(service, service.EVENTS.SEGMENTATION_ADDED);
    const removed = recorded(service, service.EVENTS.SEGMENTATION_REMOVED);

    // Open: the bridge registers the derived entry (flag already on it) and the library fires
    // SEGMENTATION_ADDED for it.
    seedDerived();
    service._onSegmentationAddedFromSource({ detail: { segmentationId: DERIVED_ID } });

    // Close: the entry is removed from state BEFORE the event fires, so classification relies on
    // the remembered id.
    mockSegmentationState.delete(DERIVED_ID);
    service._onSegmentationRemovedFromSource({ detail: { segmentationId: DERIVED_ID } });

    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('canonical add and remove still broadcast', () => {
    const added = recorded(service, service.EVENTS.SEGMENTATION_ADDED);
    const removed = recorded(service, service.EVENTS.SEGMENTATION_REMOVED);

    seedCanonical();
    service._onSegmentationAddedFromSource({ detail: { segmentationId: CANONICAL_ID } });
    mockSegmentationState.delete(CANONICAL_ID);
    service._onSegmentationRemovedFromSource({ detail: { segmentationId: CANONICAL_ID } });

    expect(added).toEqual([{ segmentationId: CANONICAL_ID }]);
    expect(removed).toEqual([{ segmentationId: CANONICAL_ID }]);
  });

  it('recognises the removal of a pre-existing derived entry it never saw added', () => {
    // The service (re)initializes while the lightbox is already open -- the add event happened
    // before this instance existed. Seeding from flagged state at init keeps the eventual
    // removal out of the domain events.
    seedCanonical();
    seedDerived();
    service._initSegmentationService();

    const removed = recorded(service, service.EVENTS.SEGMENTATION_REMOVED);
    mockSegmentationState.delete(DERIVED_ID);
    service._onSegmentationRemovedFromSource({ detail: { segmentationId: DERIVED_ID } });

    expect(removed).toEqual([]);
  });

  it('filters an editor working copy from the roster but lets its events flow', () => {
    // A Seg-Editor working segmentation (sonadorEditorWorkingCopyOf) is session state: other
    // surfaces must not list it, but the editor's own UI drives it through this service, so its
    // events are NOT absorbed.
    seedCanonical();
    const workingId = `${CANONICAL_ID}::edit`;
    mockSegmentationState.set(workingId, {
      segmentationId: workingId,
      cachedStats: { sonadorEditorWorkingCopyOf: CANONICAL_ID },
    });

    expect(service.getSegmentations().map(s => s.segmentationId)).toEqual([CANONICAL_ID]);

    const modified = recorded(service, service.EVENTS.SEGMENTATION_MODIFIED);
    service._onSegmentationModifiedFromSource({ detail: { segmentationId: workingId } });
    expect(modified).toEqual([{ segmentationId: workingId }]);
  });

  it('absorbs modified, data-modified and representation events for the derived entry', () => {
    seedCanonical();
    seedDerived();
    const modified = recorded(service, service.EVENTS.SEGMENTATION_MODIFIED);
    const dataModified = recorded(service, service.EVENTS.SEGMENTATION_DATA_MODIFIED);
    const representationModified = recorded(
      service, service.EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED);

    service._onSegmentationModifiedFromSource({ detail: { segmentationId: DERIVED_ID } });
    service._onSegmentationDataModifiedFromSource({ detail: { segmentationId: DERIVED_ID } });
    service._onSegmentationRepresentationModifiedFromSource({
      detail: { segmentationId: DERIVED_ID, viewportId: 'lightbox-viewport' },
    });

    // The canonical segmentation's events are untouched.
    service._onSegmentationModifiedFromSource({ detail: { segmentationId: CANONICAL_ID } });

    expect(modified).toEqual([{ segmentationId: CANONICAL_ID }]);
    expect(dataModified).toEqual([]);
    expect(representationModified).toEqual([]);
  });
});
