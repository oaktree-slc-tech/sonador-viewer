// The legacy labelmap <-> Cornerstone3D bridge.
//
// What the mocks model, and why they are shaped this way:
//
//   * `volumeLoader.createLocalVolume` is reproduced faithfully from @cornerstonejs/core 4.22.13 --
//     one local image per slice, each holding `scalarData.subarray(...)`. The aliasing this module
//     depends on IS that subarray, so a mock that copied would test nothing.
//   * `triggerSegmentationDataModified` dispatches SEGMENTATION_DATA_MODIFIED on the Cornerstone3D
//     event target, as the library's does. That is what makes the re-entrancy cases meaningful: the
//     legacy -> Cornerstone3D direction genuinely re-enters the listener for the other direction.
//   * legacy elements are minimal event targets, because cornerstone-core dispatches
//     LABELMAP_MODIFIED on the element without bubbling and this module binds per element.

function makeTarget(name) {
  const listeners = new Map();

  const target = {
    name,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      const forType = listeners.get(type) || [];
      const index = forType.indexOf(handler);
      if (index >= 0) {
        forType.splice(index, 1);
      }
    },
    dispatch: (type, detail) => {
      [...(listeners.get(type) || [])].forEach(handler =>
        handler({ type, detail, currentTarget: target }));
    },
    listenerCount: type => (listeners.get(type) || []).length,
    clear: () => listeners.clear(),
  };

  return target;
}

const MOCK_LABELMAP_MODIFIED = 'cornersontetoolslabelmapmodified';

// --- legacy cornerstone-core / cornerstone-tools ------------------------------------------------

const mockLegacyEvents = makeTarget('cornerstone.events');
const mockEnabledElements = [];
const mockUpdateImage = jest.fn();

jest.mock('cornerstone-core', () => ({
  EVENTS: {
    ELEMENT_ENABLED: 'cornerstoneelementenabled',
    ELEMENT_DISABLED: 'cornerstoneelementdisabled',
  },
  events: mockLegacyEvents,
  getEnabledElements: () => mockEnabledElements,
  updateImage: (...args) => mockUpdateImage(...args),
}));

const mockSegmentationModuleState = { series: {}, colorLutTables: {} };
const mockStackToolState = new Map();

jest.mock('cornerstone-tools', () => ({
  EVENTS: { LABELMAP_MODIFIED: MOCK_LABELMAP_MODIFIED },
  getModule: () => ({ state: mockSegmentationModuleState }),
  getToolState: element => mockStackToolState.get(element),
}));

// --- Cornerstone3D ------------------------------------------------------------------------------

const mockC3dEventTarget = makeTarget('c3d.eventTarget');
const mockVolumeCache = new Map();
const mockImageCache = new Map();

// The cache's internal per-image entries, as the bridge's eviction pin reaches them: `cachedImage`
// wrappers whose `sharedCacheKey` stamp is what `decacheIfNecessaryUntilBytesAvailable` respects.
const mockImageCacheEntries = new Map();

// `genericMetadataProvider` storage: `createAndCacheLocalImage` self-registers imagePlaneModule /
// imagePixelModule there, and the bridge adds generalSeriesModule for the durable stack ids.
const mockGenericMetadata = new Map();

// Per-test hooks: cache admission side effects (adversarial eviction), the cache-fit answer,
// and injected failures for image/metadata/volume creation.
let mockOnImageAdmitted = null;
let mockIsCacheable = null;
let mockImageCreateFailure = null;
let mockMetadataAddFailure = null;
let mockVolumeCreateFailure = null;

function mockCacheImage(imageId, image) {
  if (mockImageCache.has(imageId)) {
    throw new Error('putImageSync: imageId already in cache');
  }
  mockImageCache.set(imageId, image);
  mockImageCacheEntries.set(imageId, { imageId, sharedCacheKey: undefined });
  if (mockOnImageAdmitted) {
    mockOnImageAdmitted(imageId);
  }
}

function mockCreateAndCacheLocalImage(imageId, options) {
  if (mockImageCreateFailure && mockImageCreateFailure(imageId)) {
    throw new Error(`injected createAndCacheLocalImage failure for ${imageId}`);
  }
  // Faithful to @cornerstonejs/core 4.22.13 `createAndCacheLocalImage` in what the bridge relies
  // on: the image's pixel data IS the caller's (sub)array, and imagePlaneModule/imagePixelModule
  // are registered for the id (per-slice origin included) so a volume can later be rebuilt from
  // metadata alone.
  const { scalarData, dimensions, spacing, origin, direction } = options;

  mockGenericMetadata.set(`imagePlaneModule:${imageId}`, {
    imagePositionPatient: origin,
    imageOrientationPatient: direction,
    pixelSpacing: [spacing[1], spacing[0]],
    rows: dimensions[1],
    columns: dimensions[0],
  });
  mockGenericMetadata.set(`imagePixelModule:${imageId}`, {
    bitsAllocated: 8, rows: dimensions[1], columns: dimensions[0],
  });

  const image = {
    imageId,
    getPixelData: () => scalarData,
    voxelManager: { getScalarData: () => scalarData },
  };
  mockCacheImage(imageId, image);
  return image;
}

function mockCreateAndCacheVolumeFromImagesSync(volumeId, imageIds) {
  if (mockVolumeCreateFailure && mockVolumeCreateFailure(volumeId)) {
    throw new Error(`injected createAndCacheVolumeFromImagesSync failure for ${volumeId}`);
  }
  // Faithful essentials of the 4.22.13 sync path: returns the cached volume for a repeat id,
  // throws via putVolumeSync semantics otherwise never duplicates, and builds an ImageVolume whose
  // voxel access goes THROUGH the cached images -- no scalar copy of its own.
  const cached = mockVolumeCache.get(volumeId);
  if (cached) {
    return cached;
  }

  imageIds.forEach(imageId => {
    if (!mockImageCache.has(imageId)) {
      throw new Error(`createAndCacheVolumeFromImagesSync: ${imageId} not cached`);
    }
  });

  const first = mockGenericMetadata.get(`imagePlaneModule:${imageIds[0]}`) || {};
  const volume = {
    volumeId,
    imageIds: [...imageIds],
    dimensions: [first.columns || COLUMNS, first.rows || ROWS, imageIds.length],
  };
  mockVolumeCache.set(volumeId, volume);
  return volume;
}

// `generateVolumePropsFromImageIds` reads the imageIds' metadata and returns the volume geometry
// plus `imageIds` SORTED into the canonical slice order. `mockCanonicalOrder` is what a case sets to
// make the canonical order differ from the classic stack order.
let mockCanonicalOrder = null;

function mockGenerateVolumeProps(imageIds, volumeId) {
  return {
    volumeId,
    dimensions: [COLUMNS, ROWS, imageIds.length],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    metadata: {},
    imageIds: [...(mockCanonicalOrder || imageIds)],
    dataType: 'Uint16Array',
  };
}

function mockCreateLocalVolume(volumeId, options) {
  const { dimensions, scalarData, referencedVolumeId } = options;
  const sliceLength = dimensions[0] * dimensions[1];
  const imageIds = [];

  for (let i = 0; i < dimensions[2]; i++) {
    const imageId = `${volumeId}_slice_${i}`;
    const sliceData = scalarData.subarray(i * sliceLength, (i + 1) * sliceLength);

    // `cache.putImageSync` THROWS on a duplicate id at 4.22.13. Modelled, because a rebuild that
    // cannot re-cache its slice images is exactly the failure this suite let through.
    if (mockImageCache.has(imageId)) {
      throw new Error('putImageSync: imageId already in cache');
    }

    mockImageCache.set(imageId, {
      imageId,
      voxelManager: { getScalarData: () => sliceData },
    });
    imageIds.push(imageId);
  }

  // `cache.putVolumeSync` also throws on a duplicate volumeId at 4.22.13.
  if (mockVolumeCache.has(volumeId)) {
    throw new Error('putVolumeSync: volumeId already in cache');
  }

  const volume = { volumeId, imageIds, dimensions, referencedVolumeId, scalarData };
  mockVolumeCache.set(volumeId, volume);
  return volume;
}

function mockCreateDerivedLabelmapVolume(referencedVolumeId, options) {
  const reference = mockVolumeCache.get(referencedVolumeId);
  const { dimensions } = reference;
  const sliceLength = dimensions[0] * dimensions[1];

  // The copy path: Cornerstone3D allocates its own Uint8 store, as
  // `mockCreateDerivedLabelmapVolume` does through its `targetBuffer` default.
  const scalarData = new Uint8Array(sliceLength * dimensions[2]);
  const volume = mockCreateLocalVolume(options.volumeId, {
    dimensions, scalarData, referencedVolumeId,
  });

  // `createImageVolumeVoxelManager` exposes no `scalarData` of its own -- the data lives in the
  // per-slice images -- which is what makes the caller populate it explicitly.
  volume.voxelManager = {
    setCompleteScalarDataArray: next => scalarData.set(next),
  };

  return volume;
}

jest.mock('@cornerstonejs/core', () => ({
  cache: {
    getVolume: id => mockVolumeCache.get(id),
    getImage: id => mockImageCache.get(id),
    getVolumeLoadObject: id => (mockVolumeCache.has(id) ? { promise: null } : undefined),
    removeVolumeLoadObject: id => {
      // Faithful `_decacheVolume` fragment: the volume goes, its images stay, and sharedCacheKey
      // stamps matching THIS volumeId are cleared from them.
      const volume = mockVolumeCache.get(id);
      if (volume && volume.imageIds) {
        volume.imageIds.forEach(imageId => {
          const entry = mockImageCacheEntries.get(imageId);
          if (entry && entry.sharedCacheKey === id) {
            entry.sharedCacheKey = undefined;
          }
        });
      }
      mockVolumeCache.delete(id);
    },
    getImageLoadObject: id => (mockImageCache.has(id) ? { promise: null } : undefined),
    removeImageLoadObject: (id, options) => {
      if (!mockImageCache.has(id)) {
        throw new Error('removeImageLoadObject: imageId was not present in imageCache');
      }
      // Faithful `_decacheImage` at 4.22.13: an image carrying ANY sharedCacheKey refuses
      // removal unless forced -- the durable-stack code must unpin before it removes.
      const entry = mockImageCacheEntries.get(id);
      if (entry && entry.sharedCacheKey && !(options && options.force)) {
        throw new Error(
          'Cannot decache an image with a shared cache key. You need to manually decache the '
          + 'volume first.');
      }
      mockImageCache.delete(id);
      mockImageCacheEntries.delete(id);
    },
    _imageCache: { get: id => mockImageCacheEntries.get(id) },
    isCacheable: byteLength => (mockIsCacheable ? mockIsCacheable(byteLength) : true),
  },
  utilities: {
    generateVolumePropsFromImageIds: (...args) => mockGenerateVolumeProps(...args),
    genericMetadataProvider: {
      add: (imageId, { type, metadata }) => {
        if (mockMetadataAddFailure && mockMetadataAddFailure(imageId, type)) {
          throw new Error(`injected genericMetadataProvider.add failure for ${imageId}`);
        }
        mockGenericMetadata.set(`${type}:${imageId}`, metadata);
      },
    },
  },
  eventTarget: mockC3dEventTarget,
  imageLoader: {
    createAndCacheLocalImage: (...args) => mockCreateAndCacheLocalImage(...args),
  },
  volumeLoader: {
    createLocalVolume: (...args) => mockCreateLocalVolume(...args),
    createAndCacheDerivedLabelmapVolume: (...args) => mockCreateDerivedLabelmapVolume(...args),
    createAndCacheVolumeFromImagesSync: (...args) => mockCreateAndCacheVolumeFromImagesSync(...args),
  },
}), { virtual: true });

const mockC3dSegmentationState = new Map();
const mockC3dRepresentations = new Map();
const mockAddSegmentations = jest.fn(segmentations => {
  segmentations.forEach(seg => {
    mockC3dSegmentationState.set(seg.segmentationId, {
      segmentationId: seg.segmentationId,
      segments: (seg.config && seg.config.segments) || {},
      // As `normalizeSegmentationInput` at 4.22.13: `cachedStats: config?.cachedStats ?? {}` --
      // which is what lets a display-only flag be ON the entry when SEGMENTATION_ADDED fires.
      cachedStats: { ...((seg.config && seg.config.cachedStats) || {}) },
      representationData: { Labelmap: seg.representation.data },
    });
  });
});
const mockRemoveSegmentation = jest.fn(id => mockC3dSegmentationState.delete(id));
const mockUpdateSegmentations = jest.fn(updates => {
  updates.forEach(({ segmentationId, payload }) => {
    const segmentation = mockC3dSegmentationState.get(segmentationId);
    if (!segmentation) {
      return;
    }
    Object.assign(segmentation, payload);
    // The pinned build emits SEGMENTATION_MODIFIED from BOTH the state manager's
    // updateSegmentation and the updateSegmentations wrapper -- two events per update.
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId });
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId });
  });
});
const mockSetActiveSegmentIndex = jest.fn();
const mockSetSegmentIndexVisibility = jest.fn();

jest.mock('@cornerstonejs/tools', () => ({
  Enums: {
    SegmentationRepresentations: { Labelmap: 'Labelmap' },
    Events: {
      SEGMENTATION_DATA_MODIFIED: 'SEGMENTATION_DATA_MODIFIED',
      SEGMENTATION_MODIFIED: 'SEGMENTATION_MODIFIED',
      SEGMENTATION_REPRESENTATION_MODIFIED: 'SEGMENTATION_REPRESENTATION_MODIFIED',
      SEGMENTATION_REMOVED: 'SEGMENTATION_REMOVED',
    },
  },
  segmentation: {
    updateSegmentations: (...args) => mockUpdateSegmentations(...args),
    state: {
      addSegmentations: (...args) => mockAddSegmentations(...args),
      removeSegmentation: (...args) => mockRemoveSegmentation(...args),
      getSegmentation: id => mockC3dSegmentationState.get(id),
      getSegmentations: () => [...mockC3dSegmentationState.values()],
      // Per-segmentation, as the library: only viewports actually carrying a representation of
      // THIS segmentation.
      getViewportIdsWithSegmentation: segmentationId => [...mockC3dRepresentations.entries()]
        .filter(([, reps]) => reps.some(rep => rep.segmentationId === segmentationId))
        .map(([viewportId]) => viewportId),
      getSegmentationRepresentations: viewportId => mockC3dRepresentations.get(viewportId) || [],
    },
    config: {
      visibility: { setSegmentIndexVisibility: (...args) => mockSetSegmentIndexVisibility(...args) },
    },
    segmentIndex: { setActiveSegmentIndex: (...args) => mockSetActiveSegmentIndex(...args) },
    triggerSegmentationEvents: {
      triggerSegmentationDataModified: (segmentationId, modifiedSlicesToUse) =>
        mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
          segmentationId, modifiedSlicesToUse,
        }),
    },
  },
}), { virtual: true });

let mockAppConfig = {};

// What the phase-0 probe found. `norm16: false` is a real client (GTX 980 via ANGLE) on which a
// 16-bit labelmap becomes a 4-byte R32F texture instead of a 2-byte one.
let mockGpuCapabilities = { norm16: true };

jest.mock('@ohif/core', () => ({
  utils: {
    cornerstone3dUtils: { getCornerstone3dConfig: () => mockAppConfig },
    gpuCapabilities: { getGpuCapabilities: () => mockGpuCapabilities },
  },
}), { virtual: true });

// The bridge's panel-facing signals are document-level DOM CustomEvents, and this jest project runs
// in the node environment (there is no jsdom in this repository). Both are shimmed rather than
// pulled in: the bridge only ever calls `addEventListener` / `removeEventListener` /
// `dispatchEvent`, and reads `event.type` and `event.detail`.
const mockDocument = (() => {
  const listeners = new Map();

  return {
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      const forType = listeners.get(type) || [];
      const index = forType.indexOf(handler);
      if (index >= 0) {
        forType.splice(index, 1);
      }
    },
    dispatchEvent: event => {
      [...(listeners.get(event.type) || [])].forEach(handler => handler(event));
      return true;
    },
    listenerCount: type => (listeners.get(type) || []).length,
    clear: () => listeners.clear(),
  };
})();

class MockCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = (init || {}).detail;
  }
}

global.document = mockDocument;
global.CustomEvent = MockCustomEvent;

const LABELMAP_STATE_EVENT = 'extensiondicomsegmentationlabelmapstatemodified';
const SEG_LOADED_EVENT = 'extensiondicomsegmentationsegloaded';
const METADATA_MODIFIED_EVENT = 'extensiondicomsegmentationlabelmapmetadatamodified';

// The real dcmjs SEG adapter. `fillSegmentation` is the entire labelmap-reading half of
// `generateSegmentation(images, labelmaps3D)`: `_createSegFromImages` builds the derived dataset
// from the DICOM images and never looks at the labelmap, and `fillSegmentation` reads the labelmap
// and never looks at the images. Driving it directly is what makes an adapter-level comparison
// possible here -- `_createSegFromImages` needs real DICOM P10 byte arrays
// (`image.data.byteArray.buffer`) per slice, and this repository carries no DICOM fixtures.
const { fillSegmentation } = require('dcmjs').adapters.Cornerstone.Segmentation;

const {
  attachDerivedSegmentationDisplay,
  attachSegmentationDisplay,
  detachDerivedSegmentationDisplay,
  forkSegmentationForEditor,
  pushLegacyLabelmapModified,
  releaseEditorWorkingCopy,
  ensureLegacyLabelmapView,
  getCanonicalSegmentationsForSeries,
  getSegmentationVoxels,
  attachSegmentationService,
  createCanonicalSegmentation,
  detachSegmentationDisplay,
  getCanonicalSegmentation,
  getLabelmapRegistration,
  mirrorLegacyMetadataToCornerstone3d,
  noteReferencedVolume,
  removeCanonicalSegmentation,
  resolveLegacyViewPlacement,
} = require('./labelmapBridge.js');


// --- fixtures -----------------------------------------------------------------------------------

const COLUMNS = 2;
const ROWS = 2;
const SLICE_LENGTH = COLUMNS * ROWS;
const SLICES = 5;

const FIRST_IMAGE_ID = 's0';
const IMAGE_VOLUME_ID = 'cornerstoneStreamingImageVolume:ds-1';
const SEGMENTATION_ID = `${FIRST_IMAGE_ID}_0`;

let stackImageIds;
let labelmap3D;
let parsedLabelmap;
let segMetadata;
let element;
let registeredIds;

function makeReferenceVolume(volumeImageIds) {
  const volume = {
    volumeId: IMAGE_VOLUME_ID,
    imageIds: volumeImageIds,
    dimensions: [COLUMNS, ROWS, volumeImageIds.length],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    metadata: {},
    getImageIdIndex: id => volumeImageIds.indexOf(id),
  };

  mockVolumeCache.set(IMAGE_VOLUME_ID, volume);
  return volume;
}

function makeSegMetadata() {
  // The dcmjs `generateToolState` shape: `{ seriesInstanceUid, data: [...] }`, indexed by segment
  // number with a hole at 0.
  return { seriesInstanceUid: '1.2.3', data: [undefined, { SegmentNumber: 1, SegmentLabel: 'Liver' }] };
}

function makeParsedLabelmap() {
  // What the SEG parser hands the importer: one contiguous Uint16 buffer in the order of the
  // imageIds it was parsed against (the classic stack order). Stack slice 2 carries segment 1.
  const parsed = new Uint16Array(SLICE_LENGTH * SLICES);
  parsed[2 * SLICE_LENGTH] = 1;
  return parsed;
}

function importSegmentation(overrides) {
  // What `loadSegmentation.js` does: create the primary record and the legacy view. No display
  // state, no holds.
  overrides = overrides || {};

  createCanonicalSegmentation({
    segmentationId: SEGMENTATION_ID,
    imageIds: stackImageIds,
    labelmapBuffer: parsedLabelmap,
    segMetadata,
    firstImageId: FIRST_IMAGE_ID,
    labelmapIndex: 0,
    colorLUTIndex: 0,
    referencedVolumeId: IMAGE_VOLUME_ID,
    ...(overrides.canonical || {}),
  });

  if (!registeredIds.includes(SEGMENTATION_ID)) {
    registeredIds.push(SEGMENTATION_ID);
  }
  // Undefined under lazy install; eager everywhere else.
  labelmap3D = mockSegmentationModuleState.series[FIRST_IMAGE_ID]
    ? mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]
    : undefined;
  return getCanonicalSegmentation(SEGMENTATION_ID);
}

function register(overrides) {
  // The production sequence end to end: importer creates, then a view attaches its display hold.
  overrides = overrides || {};

  if (!getCanonicalSegmentation(SEGMENTATION_ID)) {
    importSegmentation(overrides);
  }

  const volume = attachSegmentationDisplay(SEGMENTATION_ID);
  const record = getCanonicalSegmentation(SEGMENTATION_ID);
  const registration = getLabelmapRegistration(SEGMENTATION_ID);
  labelmap3D = registration.labelmap3D;

  return { record, registration, volume, shared: false };
}

beforeEach(() => {
  jest.clearAllMocks();

  // Both event targets are module state the bridge captured at import, so they are emptied here
  // rather than replaced. Safe: `afterEach` has already released every registration.
  mockC3dEventTarget.clear();
  mockLegacyEvents.clear();
  mockDocument.clear();

  mockAppConfig = {};
  mockGpuCapabilities = { norm16: true };
  mockOnImageAdmitted = null;
  mockIsCacheable = null;
  mockImageCreateFailure = null;
  mockMetadataAddFailure = null;
  mockVolumeCreateFailure = null;
  mockVolumeCache.clear();
  mockImageCache.clear();
  mockImageCacheEntries.clear();
  mockGenericMetadata.clear();
  mockC3dSegmentationState.clear();
  mockC3dRepresentations.clear();
  mockStackToolState.clear();
  mockEnabledElements.length = 0;
  registeredIds = [];

  stackImageIds = ['s0', 's1', 's2', 's3', 's4'];
  mockCanonicalOrder = null;
  makeReferenceVolume([...stackImageIds]);

  parsedLabelmap = makeParsedLabelmap();
  segMetadata = makeSegMetadata();
  labelmap3D = undefined;

  // The legacy segmentation module starts EMPTY. Nothing puts a labelmap in it but the bridge.
  mockSegmentationModuleState.series = {};
  mockSegmentationModuleState.colorLutTables = { 0: [[0, 0, 0, 0], [10, 20, 30, 255]] };

  element = makeTarget('element');
  mockEnabledElements.push({ element });
  mockStackToolState.set(element, {
    data: [{ imageIds: stackImageIds, currentImageIdIndex: 2 }],
  });
});

afterEach(() => {
  // Only an explicit removal destroys a segmentation (FR-8), so that is what the teardown uses.
  registeredIds.forEach(id => removeCanonicalSegmentation(id));
});


// --- creation, the slice-order check, and the legacy view ---------------------------------------

describe('registration', () => {
  it('backs the display volume with the record array itself -- one voxel allocation while open', async () => {
    const { volume, record } = register();

    // Every slice image views the record's decoded array directly: no per-session voxel copy. The
    // per-generation objects are the volume, its slice images and its texture -- the things that
    // are GL-bound -- not the buffer.
    volume.imageIds.forEach(imageId => {
      const sliceData = mockImageCache.get(imageId).voxelManager.getScalarData();
      expect(sliceData).toBeInstanceOf(Uint8Array);
      expect(Object.is(sliceData.buffer, record.scalarData.buffer)).toBe(true);
    });
  });

  it('a display edit is a record edit immediately; the event carries it to the legacy view', async () => {
    const { volume, record } = register();

    mockImageCache.get(volume.imageIds[3]).voxelManager.getScalarData()[1] = 7;

    // Aliased, so the record has it at once ...
    expect(record.scalarData[3 * SLICE_LENGTH + 1]).toBe(7);

    // ... while the legacy view waits for the modification event, as ever.
    expect(new Uint16Array(labelmap3D.buffer)[3 * SLICE_LENGTH + 1]).toBe(0);
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [3],
    });
    expect(new Uint16Array(labelmap3D.buffer)[3 * SLICE_LENGTH + 1]).toBe(7);
  });

  it('leaves the canonical voxels untouched when a view comes and goes', async () => {
    // The legacy view is derived state. Installing one, and removing it again, must not perturb the
    // segmentation Cornerstone3D owns -- that is what FR-8 protects and what a serializer reads.
    const { record } = register();
    const before = record.scalarData.slice();

    detachSegmentationDisplay(SEGMENTATION_ID);
    register();

    expect(Array.from(record.scalarData)).toEqual(Array.from(before));

    // The record is DERIVED from Cornerstone3D state on every read, not held here, so identity is
    // asserted on the things it points at rather than on the wrapper.
    // The VOXELS are the invariant. Everything Cornerstone3D holds -- the segmentation entry, its
    // representations, the volume and its texture -- is a materialisation, dropped with the last
    // view and rebuilt over the same buffer.
    const after = getCanonicalSegmentation(SEGMENTATION_ID);
    expect(Object.is(after.scalarData.buffer, record.scalarData.buffer)).toBe(true);
    expect(after.segmentation).toBeDefined();
    expect(after.segMetadata.seriesInstanceUid).toBe('1.2.3');
  });

  it('seeds the canonical store in canonical order when it differs from the stack', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCanonicalOrder = ['s2', 's0', 's1', 's3', 's4'];

    const { record } = register();

    // The parser hands the labelmap over in stack order, with segment 1 on stack slice 2. In
    // canonical order that slice is first, and the store must reflect that or the overlay is
    // misregistered against the image volume.
    expect(record.scalarData[0]).toBe(1);
    expect(record.scalarData[2 * SLICE_LENGTH]).toBe(0);

    // ... and the legacy view maps back the other way.
    expect(new Uint16Array(labelmap3D.buffer)[2 * SLICE_LENGTH]).toBe(1);
  });

  it('the legacy view is always a bridge-owned copy -- there is no sharing switch', async () => {
    // The `shareLabelmapBuffer` switch is removed per the #136 AR-5 disposition (note 37720):
    // the Uint8 canonical store can never be viewed by the 16-bit legacy module, so the copy is
    // structural, not configurable.
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { shared, registration } = await register();
    expect(shared).toBe(false);
    expect(resolveLegacyViewPlacement(registration, stackImageIds).shared).toBe(false);
  });

  it('is reference counted by views, and the registration outlives the display', async () => {
    register();
    register();

    expect(getLabelmapRegistration(SEGMENTATION_ID).holders).toBe(2);

    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(getLabelmapRegistration(SEGMENTATION_ID).volume).toBeDefined();

    detachSegmentationDisplay(SEGMENTATION_ID);

    // Display retired; the registration -- the legacy view and its bookkeeping -- persists for the
    // classic viewport, until an explicit removal destroys the segmentation.
    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    expect(registration).toBeDefined();
    expect(registration.volume).toBeNull();
    expect(registration.holders).toBe(0);

    removeCanonicalSegmentation(SEGMENTATION_ID);
    expect(getLabelmapRegistration(SEGMENTATION_ID)).toBeUndefined();
  });

  it('leaves the canonical segmentation intact when the display goes (FR-8)', async () => {
    const { record, volume } = register();

    // An edit lands in the display copy and syncs on detach.
    mockImageCache.get(volume.imageIds[0]).voxelManager.getScalarData()[0] = 9;

    detachSegmentationDisplay(SEGMENTATION_ID, { force: true });

    // The segmentation and its voxels survive; the volume is rebuilt on demand over the same
    // memory, which is how each WebGL context gets a texture of its own.
    const after = getCanonicalSegmentation(SEGMENTATION_ID);
    expect(after).toBeDefined();
    expect(after.scalarData[0]).toBe(9);
    expect(Object.is(after.scalarData.buffer, record.scalarData.buffer)).toBe(true);

    // The registration and the legacy view persist -- the classic viewport may still be showing
    // the series. Only the display materialisation went: the LOGICAL segmentation stays in
    // Cornerstone3D state (stack-backed), its volumeId cleared, with no removal event raised.
    expect(getLabelmapRegistration(SEGMENTATION_ID).volume).toBeNull();
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockRemoveSegmentation).not.toHaveBeenCalled();
    const labelmapData = mockC3dSegmentationState.get(SEGMENTATION_ID).representationData.Labelmap;
    expect(labelmapData.volumeId).toBeUndefined();
    expect(labelmapData.imageIds.length).toBe(SLICES);
  });

  it('is removed only by an explicit removal (FR-8)', async () => {
    register();
    removeCanonicalSegmentation(SEGMENTATION_ID);

    expect(getCanonicalSegmentation(SEGMENTATION_ID)).toBeUndefined();
    expect(mockRemoveSegmentation).toHaveBeenCalledWith(SEGMENTATION_ID);
  });
});

describe('resolveLegacyViewPlacement', () => {
  it('never shares -- it computes the carry map for identity and shuffled orders alike', () => {
    const record = createCanonicalSegmentation({
      segmentationId: SEGMENTATION_ID,
      imageIds: stackImageIds,
      labelmapBuffer: parsedLabelmap,
      segMetadata,
    });
    registeredIds.push(SEGMENTATION_ID);

    // Never shared: the canonical store is 8-bit, which is what the labelmap renderer needs, and
    // the legacy module can only view 16-bit memory.
    const identity = resolveLegacyViewPlacement(record, stackImageIds);
    expect(identity.shared).toBe(false);
    expect(identity.reason).toMatch(/8-bit/);

    // The slice map is still computed by imageId, not by position -- it is what the copy uses.
    expect(identity.sliceMap).toEqual([0, 1, 2, 3, 4]);
    expect(resolveLegacyViewPlacement(record, ['s2', 's0', 's1', 's3', 's4']).sliceMap)
      .toEqual([2, 0, 1, 3, 4]);
  });
});


// --- FR-2: legacy -> Cornerstone3D --------------------------------------------------------------

describe('legacy edits reaching Cornerstone3D', () => {
  it('marks only the slices a stroke touched, and does not echo back', async () => {
    await register();

    const dataModified = jest.fn();
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', dataModified);

    // A stroke on slice 4: the tool writes the voxels and hands the slice a fresh
    // `segmentsOnLabelmap`, which is the only evidence of which slices it touched.
    const pixelData = new Uint16Array(labelmap3D.buffer, 4 * SLICE_LENGTH * 2, SLICE_LENGTH);
    pixelData[0] = 1;
    labelmap3D.labelmaps2D[4] = { pixelData, segmentsOnLabelmap: [0, 1] };

    // ... and the viewport is showing slice 4 while it happens.
    mockStackToolState.get(element).data[0].currentImageIdIndex = 4;
    element.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });

    expect(dataModified).toHaveBeenCalledTimes(1);
    expect(dataModified.mock.calls[0][0].detail).toEqual({
      segmentationId: SEGMENTATION_ID,
      modifiedSlicesToUse: [4],
    });

    // AR-3: the modification travelling into Cornerstone3D must not come back out as a legacy
    // change. The classic viewports are not asked to redraw for an edit they made themselves.
    expect(mockUpdateImage).not.toHaveBeenCalled();
  });

  it('ignores an element showing a different series', async () => {
    await register();

    const other = makeTarget('other-element');
    mockEnabledElements.push({ element: other });
    mockStackToolState.set(other, { data: [{ imageIds: ['x0'], currentImageIdIndex: 0 }] });

    const dataModified = jest.fn();
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', dataModified);

    other.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });
    expect(dataModified).not.toHaveBeenCalled();
  });

  it('copies the changed slices across when the labelmap is not shared (FR-7)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCanonicalOrder = ['s2', 's0', 's1', 's3', 's4'];

    const { volume } = await register();

    const pixelData = new Uint16Array(labelmap3D.buffer, 1 * SLICE_LENGTH * 2, SLICE_LENGTH);
    pixelData[3] = 6;
    labelmap3D.labelmaps2D[1] = { pixelData, segmentsOnLabelmap: [0, 6] };

    mockStackToolState.get(element).data[0].currentImageIdIndex = 1;
    element.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });

    // Stack slice 1 is volume slice 2 in this ordering.
    expect(mockImageCache.get(volume.imageIds[2]).voxelManager.getScalarData()[3]).toBe(6);
  });
});


// --- FR-3: Cornerstone3D -> legacy --------------------------------------------------------------

describe('Cornerstone3D edits reaching the legacy module', () => {
  it('recomputes segmentsOnLabelmap for the modified slices and redraws each element', async () => {
    const { volume } = await register();

    // A segment cleared in the MPR panel writes through the shared view.
    mockImageCache.get(volume.imageIds[3]).voxelManager.getScalarData()[0] = 5;
    mockImageCache.get(volume.imageIds[4]).voxelManager.getScalarData()[0] = 5;

    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID,
      modifiedSlicesToUse: [3, 4],
    });

    expect(labelmap3D.labelmaps2D[3].segmentsOnLabelmap).toEqual([5, 0]);
    expect(labelmap3D.labelmaps2D[4].segmentsOnLabelmap).toEqual([5, 0]);


    // Untouched slices keep the entry they had -- the sparse array is not filled in wholesale.
    expect(labelmap3D.labelmaps2D[0]).toBeUndefined();
    expect(labelmap3D.labelmaps2D[2].segmentsOnLabelmap).toEqual([1, 0]);

    expect(mockUpdateImage).toHaveBeenCalledTimes(1);
    expect(mockUpdateImage).toHaveBeenCalledWith(element);
  });

  it('does not echo the change back into Cornerstone3D', async () => {
    await register();

    const dataModified = jest.fn();
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', dataModified);

    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [3],
    });

    // Only the event this case dispatched; the bridge raised none of its own. And a later legacy
    // event must not report slice 3 as a legacy edit either.
    expect(dataModified).toHaveBeenCalledTimes(1);

    dataModified.mockClear();
    mockStackToolState.get(element).data[0].currentImageIdIndex = 0;
    element.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });

    expect(dataModified.mock.calls[0][0].detail.modifiedSlicesToUse).toEqual([0]);
  });

  it('sweeps every slice only when no slice list is given at all', async () => {
    const { volume } = await register();
    mockImageCache.get(volume.imageIds[0]).voxelManager.getScalarData()[0] = 5;

    // An empty list is a redraw, not an edit: nothing is written back.
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [],
    });
    expect(labelmap3D.labelmaps2D[0]).toBeUndefined();
    expect(mockUpdateImage).not.toHaveBeenCalled();

    // No list at all is the AR-4 "slices unknown" fallback.
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID,
    });
    expect(labelmap3D.labelmaps2D[0].segmentsOnLabelmap).toEqual([5, 0]);
    expect(mockUpdateImage).toHaveBeenCalledTimes(1);
  });

  it('copies voxels back when the labelmap is not shared (FR-7)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCanonicalOrder = ['s2', 's0', 's1', 's3', 's4'];

    const { volume } = await register();

    // Volume slice 1 is stack slice 0 in this ordering.
    mockImageCache.get(volume.imageIds[1]).voxelManager.getScalarData()[2] = 8;

    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });

    expect(new Uint16Array(labelmap3D.buffer)[0 * SLICE_LENGTH + 2]).toBe(8);
  });
});


// --- FR-4: metadata ------------------------------------------------------------------------------

describe('segment metadata', () => {
  beforeEach(() => {
    // The segment identity comes from the SEG's own metadata; `createCanonicalSegmentation`
    // installs it on the Cornerstone3D segmentation at import (no pre-seeded state entry -- the
    // import IS what creates the entry now).
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[2] = { SegmentNumber: 2, SegmentLabel: 'Spleen' };
  });

  it('mirrors legacy active segment and hidden segments into Cornerstone3D', async () => {
    mockC3dRepresentations.set('viewport-0', [{ segmentationId: SEGMENTATION_ID }]);
    register();

    // A classic consumer has since changed the compatibility view in place.
    labelmap3D.activeSegmentIndex = 2;
    labelmap3D.segmentsHidden = [false, false, true];
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    expect(mockSetActiveSegmentIndex).toHaveBeenCalledWith(SEGMENTATION_ID, 2);
    expect(mockSetSegmentIndexVisibility).toHaveBeenCalledWith(
      'viewport-0', { segmentationId: SEGMENTATION_ID, type: 'Labelmap' }, 2, false);
  });

  it('leaves the active segment alone when the legacy default names no real segment', async () => {
    // A SEG whose segments start at 3 leaves the legacy default (1) pointing at nothing.
    register();
    mockC3dSegmentationState.set(SEGMENTATION_ID, {
      segmentationId: SEGMENTATION_ID,
      segments: { 3: { segmentIndex: 3, label: 'Lesion', active: true } },
    });

    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    expect(mockSetActiveSegmentIndex).not.toHaveBeenCalled();
  });

  it('writes a renamed segment and the active index back into the legacy labelmap', async () => {
    await register();
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    const segmentation = mockC3dSegmentationState.get(SEGMENTATION_ID);
    segmentation.segments[2].label = 'Spleen (edited)';
    segmentation.segments[1].active = false;
    segmentation.segments[2].active = true;

    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(labelmap3D.metadata.data[2].SegmentLabel).toBe('Spleen (edited)');
    expect(labelmap3D.activeSegmentIndex).toBe(2);
  });

  it('drops the legacy metadata of a segment Cornerstone3D removed', async () => {
    await register();
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    delete mockC3dSegmentationState.get(SEGMENTATION_ID).segments[2];
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(labelmap3D.metadata.data[2]).toBeUndefined();
    expect(labelmap3D.metadata.data[1]).toBeDefined();
  });

  it('keeps a segment the SEG declares but never painted', async () => {
    // The Cornerstone3D `segments` config is built from the indices found in the voxels, so a
    // declared-but-empty segment is legitimately absent from it and must survive.
    segMetadata.data[7] = { SegmentNumber: 7, SegmentLabel: 'Unpainted' };

    register();
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(labelmap3D.metadata.data[7]).toBeDefined();
  });

  it('mirrors segment visibility back into segmentsHidden', async () => {
    mockC3dRepresentations.set('viewport-0', [{
      segmentationId: SEGMENTATION_ID,
      segments: { 1: { visible: true }, 2: { visible: false } },
    }]);

    await register();
    mockC3dEventTarget.dispatch('SEGMENTATION_REPRESENTATION_MODIFIED', {
      segmentationId: SEGMENTATION_ID, viewportId: 'viewport-0', type: 'Labelmap',
    });

    expect(labelmap3D.segmentsHidden[1]).toBe(false);
    expect(labelmap3D.segmentsHidden[2]).toBe(true);
  });

  it('mirrors a colour change onto the legacy colour LUT', async () => {
    const subscribers = {};
    const segmentationService = {
      EVENTS: { SEGMENT_COLOR_MODIFIED: 'event::segment_color_modified' },
      subscribe: (event, handler) => {
        subscribers[event] = handler;
        return { unsubscribe: jest.fn() };
      },
    };

    await register();
    require('./labelmapBridge.js')
      .attachSegmentationService(SEGMENTATION_ID, segmentationService);

    subscribers['event::segment_color_modified']({
      segmentationId: SEGMENTATION_ID, segmentIndex: 1, color: [1, 2, 3, 255],
    });

    expect(mockSegmentationModuleState.colorLutTables[0][1]).toEqual([1, 2, 3, 255]);
    expect(mockUpdateImage).toHaveBeenCalledWith(element);
  });
});


// --- lifecycle ------------------------------------------------------------------------------------

describe('lifecycle', () => {
  it('drops the registration when its segmentation is removed', async () => {
    await register();
    mockC3dEventTarget.dispatch('SEGMENTATION_REMOVED', { segmentationId: SEGMENTATION_ID });

    expect(getLabelmapRegistration(SEGMENTATION_ID)).toBeUndefined();
  });

  it('keeps listeners while the segmentation exists, and unbinds them when it is destroyed', async () => {
    register();
    expect(element.listenerCount(MOCK_LABELMAP_MODIFIED)).toBe(1);
    expect(mockC3dEventTarget.listenerCount('SEGMENTATION_DATA_MODIFIED')).toBe(1);

    // Detach retires the display, but the legacy view is still live and its edits must still sync
    // into the record -- so the listeners stay.
    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(element.listenerCount(MOCK_LABELMAP_MODIFIED)).toBe(1);

    removeCanonicalSegmentation(SEGMENTATION_ID);
    expect(element.listenerCount(MOCK_LABELMAP_MODIFIED)).toBe(0);
    expect(mockC3dEventTarget.listenerCount('SEGMENTATION_DATA_MODIFIED')).toBe(0);
  });

  it('binds a viewport enabled after registration', async () => {
    await register();

    const later = makeTarget('later-element');
    mockStackToolState.set(later, { data: [{ imageIds: stackImageIds, currentImageIdIndex: 0 }] });
    mockLegacyEvents.dispatch('cornerstoneelementenabled', { element: later });

    expect(later.listenerCount(MOCK_LABELMAP_MODIFIED)).toBe(1);
  });
});


// --- FR-5 / §5.4: SEG export --------------------------------------------------------------------

describe('SEG export through the dcmjs adapter', () => {
  // What `fillSegmentation` reads from a labelmap, and nothing else, is what ends up in the SEG:
  // `labelmap3D.metadata` (indexed by segment number), and for every slice
  // `labelmaps2D[i].segmentsOnLabelmap` (which frames a segment appears on) and
  // `labelmaps2D[i].pixelData` (the voxels). So a run of the real adapter over the labelmap is the
  // export contract, whichever way the Cornerstone3D volume was attached to it.

  function runExport(labelmap) {
    // Drive the real adapter and record what it hands to the derived dataset. The recording sink
    // stops it at `bitPackPixelData`, which is the first call that needs a real DICOM dataset;
    // every `addSegmentFromLabelmap` has been made by then.
    const segments = [];
    let numberOfFrames;

    const sink = {
      dataset: {},
      setNumberOfFrames: count => { numberOfFrames = count; },
      addSegmentFromLabelmap: (metadata, labelmaps, segmentIndex, frameNumbers) => {
        segments.push({
          segmentIndex,
          frameNumbers: [...frameNumbers],
          label: metadata && metadata.SegmentLabel,
          voxels: labelmaps.map(frame => Array.from(frame)),
        });
      },
      bitPackPixelData: () => { throw new Error('__STOP_BEFORE_DATASET__'); },
    };

    try {
      fillSegmentation(sink, labelmap, { rleEncode: false });
    } catch (error) {
      if (error.message !== '__STOP_BEFORE_DATASET__') {
        throw error;
      }
    }

    return { numberOfFrames, segments };
  }

  function registerExportable() {
    // The adapter iterates `labelmap3D.metadata` as an ARRAY indexed by segment number, while the
    // dcmjs `generateToolState` this viewer parses SEGs with returns `{ seriesInstanceUid, data }`
    // and the bridge carries that shape through to the legacy view. These cases therefore hand the
    // importer array-shaped metadata so the comparison is real rather than vacuously empty; the
    // mismatch itself is pinned by the last case in this block.
    segMetadata = [undefined, { SegmentNumber: 1, SegmentLabel: 'Liver' }];
    return register();
  }

  it('exports the canonical segmentation through the legacy view', async () => {
    registerExportable();
    const exported = runExport(labelmap3D);

    expect(exported.segments).toHaveLength(1);
    expect(exported.segments[0].frameNumbers).toEqual([3]);
    expect(exported.segments[0].voxels[0][0]).toBe(1);
  });

  it('exports the same bytes whether the labelmap is shared or copied', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Shared: an edit made through the Cornerstone3D voxels reaches the export.
    const { volume } = registerExportable();
    mockImageCache.get(volume.imageIds[1]).voxelManager.getScalarData()[2] = 1;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });
    const shared = runExport(labelmap3D);

    // Copied: the same edit, with the legacy view forced onto the copy path.
    removeCanonicalSegmentation(SEGMENTATION_ID);
    mockVolumeCache.clear();
    mockImageCache.clear();
    makeReferenceVolume([...stackImageIds]);
    parsedLabelmap = makeParsedLabelmap();

    const { volume: copied } = registerExportable();
    mockImageCache.get(copied.imageIds[1]).voxelManager.getScalarData()[2] = 1;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });
    const copiedExport = runExport(labelmap3D);

    expect(copiedExport).toEqual(shared);

    // Frame numbers are 1-based: the edit landed on stack slice 1, the fixture's own content is on
    // stack slice 2.
    expect(shared.segments[0].frameNumbers).toEqual([2, 3]);
  });

  it('exports an edit made with the classic brush', async () => {
    registerExportable();

    const pixelData = new Uint16Array(labelmap3D.buffer, 4 * SLICE_LENGTH * 2, SLICE_LENGTH);
    pixelData[0] = 1;
    labelmap3D.labelmaps2D[4] = { pixelData, segmentsOnLabelmap: [0, 1] };

    mockStackToolState.get(element).data[0].currentImageIdIndex = 4;
    element.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });

    const exported = runExport(labelmap3D);
    expect(exported.segments[0].frameNumbers).toEqual([3, 5]);
    expect(exported.segments[0].voxels[1][0]).toBe(1);
  });

  it('records that the adapter cannot read the metadata shape this viewer stores', async () => {
    // Not a property of this branch: `dcmjs@0.42.0` `fillSegmentation` iterates
    // `labelmap3D.metadata` as an array indexed by segment number, while
    // `adapters.Cornerstone.Segmentation.generateToolState` -- which `loadSegmentation.js` stores
    // verbatim as `labelmap3D.metadata` -- returns `{ seriesInstanceUid, data: [...] }`. So
    // `metadata.length` is undefined, so the per-segment frame lists are never allocated and the
    // adapter throws as soon as a slice reports a segment. Pinned here so that the day a SEG export
    // path is added, this is not rediscovered from a stack trace.
    register();

    expect(labelmap3D.metadata.data).toBeDefined();
    expect(() => runExport(labelmap3D)).toThrow(TypeError);
  });
});


// --- review follow-ups --------------------------------------------------------------------------
//
// Two cases from the first review round are gone with the ownership inversion rather than fixed:
//
//   * the concurrent first-registration race -- the canonical segmentation is created once by the
//     importer and installing a view is synchronous, so two views cannot both create one;
//   * a legacy buffer replaced under an id already registered -- the bridge is the only thing that
//     builds a legacy `labelmap3D`, and `setters.labelmap3DByFirstImageId` now has no caller.

describe('legacy panel edits reaching Cornerstone3D', () => {
  // `SegmentationPanel` writes `activeSegmentIndex` and `segmentsHidden` in place and raises a
  // document event; cornerstone-tools raises nothing of its own for either.

  beforeEach(() => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[2] = { SegmentNumber: 2, SegmentLabel: 'Spleen' };
    mockC3dRepresentations.set('viewport-0', [{ segmentationId: SEGMENTATION_ID }]);
  });

  it('mirrors a panel change made after registration', async () => {
    await register();
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);
    jest.clearAllMocks();

    // What the panel does: mutate the legacy module, then announce it.
    labelmap3D.activeSegmentIndex = 2;
    labelmap3D.segmentsHidden = [false, true, false];
    mockDocument.dispatchEvent(new MockCustomEvent(METADATA_MODIFIED_EVENT));

    expect(mockSetActiveSegmentIndex).toHaveBeenCalledWith(SEGMENTATION_ID, 2);
    expect(mockSetSegmentIndexVisibility).toHaveBeenCalledWith(
      'viewport-0', { segmentationId: SEGMENTATION_ID, type: 'Labelmap' }, 1, false);
  });

  it('stops listening for panel metadata once the segmentation is destroyed', async () => {
    register();
    expect(mockDocument.listenerCount(METADATA_MODIFIED_EVENT)).toBe(1);

    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(mockDocument.listenerCount(METADATA_MODIFIED_EVENT)).toBe(1);

    removeCanonicalSegmentation(SEGMENTATION_ID);
    expect(mockDocument.listenerCount(METADATA_MODIFIED_EVENT)).toBe(0);
  });
});


describe('waking the legacy panel', () => {
  it('raises the panel refresh event after a Cornerstone3D voxel write-back', async () => {
    const panel = jest.fn();
    mockDocument.addEventListener(LABELMAP_STATE_EVENT, panel);

    const { volume } = await register();
    mockImageCache.get(volume.imageIds[3]).voxelManager.getScalarData()[0] = 5;

    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [3],
    });

    expect(panel).toHaveBeenCalledTimes(1);
    expect(panel.mock.calls[0][0].detail.segmentationId).toBe(SEGMENTATION_ID);
  });

  it('raises it after a metadata write-back, and does not echo it back as a legacy edit', async () => {
    const panel = jest.fn();
    const dataModified = jest.fn();
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };

    register();

    // Renamed on the Cornerstone3D side after the view exists -- the canonical record is where a
    // rename happens now, and the legacy view has to follow it.
    mockC3dSegmentationState.get(SEGMENTATION_ID).segments[1].label = 'Renamed';
    mockDocument.addEventListener(LABELMAP_STATE_EVENT, panel);
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', dataModified);
    jest.clearAllMocks();

    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(labelmap3D.metadata.data[1].SegmentLabel).toBe('Renamed');
    expect(panel).toHaveBeenCalledTimes(1);

    // The panel refresh must not travel back into Cornerstone3D as a change.
    expect(dataModified).not.toHaveBeenCalled();
    expect(mockSetActiveSegmentIndex).not.toHaveBeenCalled();
  });

  it('does not raise it for a redraw that changed nothing', async () => {
    const panel = jest.fn();
    await register();
    mockDocument.addEventListener(LABELMAP_STATE_EVENT, panel);

    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [],
    });

    expect(panel).not.toHaveBeenCalled();
  });
});


describe('a segment added on the Cornerstone3D side', () => {
  it('gains legacy metadata so the panel can list it', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };

    register();
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    // A new segment appears in the Cornerstone3D segmentation.
    mockC3dSegmentationState.get(SEGMENTATION_ID).segments[4] = {
      segmentIndex: 4, label: 'Lesion', active: false,
    };
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(labelmap3D.metadata.data[4]).toEqual({ SegmentNumber: 4, SegmentLabel: 'Lesion' });
    expect(labelmap3D.segmentsHidden[4]).toBe(false);
  });

  it('takes label, colour and visibility from the service event when there is one', async () => {
    const subscribers = {};
    const segmentationService = {
      EVENTS: {
        SEGMENT_COLOR_MODIFIED: 'event::segment_color_modified',
        SEGMENT_ADDED: 'event::segment_added',
      },
      subscribe: (event, handler) => {
        subscribers[event] = handler;
        return { unsubscribe: jest.fn() };
      },
    };

    await register();
    require('./labelmapBridge.js')
      .attachSegmentationService(SEGMENTATION_ID, segmentationService);

    subscribers['event::segment_added']({
      segmentationId: SEGMENTATION_ID,
      segmentIndex: 3,
      config: { label: 'Tumour', color: [9, 8, 7, 255], visibility: false },
    });

    expect(labelmap3D.metadata.data[3]).toEqual({ SegmentNumber: 3, SegmentLabel: 'Tumour' });
    expect(labelmap3D.segmentsHidden[3]).toBe(true);
    expect(mockSegmentationModuleState.colorLutTables[0][3]).toEqual([9, 8, 7, 255]);
  });
});


describe('the fallback warning', () => {
  it('is raised once per series, across labelmap indices and re-registration', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const isFallback = ([message]) => /legacy compatibility labelmap/.test(message);

    // A series of its own. `_fallbackLoggedSeries` is deliberately never cleared -- one line per
    // series per session is the point -- so this case must not share a series key with the others.
    const SERIES = 'sf0';
    const seriesStack = ['s0', 's1', 's2', 's3', 's4'];

    // Canonical order differs from the classic stack order, so every legacy view falls back.
    mockCanonicalOrder = ['s2', 's0', 's1', 's3', 's4'];

    const registerAt = (labelmapIndex) => {
      const segmentationId = `${SERIES}_${labelmapIndex}`;
      registeredIds.push(segmentationId);

      // `createCanonicalSegmentation` installs the legacy view itself now, and logs the order
      // divergence from there.
      return createCanonicalSegmentation({
        segmentationId,
        imageIds: seriesStack,
        labelmapBuffer: makeParsedLabelmap(),
        segMetadata: makeSegMetadata(),
        firstImageId: SERIES,
        labelmapIndex,
        colorLUTIndex: 0,
      });
    };

    // Two labelmaps on the one series ...
    registerAt(0);
    registerAt(1);

    // ... and the first closed and re-opened.
    removeCanonicalSegmentation(`${SERIES}_0`);
    registerAt(0);

    expect(warn.mock.calls.filter(isFallback)).toHaveLength(1);
    warn.mockRestore();
  });
});


// --- ownership-inversion review follow-ups --------------------------------------------------------

describe('the canonical record is reachable through the service alone', () => {
  it('carries every FR-5 input, and survives the legacy view being removed', async () => {
    segMetadata.data[1] = {
      SegmentNumber: 1,
      SegmentLabel: 'Liver',
      SegmentedPropertyCategoryCodeSequence: { CodeValue: 'T-62000' },
    };
    register();

    // A serializer reads through the service at ANY time: the logical segmentation stays in
    // Cornerstone3D state between sessions, stack-backed, with every FR-5 input on it.
    detachSegmentationDisplay(SEGMENTATION_ID, { force: true });
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockC3dSegmentationState.get(SEGMENTATION_ID)
      .representationData.Labelmap.imageIds.length).toBe(SLICES);

    expect(getCanonicalSegmentation(SEGMENTATION_ID)).toBeDefined();

    attachSegmentationDisplay(SEGMENTATION_ID);
    const rebuilt = getCanonicalSegmentation(SEGMENTATION_ID);
    const segmentation = mockC3dSegmentationState.get(SEGMENTATION_ID);
    const labelmapData = segmentation.representationData.Labelmap;
    const volume = rebuilt.volume;

    // identity and editable representation data: the representation names this session's display
    // volume, which is how Cornerstone3D's own internals resolve it.
    expect(labelmapData.volumeId).toMatch(new RegExp(`^${SEGMENTATION_ID}::display-\\d+$`));
    expect(volume).toBeDefined();

    // frame ordering and source-image references
    expect(labelmapData.referencedImageIds).toEqual(stackImageIds);

    // reference geometry
    expect(volume.dimensions).toEqual([COLUMNS, ROWS, SLICES]);

    // segment identity and per-segment coded metadata
    expect(segmentation.segments[1].label).toBe('Liver');
    expect(segmentation.segments[1].cachedStats.dicom.SegmentedPropertyCategoryCodeSequence)
      .toEqual({ CodeValue: 'T-62000' });

    // provenance
    expect(segmentation.cachedStats.sonadorDicomSegMetadata.seriesInstanceUid).toBe('1.2.3');

    // voxels, including an edit
    const voxels = mockImageCache.get(volume.imageIds[2]).voxelManager.getScalarData();
    expect(voxels[0]).toBe(1);
  });

  it('marks canonical segmentations so other subsystems can tell them apart', async () => {
    register();
    expect(require('./labelmapBridge.js').isCanonicalSegmentation(SEGMENTATION_ID)).toBe(true);

    mockC3dSegmentationState.set('vol3d:derived', { segmentationId: 'vol3d:derived', segments: {} });
    expect(require('./labelmapBridge.js').isCanonicalSegmentation('vol3d:derived')).toBe(false);
  });
});


describe('a view arriving after the segmentation already exists', () => {
  it('still has a canonical record to attach to, with the volume already cached', async () => {
    // The importer runs before any viewport mounts. It creates the record and the legacy view,
    // and deliberately NO display state and NO hold -- an importer-held hold is what previously
    // pinned the display forever, so no teardown ever ran.
    importSegmentation();

    // The LOGICAL segmentation exists from import -- service-visible, stack-backed -- while no
    // display volume exists yet.
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockC3dSegmentationState.get(SEGMENTATION_ID)
      .representationData.Labelmap.volumeId).toBeUndefined();
    expect([...mockVolumeCache.keys()].filter(id => id.includes('::display'))).toEqual([]);
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();

    const record = getCanonicalSegmentation(SEGMENTATION_ID);
    expect(record).toBeDefined();
    expect(record.canonicalImageIds).toEqual(stackImageIds);
    expect(record.volume).toBeNull();

    // Attaching is what a view does from there, and it materialises a generation of its own.
    const volume = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(volume.volumeId).toBe(`${SEGMENTATION_ID}::display-1`);
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
  });
});


describe('the panel refresh signal is not the SEG-loaded event', () => {
  // Regression for a crash seen in the segmentation editor: the bridge originally re-raised
  // `extensiondicomsegmentationsegloaded` to wake the panel. That event means "a SEG finished
  // loading" and carries a load payload; `dicom-segmentation`'s `index.js` subscribes to it and
  // dereferences `detail.segDisplaySet`, so a refresh with no such payload threw
  // `can't access property "StudyInstanceUID", segDisplaySet is undefined` during editor load.

  it('raises its own event and never the load event', async () => {
    const onLabelmapState = jest.fn();
    const onSegLoaded = jest.fn(({ detail }) => {
      // Exactly what the real load subscriber does.
      return detail.segDisplaySet.StudyInstanceUID;
    });

    const { volume } = register();
    mockDocument.addEventListener(LABELMAP_STATE_EVENT, onLabelmapState);
    mockDocument.addEventListener(SEG_LOADED_EVENT, onSegLoaded);

    mockImageCache.get(volume.imageIds[3]).voxelManager.getScalarData()[0] = 5;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [3],
    });
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    expect(onLabelmapState).toHaveBeenCalled();
    expect(onSegLoaded).not.toHaveBeenCalled();
  });
});


describe('the canonical store is what the labelmap renderer can display', () => {
  // Regression for a segmentation that renders as a solid yellow overlay, or not at all.
  //
  // `labelmapDisplay` maps the RAW scalar to a colour (`cfun.addRGBPoint(segmentIndex, ...)`) and
  // `vtkStreamingOpenGLTexture` forces scale 1 / offset 0, so the texture must deliver the literal
  // segment index. Only an 8-bit texture does: a Uint16 volume becomes R16_SNORM where
  // `EXT_texture_norm16` exists (segment 1 arrives as ~0.00003, so nothing is drawn) or R32F where
  // it does not.

  it('is 8-bit whatever the GPU reports', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (const norm16 of [true, false, undefined]) {
      mockGpuCapabilities = { norm16 };
      const { record, volume } = register();

      expect(record.scalarData).toBeInstanceOf(Uint8Array);
      expect(mockImageCache.get(volume.imageIds[0]).voxelManager.getScalarData())
        .toBeInstanceOf(Uint8Array);

      removeCanonicalSegmentation(SEGMENTATION_ID);
      registeredIds.length = 0;
      mockVolumeCache.clear();
      mockImageCache.clear();
      makeReferenceVolume([...stackImageIds]);
      parsedLabelmap = makeParsedLabelmap();
      segMetadata = makeSegMetadata();
      mockSegmentationModuleState.series = {};
    }
  });

  it('keeps the legacy view as a copy, in step in both directions', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { record, shared, volume } = register();

    // The legacy module can only view 16-bit memory, so it never shares an 8-bit canonical store.
    expect(shared).toBe(false);
    expect(labelmap3D.buffer.byteLength).toBe(SLICE_LENGTH * SLICES * 2);
    expect(Object.is(labelmap3D.buffer, record.scalarData.buffer)).toBe(false);

    // Seeded from the canonical store: the SEG's segment 1 is on stack slice 2.
    expect(new Uint16Array(labelmap3D.buffer)[2 * SLICE_LENGTH]).toBe(1);

    // A classic brush stroke reaches the canonical voxels ...
    const pixelData = new Uint16Array(labelmap3D.buffer, 4 * SLICE_LENGTH * 2, SLICE_LENGTH);
    pixelData[0] = 3;
    labelmap3D.labelmaps2D[4] = { pixelData, segmentsOnLabelmap: [3, 0] };
    mockStackToolState.get(element).data[0].currentImageIdIndex = 4;
    element.dispatch(MOCK_LABELMAP_MODIFIED, { labelmapIndex: 0 });
    expect(mockImageCache.get(volume.imageIds[4]).voxelManager.getScalarData()[0]).toBe(3);

    // ... and a Cornerstone3D edit reaches the legacy view.
    mockImageCache.get(volume.imageIds[1]).voxelManager.getScalarData()[2] = 7;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });
    expect(new Uint16Array(labelmap3D.buffer)[1 * SLICE_LENGTH + 2]).toBe(7);
  });
});


describe('the volume does not outlive the WebGL context that uploaded it', () => {
  // Regression for a labelmap that renders correctly on first load and comes back as a solid
  // overlay on the next. An `ImageVolume` owns one `vtkStreamingOpenGLTexture`, and
  // `vtkOpenGLTexture.render()` reassigns its render window WITHOUT releasing GL resources, so a
  // volume that survives its context carries a dead texture handle into the next one:
  // `bindTexture: tex is from a different (or lost) WebGL context`.

  it('leaves the durable stack images cached and pinned; only the volume goes', async () => {
    // The volume is built OVER the durable stack images, so retiring it must not take the CPU
    // voxel store with it -- and `createAndCacheVolumeFromImagesSync` reuses the same ids, so no
    // duplicate-id collision is possible across generations.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { volume } = register();
    const sliceIds = [...volume.imageIds];

    sliceIds.forEach(id => expect(mockImageCache.has(id)).toBe(true));

    detachSegmentationDisplay(SEGMENTATION_ID);
    sliceIds.forEach(id => {
      expect(mockImageCache.has(id)).toBe(true);
      // Pinned against LRU eviction while idle -- the images ARE the segmentation's voxels.
      expect(mockImageCacheEntries.get(id).sharedCacheKey)
        .toBe(`sonadorseg-pin:${SEGMENTATION_ID}`);
    });

    // ... and re-opening the series works, twice over, each open a volume generation of its own
    // over the SAME durable images.
    for (let i = 0; i < 2; i++) {
      const reopened = attachSegmentationDisplay(SEGMENTATION_ID);
      expect(reopened.imageIds).toEqual(sliceIds);
      expect(mockImageCache.get(reopened.imageIds[2]).voxelManager.getScalarData()[0]).toBe(1);
      detachSegmentationDisplay(SEGMENTATION_ID);
    }
  });

  it('is dropped when the last view goes, and the next open starts clean', async () => {
    const { record, volume } = register();
    mockImageCache.get(volume.imageIds[1]).voxelManager.getScalarData()[1] = 4;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });

    detachSegmentationDisplay(SEGMENTATION_ID);

    // Everything GL-facing is gone -- volume, texture, representations -- so nothing bound to the
    // old context can survive into the next load; the logical segmentation itself stays.
    expect(mockVolumeCache.get(volume.volumeId)).toBeUndefined();
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);

    // ... and the next attach is a new generation carrying the edit.
    const rebuilt = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(rebuilt.volumeId).not.toBe(volume.volumeId);
    expect(mockImageCache.get(rebuilt.imageIds[1]).voxelManager.getScalarData()[1]).toBe(4);
    expect(record.scalarData[1 * SLICE_LENGTH + 1]).toBe(4);
  });

  it('is kept while another view still holds it', async () => {
    const { volume } = register();
    register();

    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(mockVolumeCache.get(volume.volumeId)).toBeDefined();

    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(mockVolumeCache.get(volume.volumeId)).toBeUndefined();
  });

  it('keeps the legacy view alive across detach, and a re-attach starts a new generation', async () => {
    const first = register();
    detachSegmentationDisplay(SEGMENTATION_ID);

    // The classic viewport may still be showing the series: the legacy view persists.
    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    expect(registration.labelmap3D.labelmaps2D[2].segmentsOnLabelmap).toEqual([1, 0]);
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0])
      .toBe(registration.labelmap3D);

    // ... and the next attach materialises generation 2, nothing recycled.
    const second = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(second.volumeId).toBe(`${SEGMENTATION_ID}::display-2`);
    expect(second).not.toBe(first.volume);
  });
});


describe('the second load of a series behaves exactly like the first', () => {
  // The failure this exists for: MPR and the segmentation editor render the segmentation correctly
  // on first open, and on the second open show a solid overlay. Everything Cornerstone3D holds is
  // bound to a WebGL context and a colour LUT index belonging to the layout that has just been torn
  // down, so the fix is that none of it survives -- every open rebuilds from the record.

  function openAndClose() {
    const opened = register();
    const state = {
      // Ids are compared with the generation stripped: the CONTENT must be identical between
      // opens, while the ids themselves must be fresh (asserted separately below).
      volumeId: opened.volume.volumeId,
      shared: opened.shared,
      voxels: Array.from(opened.record.scalarData),
      display: Array.from(
        mockImageCache.get(opened.volume.imageIds[0]).voxelManager.getScalarData().buffer
          ? new Uint8Array(
              mockImageCache.get(opened.volume.imageIds[0]).voxelManager.getScalarData().buffer)
          : []),
      segments: Object.keys(mockC3dSegmentationState.get(SEGMENTATION_ID).segments),
      sliceIds: opened.volume.imageIds.map(id => id.replace(/::display-\d+/, '::display-N')),
      legacy: Array.from(new Uint16Array(labelmap3D.buffer)),
    };

    detachSegmentationDisplay(SEGMENTATION_ID);
    return state;
  }

  it('rebuilds identically, three opens running', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };

    const first = openAndClose();

    // Nothing GL-facing is left between opens; the durable state is exactly the logical
    // segmentation and its pinned stack images.
    expect(mockVolumeCache.size).toBe(1);            // the reference image volume only
    expect(mockImageCache.size).toBe(SLICES);        // the durable stack images
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);

    const second = openAndClose();
    const third = openAndClose();

    // Fresh ids every open -- nothing recycled ...
    expect(first.volumeId).toBe(`${SEGMENTATION_ID}::display-1`);
    expect(second.volumeId).toBe(`${SEGMENTATION_ID}::display-2`);
    expect(third.volumeId).toBe(`${SEGMENTATION_ID}::display-3`);

    // ... with byte-identical content.
    const content = ({ volumeId, ...rest }) => rest;
    expect(content(second)).toEqual(content(first));
    expect(content(third)).toEqual(content(first));
  });

  it('carries an edit made on the first open into the second', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { volume } = register();
    mockImageCache.get(volume.imageIds[3]).voxelManager.getScalarData()[0] = 6;
    // Every Cornerstone3D editing path announces its slices; that event is what carries the edit
    // into the legacy view (the canonical voxels took it directly -- the write went through the
    // stack image the display volume shares).
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [3],
    });
    detachSegmentationDisplay(SEGMENTATION_ID);

    const reopened = register();
    expect(reopened.record.scalarData[3 * SLICE_LENGTH]).toBe(6);

    // ... and into the legacy view the classic viewport reads.
    expect(new Uint16Array(labelmap3D.buffer)[3 * SLICE_LENGTH]).toBe(6);
  });
});


describe('the importer takes no display hold', () => {
  // THE regression behind three failed fixes. `loadSegmentation.js` used to take a bridge hold that
  // nothing released, so the view refcount could never reach zero, no teardown ever ran, and the
  // second open of a series inherited a volume, texture, representations and colour LUT bound to a
  // WebGL context that had been destroyed -- while the suite stayed green, because its helpers
  // attached and detached symmetrically without the importer's unbalanced hold. This test walks the
  // REAL production sequence: import, then one view attaching and detaching.

  it('one view attaching and detaching after import fully retires the display state', async () => {
    // The importer.
    importSegmentation();
    expect(getLabelmapRegistration(SEGMENTATION_ID).holders).toBe(0);

    // One view opens ...
    const volume = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(getLabelmapRegistration(SEGMENTATION_ID).holders).toBe(1);

    // ... and closes. Holders must reach zero and the display state must actually go.
    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(getLabelmapRegistration(SEGMENTATION_ID).holders).toBe(0);
    expect(getLabelmapRegistration(SEGMENTATION_ID).volume).toBeNull();
    expect(mockVolumeCache.get(volume.volumeId)).toBeUndefined();
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockC3dSegmentationState.get(SEGMENTATION_ID)
      .representationData.Labelmap.volumeId).toBeUndefined();
    expect(mockRemoveSegmentation).not.toHaveBeenCalled();
    // The volume's imageIds are the DURABLE stack -- they stay cached and pinned.
    volume.imageIds.forEach(id => expect(mockImageCache.has(id)).toBe(true));

    // The classic consumers keep their view; the canonical stack keeps the voxels.
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();
    expect(getCanonicalSegmentation(SEGMENTATION_ID).scalarData[2 * SLICE_LENGTH]).toBe(1);
  });
});


describe('the durable segmentation between viewing sessions', () => {
  // Review finding !87 note 37598: the logical segmentation must stay visible through
  // Cornerstone3D state / `SegmentationService` while no volumetric view is attached, with only
  // GL-bound display resources rotating per session. A larger fixture keeps this honest about the
  // shape at the programme's slice counts.

  const BIG_SERIES = 'big0';
  const BIG_ID = `${BIG_SERIES}_0`;
  const BIG_SLICES = 500;

  function importBig() {
    const imageIds = Array.from({ length: BIG_SLICES }, (_, i) => `big${i}`);
    const parsed = new Uint16Array(SLICE_LENGTH * BIG_SLICES);
    parsed[2 * SLICE_LENGTH] = 1;

    createCanonicalSegmentation({
      segmentationId: BIG_ID,
      imageIds,
      labelmapBuffer: parsed,
      segMetadata: makeSegMetadata(),
      firstImageId: BIG_SERIES,
      labelmapIndex: 0,
      colorLUTIndex: 0,
    });
    registeredIds.push(BIG_ID);
  }

  it('is service-visible and voxel-complete while idle, with no display state', async () => {
    importBig();

    // Idle after import: the segmentation is in Cornerstone3D state, stack-backed, no volume.
    const idle = getCanonicalSegmentation(BIG_ID);
    expect(idle.volume).toBeNull();
    expect(mockC3dSegmentationState.has(BIG_ID)).toBe(true);
    const labelmapData = mockC3dSegmentationState.get(BIG_ID).representationData.Labelmap;
    expect(labelmapData.volumeId).toBeUndefined();
    expect(labelmapData.imageIds).toHaveLength(BIG_SLICES);

    // The voxels are the cached stack images, pinned against eviction; a serializer reads them
    // with no view open.
    expect(getSegmentationVoxels(BIG_ID)[2 * SLICE_LENGTH]).toBe(1);
    labelmapData.imageIds.forEach(id => {
      expect(mockImageCacheEntries.get(id).sharedCacheKey).toBe(`sonadorseg-pin:${BIG_ID}`);
    });

    // Attach materialises the volume over the SAME array (no session copy).
    const volume = attachSegmentationDisplay(BIG_ID);
    const attached = getCanonicalSegmentation(BIG_ID);
    expect(Object.is(
      mockImageCache.get(volume.imageIds[0]).voxelManager.getScalarData().buffer,
      attached.scalarData.buffer)).toBe(true);

    // Edit, detach, reopen: the edit is durable -- it was written into the canonical stack.
    mockImageCache.get(volume.imageIds[7]).voxelManager.getScalarData()[3] = 5;
    detachSegmentationDisplay(BIG_ID);
    expect(getSegmentationVoxels(BIG_ID)[7 * SLICE_LENGTH + 3]).toBe(5);

    const reopened = attachSegmentationDisplay(BIG_ID);
    expect(mockImageCache.get(reopened.imageIds[7]).voxelManager.getScalarData()[3]).toBe(5);
    expect(mockImageCache.get(reopened.imageIds[2]).voxelManager.getScalarData()[0]).toBe(1);
  });

  it('raises no domain add/remove across close and reopen', async () => {
    importBig();
    expect(mockAddSegmentations).toHaveBeenCalledTimes(1);

    const removals = [];
    mockC3dEventTarget.addEventListener('SEGMENTATION_REMOVED', event => removals.push(event));

    attachSegmentationDisplay(BIG_ID);
    detachSegmentationDisplay(BIG_ID);
    attachSegmentationDisplay(BIG_ID);
    detachSegmentationDisplay(BIG_ID);

    // The segmentation was registered once, at import, and never removed by the display
    // lifecycle: `SegmentationService` consumers see no phantom add/remove churn.
    expect(mockAddSegmentations).toHaveBeenCalledTimes(1);
    expect(mockRemoveSegmentation).not.toHaveBeenCalled();
    expect(removals).toHaveLength(0);
  });

  it('an explicit removal takes the stack images and the pin with it', async () => {
    importBig();
    const stackIds = [
      ...mockC3dSegmentationState.get(BIG_ID).representationData.Labelmap.imageIds];

    removeCanonicalSegmentation(BIG_ID);

    expect(mockC3dSegmentationState.has(BIG_ID)).toBe(false);
    stackIds.forEach(id => {
      expect(mockImageCache.has(id)).toBe(false);
      expect(mockImageCacheEntries.has(id)).toBe(false);
    });
  });
});


describe('segment numbers above 255', () => {
  // Review finding !87 note 37600: `Uint16 -> Uint8` narrowing must never be silent. The importer
  // plans a reversible remap (`planSegmentValueRemap`); the bridge applies it to the voxels, the
  // segment config and the legacy metadata, and records it with the provenance.

  it('remaps declared high segment numbers reversibly', async () => {
    segMetadata.data = [];
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[300] = { SegmentNumber: 300, SegmentLabel: 'Lesion' };

    const parsed = new Uint16Array(SLICE_LENGTH * SLICES);
    parsed[2 * SLICE_LENGTH] = 300;
    parsedLabelmap = parsed;

    importSegmentation({ canonical: { segmentValueMap: { 300: 2 } } });

    // The voxels carry the canonical value ...
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(2);

    // ... the segment config is keyed by it, labelled from the original entry ...
    const segmentation = mockC3dSegmentationState.get(SEGMENTATION_ID);
    expect(segmentation.segments[2].label).toBe('Lesion');
    expect(segmentation.segments[300]).toBeUndefined();

    // ... the provenance records the reversible map and the original entry ...
    expect(segmentation.cachedStats.sonadorSegmentValueMap).toEqual({ 300: 2 });
    expect(segmentation.segments[2].cachedStats.dicom.SegmentNumber).toBe(300);

    // ... and the legacy view agrees with what the voxels hold -- INCLUDING the operational key.
    // `SegmentationPanel.getSegmentList` uses `metadata.data[i].SegmentNumber` as the live segment
    // identity (selection, visibility, `segmentsOnLabelmap` lookups), so a remapped entry must
    // carry the canonical value there; the DICOM number moves to OriginalSegmentNumber for
    // display.
    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    expect(registration.labelmap3D.metadata.data[2].SegmentLabel).toBe('Lesion');
    expect(registration.labelmap3D.metadata.data[2].SegmentNumber).toBe(2);
    expect(registration.labelmap3D.metadata.data[2].OriginalSegmentNumber).toBe(300);
    expect(registration.labelmap3D.metadata.data[300]).toBeUndefined();
    expect(new Uint16Array(registration.labelmap3D.buffer)[2 * SLICE_LENGTH]).toBe(2);

    // The un-remapped entry is untouched -- identical operational and DICOM identity.
    expect(registration.labelmap3D.metadata.data[1].SegmentNumber).toBe(1);
    expect(registration.labelmap3D.metadata.data[1].OriginalSegmentNumber).toBeUndefined();
  });

  it('keeps layer membership canonical when a remapped segment lands on its own layer', async () => {
    // The overlapping-layer case: layer filters and segment configs must agree on the CANONICAL
    // identity, or a remapped segment silently vanishes from its layer.
    segMetadata.data = [];
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[300] = { SegmentNumber: 300, SegmentLabel: 'Lesion' };

    const layer1 = `${FIRST_IMAGE_ID}_1`;
    createCanonicalSegmentation({
      segmentationId: layer1,
      imageIds: stackImageIds,
      labelmapBuffer: makeParsedLabelmap(),
      segMetadata,
      segmentValueMap: { 300: 2 },
      layerSegments: [2], // canonical, as loadSegmentation now passes them
      firstImageId: FIRST_IMAGE_ID,
      labelmapIndex: 1,
      colorLUTIndex: 0,
    });
    registeredIds.push(layer1);

    const segmentation = mockC3dSegmentationState.get(layer1);
    expect(Object.keys(segmentation.segments)).toEqual(['2']);
    expect(segmentation.segments[2].label).toBe('Lesion');
  });

  it('drops an undeclared high value to background with a warning, never mod-256', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const parsed = new Uint16Array(SLICE_LENGTH * SLICES);
    parsed[2 * SLICE_LENGTH] = 256; // mod-256 would silently make this background segment 0 ANYWAY
    parsed[2 * SLICE_LENGTH + 1] = 257; // ... and this one would alias segment 1
    parsedLabelmap = parsed;

    importSegmentation();

    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(0);
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH + 1]).toBe(0);
    expect(warn.mock.calls.some(([message]) => /above 255/.test(message))).toBe(true);
    warn.mockRestore();
  });
});


describe('multi-layer identity', () => {
  // Review finding !87 note 37558/37602: an overlapping SEG imports one layer per call, and each
  // layer's segmentation carries only its own membership.

  it('installs only the layer\'s own segments on each canonical segmentation', async () => {
    segMetadata.data = [];
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[2] = { SegmentNumber: 2, SegmentLabel: 'Spleen' };

    const layer0 = `${FIRST_IMAGE_ID}_0`;
    const layer1 = `${FIRST_IMAGE_ID}_1`;

    createCanonicalSegmentation({
      segmentationId: layer0,
      imageIds: stackImageIds,
      labelmapBuffer: makeParsedLabelmap(),
      segMetadata,
      layerSegments: [1],
      firstImageId: FIRST_IMAGE_ID,
      labelmapIndex: 0,
      colorLUTIndex: 0,
    });
    createCanonicalSegmentation({
      segmentationId: layer1,
      imageIds: stackImageIds,
      labelmapBuffer: makeParsedLabelmap(),
      segMetadata,
      layerSegments: [2],
      firstImageId: FIRST_IMAGE_ID,
      labelmapIndex: 1,
      colorLUTIndex: 0,
    });
    registeredIds.push(layer0, layer1);

    expect(Object.keys(mockC3dSegmentationState.get(layer0).segments)).toEqual(['1']);
    expect(Object.keys(mockC3dSegmentationState.get(layer1).segments)).toEqual(['2']);

    // Both layers are discoverable for the series, each under its own id.
    const forSeries = getCanonicalSegmentationsForSeries(FIRST_IMAGE_ID);
    expect(forSeries.map(record => record.segmentationId).sort()).toEqual([layer0, layer1]);
  });

  it('keeps layer identity under lazy legacy install, where no legacy state exists to consult', async () => {
    // The importer's next-index scan reads the canonical roster as well as legacy module state;
    // under `lazyLegacyLabelmap` the legacy side is empty, so the roster is the only thing
    // standing between successive layers and an index-0 collision.
    mockAppConfig = { lazyLegacyLabelmap: true };

    const layer0 = `${FIRST_IMAGE_ID}_0`;
    const layer1 = `${FIRST_IMAGE_ID}_1`;

    [0, 1].forEach(labelmapIndex => {
      createCanonicalSegmentation({
        segmentationId: `${FIRST_IMAGE_ID}_${labelmapIndex}`,
        imageIds: stackImageIds,
        labelmapBuffer: makeParsedLabelmap(),
        segMetadata: makeSegMetadata(),
        firstImageId: FIRST_IMAGE_ID,
        labelmapIndex,
        colorLUTIndex: 0,
      });
      registeredIds.push(`${FIRST_IMAGE_ID}_${labelmapIndex}`);
    });

    // No legacy state was installed, yet both layers exist independently, discoverable with
    // their labelmap indices -- what `_getNextLabelmapIndex` consults for the next import.
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID]).toBeUndefined();
    const forSeries = getCanonicalSegmentationsForSeries(FIRST_IMAGE_ID);
    expect(forSeries.map(record => record.segmentationId).sort()).toEqual([layer0, layer1]);
    expect(forSeries.map(record => record.labelmapIndex).sort()).toEqual([0, 1]);
  });
});


describe('a derived per-view display (the inspection modal)', () => {
  // The lightbox renders in its own rendering engine, so it cannot share the canonical display
  // volume (one GL texture per volume, one context per texture). It attaches a DERIVED display:
  // its own segmentation entry under `<segId>::inspection`, its own generation-numbered volume,
  // both over the same durable stack images -- the voxels are the canonical voxels.

  const DERIVED_ID = `${SEGMENTATION_ID}::inspection`;

  it('materialises its own segmentation and volume over the canonical stack', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    const { volume: canonicalVolume } = register();

    const derivedVolume = attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID, {
      referencedVolumeId: `${IMAGE_VOLUME_ID}::inspection`,
    });

    // Its own volume and segmentation entry ...
    expect(derivedVolume.volumeId).toBe(`${DERIVED_ID}::display-1`);
    expect(derivedVolume.volumeId).not.toBe(canonicalVolume.volumeId);
    const derived = mockC3dSegmentationState.get(DERIVED_ID);
    expect(derived).toBeDefined();
    expect(derived.representationData.Labelmap.volumeId).toBe(derivedVolume.volumeId);
    expect(derived.cachedStats.sonadorDerivedFromSegmentation).toBe(SEGMENTATION_ID);

    // ... the segment identity cloned from the canonical entry ...
    expect(derived.segments[1].label).toBe('Liver');

    // ... and the SAME durable images underneath: an edit through either volume is one write.
    expect(derivedVolume.imageIds).toEqual(canonicalVolume.imageIds);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('detaching the derived view leaves the canonical segmentation and display alone', async () => {
    const { volume: canonicalVolume } = register();
    const derivedVolume = attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    // Derived state fully gone ...
    expect(mockC3dSegmentationState.has(DERIVED_ID)).toBe(false);
    expect(mockVolumeCache.has(derivedVolume.volumeId)).toBe(false);

    // ... canonical display, segmentation and pinned stack untouched.
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockVolumeCache.has(canonicalVolume.volumeId)).toBe(true);
    canonicalVolume.imageIds.forEach(id => {
      expect(mockImageCache.has(id)).toBe(true);
      expect(mockImageCacheEntries.get(id).sharedCacheKey)
        .toBe(`sonadorseg-pin:${SEGMENTATION_ID}`);
    });

    // A re-open is a fresh generation of its own.
    const reopened = attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
    expect(reopened.volumeId).toBe(`${DERIVED_ID}::display-2`);
    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('is not canonical, so lease-release disposal may take it and never the real one', async () => {
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    // The flag other subsystems check before destroying (volumeLease release, the 3D reset).
    const derived = mockC3dSegmentationState.get(DERIVED_ID);
    expect(derived.cachedStats.sonadorCanonicalSegmentation).toBeUndefined();

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('goes with an explicit removal of the canonical segmentation', async () => {
    register();
    const derivedVolume = attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    removeCanonicalSegmentation(SEGMENTATION_ID);
    registeredIds = [];

    expect(mockC3dSegmentationState.has(DERIVED_ID)).toBe(false);
    expect(mockVolumeCache.has(derivedVolume.volumeId)).toBe(false);
  });

  it('carries its display-only flag IN the registration, so classification works at event time', async () => {
    // `SegmentationService` classifies on SEGMENTATION_ADDED, which the library fires DURING
    // addSegmentations -- a flag written afterwards would be too late.
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    const derivedCall = mockAddSegmentations.mock.calls
      .map(([segs]) => segs[0])
      .find(seg => seg.segmentationId === DERIVED_ID);
    expect(derivedCall.config.cachedStats.sonadorDerivedFromSegmentation).toBe(SEGMENTATION_ID);
    expect(mockC3dSegmentationState.get(DERIVED_ID)
      .cachedStats.sonadorDerivedFromSegmentation).toBe(SEGMENTATION_ID);
  });

  it('follows canonical segment changes while the derived view is open', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    const derivedModified = [];
    mockC3dEventTarget.addEventListener('SEGMENTATION_MODIFIED', event => {
      if (event.detail.segmentationId === DERIVED_ID) {
        derivedModified.push(event.detail);
      }
    });

    // A rename and a new segment land on the canonical segmentation while the lightbox is open.
    const canonical = mockC3dSegmentationState.get(SEGMENTATION_ID);
    canonical.segments[1].label = 'Liver (edited)';
    canonical.segments[4] = { segmentIndex: 4, label: 'Lesion', active: false };
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: SEGMENTATION_ID });

    const derived = mockC3dSegmentationState.get(DERIVED_ID);
    expect(derived.segments[1].label).toBe('Liver (edited)');
    expect(derived.segments[4].label).toBe('Lesion');

    // Through the supported state route: `updateSegmentations` commits the change and emits
    // SEGMENTATION_MODIFIED for the DERIVED id -- the render trigger for an open lightbox.
    expect(mockUpdateSegmentations).toHaveBeenCalledWith([
      { segmentationId: DERIVED_ID, payload: { segments: derived.segments } },
    ]);
    expect(derivedModified.length).toBeGreaterThan(0);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });
});


describe('derived display invalidation and visibility', () => {
  // Review finding !87 note 37661: sharing the CPU stack images is not enough -- each display
  // volume has its own vtkImageData and GL texture, reached through its own segmentation id, and
  // canonical per-segment visibility must follow into derived representations.

  const DERIVED_ID = `${SEGMENTATION_ID}::inspection`;

  function recordDataModified() {
    const events = [];
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', event =>
      events.push(event.detail));
    return events;
  }

  it('a legacy edit reaches the derived texture when the lightbox is the ONLY display', async () => {
    importSegmentation();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    const events = recordDataModified();
    pushLegacyLabelmapModified(SEGMENTATION_ID, [2]);

    // No canonical display exists, so no canonical event -- but the derived display's frames are
    // marked through ITS id.
    expect(events).toEqual([{ segmentationId: DERIVED_ID, modifiedSlicesToUse: [2] }]);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('a canonical edit reaches both textures when canonical and lightbox are open', async () => {
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    const events = recordDataModified();

    // A Cornerstone3D tool announces its slices on the canonical id. The bridge's listener runs
    // first (registered at import) and forwards synchronously, so the recorder sees the derived
    // forward before the canonical original -- both with the same slice set is what matters.
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [1],
    });

    expect(events.map(event => event.segmentationId).sort()).toEqual(
      [SEGMENTATION_ID, DERIVED_ID].sort());
    events.forEach(event => expect(event.modifiedSlicesToUse).toEqual([1]));

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('a legacy edit reaches BOTH displays through their own ids', async () => {
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);

    const events = recordDataModified();
    pushLegacyLabelmapModified(SEGMENTATION_ID, [2]);

    expect(events).toEqual([
      { segmentationId: SEGMENTATION_ID, modifiedSlicesToUse: [2] },
      { segmentationId: DERIVED_ID, modifiedSlicesToUse: [2] },
    ]);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('a segment hidden BEFORE the lightbox opens is hidden on its representation', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[2] = { SegmentNumber: 2, SegmentLabel: 'Spleen' };
    const { registration } = register();

    // Hidden on the canonical side before the lightbox exists.
    registration.labelmap3D.segmentsHidden = [false, false, true];

    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
    mockC3dRepresentations.set('lightbox-vp', [{ segmentationId: DERIVED_ID }]);

    // The view runs this mirror right after registering its representation.
    mirrorLegacyMetadataToCornerstone3d(SEGMENTATION_ID);

    expect(mockSetSegmentIndexVisibility).toHaveBeenCalledWith(
      'lightbox-vp', { segmentationId: DERIVED_ID, type: 'Labelmap' }, 2, false);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });

  it('a segment hidden WHILE the lightbox is open follows onto its representation', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    segMetadata.data[2] = { SegmentNumber: 2, SegmentLabel: 'Spleen' };
    register();
    attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
    mockC3dRepresentations.set('lightbox-vp', [{ segmentationId: DERIVED_ID }]);

    // The user hides segment 2 on a canonical viewport.
    mockC3dRepresentations.set('viewport-0', [{
      segmentationId: SEGMENTATION_ID,
      segments: { 2: { visible: false } },
    }]);
    mockC3dEventTarget.dispatch('SEGMENTATION_REPRESENTATION_MODIFIED', {
      segmentationId: SEGMENTATION_ID, viewportId: 'viewport-0', type: 'Labelmap',
    });

    expect(mockSetSegmentIndexVisibility).toHaveBeenCalledWith(
      'lightbox-vp', { segmentationId: DERIVED_ID, type: 'Labelmap' }, 2, false);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
  });
});


describe('failed attaches roll back their holder and state', () => {
  // Review finding !87 note 37663: a holder committed before a failed materialisation would make
  // the eventual last detach stop above zero and never retire the display.

  const DERIVED_ID = `${SEGMENTATION_ID}::inspection`;

  it('a failed canonical attach leaves no holder; retry and one detach retire fully', async () => {
    importSegmentation();

    mockVolumeCreateFailure = () => true;
    expect(() => attachSegmentationDisplay(SEGMENTATION_ID)).toThrow(/injected/);

    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    expect(registration.holders).toBe(0);
    expect(registration.volume).toBeNull();

    mockVolumeCreateFailure = null;
    const volume = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(registration.holders).toBe(1);

    detachSegmentationDisplay(SEGMENTATION_ID);
    expect(registration.holders).toBe(0);
    expect(registration.volume).toBeNull();
    expect(mockVolumeCache.has(volume.volumeId)).toBe(false);
  });

  it('a failed derived attach leaves no holder, entry state or segmentation; retry works', async () => {
    register();

    mockAddSegmentations.mockImplementationOnce(() => {
      throw new Error('injected derived registration failure');
    });
    expect(() => attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID))
      .toThrow('injected derived registration failure');

    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    const entry = registration.derivedDisplays.get(DERIVED_ID);
    expect(entry.holders).toBe(0);
    expect(entry.volume).toBeNull();
    expect(mockC3dSegmentationState.has(DERIVED_ID)).toBe(false);
    expect(mockVolumeCache.has(`${DERIVED_ID}::display-1`)).toBe(false);

    const volume = attachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
    expect(volume.volumeId).toBe(`${DERIVED_ID}::display-2`);
    expect(entry.holders).toBe(1);

    detachDerivedSegmentationDisplay(SEGMENTATION_ID, DERIVED_ID);
    expect(entry.holders).toBe(0);
    expect(mockC3dSegmentationState.has(DERIVED_ID)).toBe(false);
  });
});


describe('transactional stack creation and reconstruction', () => {
  // Review finding !87 note 37637: publication of the durable stack must be all-or-nothing, each
  // image protected the moment it is admitted, and the runtime wiring rebuildable from
  // Cornerstone3D state and the image cache alone.

  it('pins every image as it is admitted, surviving an adversarial cache', async () => {
    // `putImageSync` runs the LRU eviction pass, which never touches a stamped image but may take
    // any unstamped one -- modelled here as a cache that evicts EVERY unpinned stack image on
    // each admission. Only per-admission pinning survives it.
    // The real cache frees space BEFORE inserting, so the incoming image itself is never the
    // eviction victim -- only earlier, still-unstamped entries are.
    mockOnImageAdmitted = admittedImageId => {
      [...mockImageCacheEntries.entries()].forEach(([imageId, entry]) => {
        if (imageId !== admittedImageId
            && imageId.startsWith('sonadorseglabel:') && !entry.sharedCacheKey) {
          mockImageCache.delete(imageId);
          mockImageCacheEntries.delete(imageId);
        }
      });
    };

    importSegmentation();

    const labelmapData = mockC3dSegmentationState.get(SEGMENTATION_ID)
      .representationData.Labelmap;
    expect(labelmapData.imageIds).toHaveLength(SLICES);
    labelmapData.imageIds.forEach(id => {
      expect(mockImageCache.has(id)).toBe(true);
      expect(mockImageCacheEntries.get(id).sharedCacheKey)
        .toBe(`sonadorseg-pin:${SEGMENTATION_ID}`);
    });
  });

  it('refuses cleanly when the stack cannot fit the cache', async () => {
    mockIsCacheable = () => false;

    expect(() => importSegmentation()).toThrow(/does not fit the Cornerstone3D cache/);

    // Nothing was admitted or published.
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(false);
    expect([...mockImageCache.keys()].filter(id => id.startsWith('sonadorseglabel:')))
      .toEqual([]);
    registeredIds = [];
  });

  it('rolls a failed publication back so a retry starts clean', async () => {
    mockAddSegmentations.mockImplementationOnce(() => {
      throw new Error('injected addSegmentations failure');
    });

    expect(() => importSegmentation()).toThrow('injected addSegmentations failure');

    // The failed attempt left nothing: no state entry, no images, no pins, no registration.
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(false);
    expect([...mockImageCache.keys()].filter(id => id.startsWith('sonadorseglabel:')))
      .toEqual([]);
    expect(getLabelmapRegistration(SEGMENTATION_ID)).toBeUndefined();

    // ... and the retry succeeds from nothing.
    registeredIds = [];
    importSegmentation();
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(1);
  });

  it('rolls back admissions made before the helper itself threw, and the retry shares one array', async () => {
    // The journal is caller-owned and written per admission, so slices admitted before a failure
    // INSIDE the helper (here: the second image) are still removed -- a retry must not mix
    // slices backed by the failed attempt's array with slices backed by its own.
    let failed = false;
    mockImageCreateFailure = imageId => {
      if (!failed && imageId.endsWith(':1')) {
        failed = true;
        return true;
      }
      return false;
    };

    expect(() => importSegmentation()).toThrow(/injected createAndCacheLocalImage/);
    expect([...mockImageCache.keys()].filter(id => id.startsWith('sonadorseglabel:')))
      .toEqual([]);
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(false);

    registeredIds = [];
    importSegmentation();
    const voxels = getSegmentationVoxels(SEGMENTATION_ID);
    const labelmapData = mockC3dSegmentationState.get(SEGMENTATION_ID)
      .representationData.Labelmap;
    labelmapData.imageIds.forEach(id => {
      expect(Object.is(
        mockImageCache.get(id).voxelManager.getScalarData().buffer, voxels.buffer)).toBe(true);
    });
  });

  it('rolls back when metadata registration fails mid-stack', async () => {
    let failed = false;
    mockMetadataAddFailure = (imageId, type) => {
      if (!failed && type === 'generalSeriesModule' && imageId.endsWith(':2')) {
        failed = true;
        return true;
      }
      return false;
    };

    expect(() => importSegmentation()).toThrow(/injected genericMetadataProvider/);
    expect([...mockImageCache.keys()].filter(id => id.startsWith('sonadorseglabel:')))
      .toEqual([]);
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(false);

    registeredIds = [];
    importSegmentation();
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(1);
  });

  it('a failed reconstruction rebuild fails closed; the published stack stays complete and attachable', async () => {
    // A published segmentation whose stack has a FOREIGN layout (per-slice arrays): the
    // reconstruction fallback admits a generation-numbered replacement and commits it only when
    // complete -- a failure, even a persistent one, must never mutate the published stack.
    const stackIds = [];
    const sliceArrays = [];
    for (let i = 0; i < SLICES; i++) {
      const imageId = `sonadorseglabel:${SEGMENTATION_ID}:${i}`;
      stackIds.push(imageId);
      const sliceData = new Uint8Array(SLICE_LENGTH);
      if (i === 2) {
        sliceData[0] = 7;
      }
      sliceArrays.push(sliceData);
      mockCreateAndCacheLocalImage(imageId, {
        scalarData: sliceData,
        dimensions: [COLUMNS, ROWS],
        spacing: [1, 1],
        origin: [0, 0, i],
        direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
    }
    mockC3dSegmentationState.set(SEGMENTATION_ID, {
      segmentationId: SEGMENTATION_ID,
      segments: {},
      cachedStats: {
        sonadorCanonicalSegmentation: true,
        sonadorDicomSegMetadata: segMetadata,
        sonadorCanonical: {
          firstImageId: FIRST_IMAGE_ID,
          labelmapIndex: 0,
          colorLUTIndex: 0,
          stackImageIds: [...stackImageIds],
          canonicalImageIds: [...stackImageIds],
          dimensions: [COLUMNS, ROWS, SLICES],
          spacing: [1, 1, 1],
          origin: [0, 0, 0],
          direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      },
      representationData: {
        Labelmap: { imageIds: stackIds, referencedImageIds: [...stackImageIds] },
      },
    });
    registeredIds.push(SEGMENTATION_ID);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Replacement-stack admission fails PERSISTENTLY -- a capacity failure, not a glitch. The
    // fallback must fail closed every time without touching the published stack.
    mockImageCreateFailure = imageId => imageId.includes(':r');

    expect(getSegmentationVoxels(SEGMENTATION_ID)).toBeUndefined();
    expect(getSegmentationVoxels(SEGMENTATION_ID)).toBeUndefined();

    // The published stack is untouched -- the SAME per-slice arrays, still committed on the
    // representation data, no replacement remnants, original voxels intact.
    stackIds.forEach((id, i) => {
      expect(mockImageCache.has(id)).toBe(true);
      expect(Object.is(
        mockImageCache.get(id).voxelManager.getScalarData(), sliceArrays[i])).toBe(true);
    });
    expect(mockC3dSegmentationState.get(SEGMENTATION_ID).representationData.Labelmap.imageIds)
      .toEqual(stackIds);
    expect([...mockImageCache.keys()].filter(id => id.includes(':r'))).toEqual([]);
    expect(mockImageCache.get(stackIds[2]).voxelManager.getScalarData()[0]).toBe(7);

    // Once admission works again, the stack is still ATTACHABLE: reconstruction commits a
    // generation-numbered replacement over one contiguous array, edit preserved, and a display
    // materialises over it.
    mockImageCreateFailure = null;
    const volume = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(volume.volumeId).toBe(`${SEGMENTATION_ID}::display-1`);
    volume.imageIds.forEach(id => expect(id.includes(':r1:')).toBe(true));
    const voxels = getSegmentationVoxels(SEGMENTATION_ID);
    expect(voxels[2 * SLICE_LENGTH]).toBe(7);
    volume.imageIds.forEach(id => {
      expect(Object.is(
        mockImageCache.get(id).voxelManager.getScalarData().buffer, voxels.buffer)).toBe(true);
    });
    detachSegmentationDisplay(SEGMENTATION_ID);
    warn.mockRestore();
  });

  it('reconstructs the runtime wiring from Cornerstone3D state and the cache alone', async () => {
    // Simulate a prior process: the segmentation entry, its cachedStats and the pinned stack
    // images exist (built here exactly as an import lays them out), but this module holds no
    // registration for it.
    const canonical = new Uint8Array(SLICE_LENGTH * SLICES);
    canonical[2 * SLICE_LENGTH] = 1;
    const stackIds = [];
    for (let i = 0; i < SLICES; i++) {
      const imageId = `sonadorseglabel:${SEGMENTATION_ID}:${i}`;
      stackIds.push(imageId);
      mockCreateAndCacheLocalImage(imageId, {
        scalarData: canonical.subarray(i * SLICE_LENGTH, (i + 1) * SLICE_LENGTH),
        dimensions: [COLUMNS, ROWS],
        spacing: [1, 1],
        origin: [0, 0, i],
        direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
    }
    mockC3dSegmentationState.set(SEGMENTATION_ID, {
      segmentationId: SEGMENTATION_ID,
      segments: { 1: { segmentIndex: 1, label: 'Liver' } },
      cachedStats: {
        sonadorCanonicalSegmentation: true,
        sonadorDicomSegMetadata: segMetadata,
        sonadorCanonical: {
          firstImageId: FIRST_IMAGE_ID,
          labelmapIndex: 0,
          colorLUTIndex: 0,
          stackImageIds: [...stackImageIds],
          canonicalImageIds: [...stackImageIds],
          dimensions: [COLUMNS, ROWS, SLICES],
          spacing: [1, 1, 1],
          origin: [0, 0, 0],
          direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      },
      representationData: {
        Labelmap: { imageIds: stackIds, referencedImageIds: [...stackImageIds] },
      },
    });
    registeredIds.push(SEGMENTATION_ID);

    // A voxel read reconstructs -- and ALIASES the images' shared buffer, so writes still land in
    // the cache-held pixels.
    const voxels = getSegmentationVoxels(SEGMENTATION_ID);
    expect(voxels[2 * SLICE_LENGTH]).toBe(1);
    expect(Object.is(voxels.buffer, canonical.buffer)).toBe(true);

    // The reconstructed wiring attaches and installs the legacy view like any import.
    const volume = attachSegmentationDisplay(SEGMENTATION_ID);
    expect(volume.volumeId).toBe(`${SEGMENTATION_ID}::display-1`);
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();
    detachSegmentationDisplay(SEGMENTATION_ID);
  });
});


describe('the Seg-Editor working copy (fork/release)', () => {
  // #136 fifth amendment, note 37810: "editing" creates a copy. The fork is a one-time snapshot
  // into a distinct Cornerstone3D-owned segmentation; there is NO event route between source and
  // copy in either direction, and the copy never has a legacy view.

  const WORKING_ID = `${SEGMENTATION_ID}::edit`;

  it('creates an independent identity, voxel store and segment config', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    importSegmentation();

    const fork = forkSegmentationForEditor(SEGMENTATION_ID);
    expect(fork.workingSegmentationId).toBe(WORKING_ID);

    const sourceVoxels = getSegmentationVoxels(SEGMENTATION_ID);
    const workingVoxels = getSegmentationVoxels(WORKING_ID);
    expect(Object.is(sourceVoxels.buffer, workingVoxels.buffer)).toBe(false);
    expect(workingVoxels[2 * SLICE_LENGTH]).toBe(1); // snapshot carried the source voxels

    const working = mockC3dSegmentationState.get(WORKING_ID);
    expect(working.cachedStats.sonadorEditorWorkingCopyOf).toBe(SEGMENTATION_ID);
    expect(Object.is(
      working.segments[1], mockC3dSegmentationState.get(SEGMENTATION_ID).segments[1])).toBe(false);

    // Not part of the series roster the viewports consult.
    expect(getCanonicalSegmentationsForSeries(FIRST_IMAGE_ID)
      .map(record => record.segmentationId)).toEqual([SEGMENTATION_ID]);

    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('carries the full provenance on the working entry, deep-cloned from the source', async () => {
    // The metadata half of the copy boundary (!87 note 37857): the working Cornerstone3D entry
    // must itself hold everything #95's serializer needs -- DICOM provenance, the reversible
    // segment-value map, geometry/references -- with no nested reference shared with the source.
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    importSegmentation({ canonical: { segmentValueMap: { 300: 2 } } });
    forkSegmentationForEditor(SEGMENTATION_ID);

    const source = mockC3dSegmentationState.get(SEGMENTATION_ID);
    const working = mockC3dSegmentationState.get(WORKING_ID);

    // Full record, never the canonical flag.
    expect(working.cachedStats.sonadorCanonicalSegmentation).toBeUndefined();
    expect(working.cachedStats.sonadorDicomSegMetadata).toEqual(source.cachedStats.sonadorDicomSegMetadata);
    expect(Object.is(
      working.cachedStats.sonadorDicomSegMetadata, source.cachedStats.sonadorDicomSegMetadata)).toBe(false);
    expect(working.cachedStats.sonadorSegmentValueMap).toEqual({ 300: 2 });
    expect(Object.is(
      working.cachedStats.sonadorSegmentValueMap, source.cachedStats.sonadorSegmentValueMap)).toBe(false);
    expect(working.cachedStats.sonadorCanonical.dimensions).toEqual([COLUMNS, ROWS, SLICES]);
    expect(Object.is(
      working.cachedStats.sonadorCanonical, source.cachedStats.sonadorCanonical)).toBe(false);

    // Each cloned segment's coded entry aliases the WORKING copy's own metadata, as the source's
    // aliases the source's.
    expect(working.segments[1].cachedStats.dicom).toBeDefined();
    expect(Object.is(
      working.segments[1].cachedStats.dicom, source.segments[1].cachedStats.dicom)).toBe(false);
    expect(Object.is(
      working.segments[1].cachedStats.dicom,
      working.cachedStats.sonadorDicomSegMetadata.data[1])).toBe(true);

    // An editor-side NESTED metadata change stays in the copy.
    working.segments[1].cachedStats.dicom.SegmentLabel = 'Liver (edited)';
    working.cachedStats.sonadorDicomSegMetadata.data[1].SegmentedPropertyCategoryCodeSequence = ['edited'];
    expect(source.segments[1].cachedStats.dicom.SegmentLabel).toBe('Liver');
    expect(segMetadata.data[1].SegmentLabel).toBe('Liver');
    expect(segMetadata.data[1].SegmentedPropertyCategoryCodeSequence).toBeUndefined();

    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('reconstructs a working copy from Cornerstone3D state alone, with no legacy view', async () => {
    // `_registrations` must stay rebuildable runtime wiring for the working copy too (note
    // 37857): simulate a prior process that forked -- entry, cachedStats and pinned stack exist,
    // this module holds no registration -- and read, then release, through state alone.
    const voxels = new Uint8Array(SLICE_LENGTH * SLICES);
    voxels[3 * SLICE_LENGTH] = 2;
    const workingStackIds = [];
    for (let i = 0; i < SLICES; i++) {
      const imageId = `sonadorseglabel:${WORKING_ID}:${i}`;
      workingStackIds.push(imageId);
      mockCreateAndCacheLocalImage(imageId, {
        scalarData: voxels.subarray(i * SLICE_LENGTH, (i + 1) * SLICE_LENGTH),
        dimensions: [COLUMNS, ROWS],
        spacing: [1, 1],
        origin: [0, 0, i],
        direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
    }
    mockC3dSegmentationState.set(WORKING_ID, {
      segmentationId: WORKING_ID,
      segments: { 2: { segmentIndex: 2, label: 'Lesion' } },
      cachedStats: {
        sonadorEditorWorkingCopyOf: SEGMENTATION_ID,
        sonadorDicomSegMetadata: { data: [] },
        sonadorCanonical: {
          firstImageId: FIRST_IMAGE_ID,
          labelmapIndex: 0,
          colorLUTIndex: 0,
          stackImageIds: [...stackImageIds],
          canonicalImageIds: [...stackImageIds],
          dimensions: [COLUMNS, ROWS, SLICES],
          spacing: [1, 1, 1],
          origin: [0, 0, 0],
          direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      },
      representationData: {
        Labelmap: { imageIds: workingStackIds, referencedImageIds: [...stackImageIds] },
      },
    });

    expect(getSegmentationVoxels(WORKING_ID)[3 * SLICE_LENGTH]).toBe(2);

    // Reconstruction never treats the copy as canonical: no legacy view was installed at the
    // source's series address, and the series roster stays empty.
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID]).toBeUndefined();
    expect(getCanonicalSegmentationsForSeries(FIRST_IMAGE_ID)).toEqual([]);

    // Release also works through reconstruction alone.
    expect(releaseEditorWorkingCopy(WORKING_ID)).toBe(true);
    expect(mockC3dSegmentationState.has(WORKING_ID)).toBe(false);
    expect([...mockImageCache.keys()].filter(id => id.includes('::edit'))).toEqual([]);
  });

  it('editor-side voxel and segment changes leave the source and legacy view unchanged', async () => {
    segMetadata.data[1] = { SegmentNumber: 1, SegmentLabel: 'Liver' };
    importSegmentation();
    forkSegmentationForEditor(SEGMENTATION_ID);
    const volume = attachSegmentationDisplay(WORKING_ID);

    const sourceEvents = [];
    mockC3dEventTarget.addEventListener('SEGMENTATION_DATA_MODIFIED', event => {
      if (event.detail.segmentationId === SEGMENTATION_ID) {
        sourceEvents.push(event.detail);
      }
    });

    // An editor tool writes the working display and announces its slices under the WORKING id.
    mockImageCache.get(volume.imageIds[2]).voxelManager.getScalarData()[0] = 9;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: WORKING_ID, modifiedSlicesToUse: [2],
    });

    // An editor panel operation renames a segment on the WORKING entry.
    mockC3dSegmentationState.get(WORKING_ID).segments[1].label = 'Liver (edited)';
    mockC3dEventTarget.dispatch('SEGMENTATION_MODIFIED', { segmentationId: WORKING_ID });

    // Source voxels, source segments and the legacy view are untouched; nothing was forwarded.
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(1);
    expect(mockC3dSegmentationState.get(SEGMENTATION_ID).segments[1].label).toBe('Liver');
    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    expect(new Uint16Array(registration.labelmap3D.buffer)[2 * SLICE_LENGTH]).toBe(1);
    expect(registration.labelmap3D.metadata.data[1].SegmentLabel).toBe('Liver');
    expect(sourceEvents).toEqual([]);

    detachSegmentationDisplay(WORKING_ID);
    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('source changes after the fork do not update the working copy', async () => {
    importSegmentation();
    forkSegmentationForEditor(SEGMENTATION_ID);

    // A legacy edit lands on the SOURCE after the snapshot.
    const registration = getLabelmapRegistration(SEGMENTATION_ID);
    new Uint16Array(registration.labelmap3D.buffer)[0] = 5;
    pushLegacyLabelmapModified(SEGMENTATION_ID, [0]);

    expect(getSegmentationVoxels(SEGMENTATION_ID)[0]).toBe(5);
    expect(getSegmentationVoxels(WORKING_ID)[0]).toBe(0);

    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('release removes the working state and never the source; a re-fork starts fresh', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    importSegmentation();
    forkSegmentationForEditor(SEGMENTATION_ID);
    const volume = attachSegmentationDisplay(WORKING_ID);
    detachSegmentationDisplay(WORKING_ID);

    // Simulate an edit surviving in a stale copy, then release.
    getSegmentationVoxels(WORKING_ID)[0] = 7;
    releaseEditorWorkingCopy(WORKING_ID);

    expect(mockC3dSegmentationState.has(WORKING_ID)).toBe(false);
    expect(getLabelmapRegistration(WORKING_ID)).toBeUndefined();
    expect([...mockImageCache.keys()].filter(id => id.includes('::edit'))).toEqual([]);
    expect(mockVolumeCache.has(volume.volumeId)).toBe(false);

    // The source is fully intact ...
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();
    expect(getSegmentationVoxels(SEGMENTATION_ID)[2 * SLICE_LENGTH]).toBe(1);

    // ... and a new session snapshots the CURRENT source, not the stale copy.
    forkSegmentationForEditor(SEGMENTATION_ID);
    expect(getSegmentationVoxels(WORKING_ID)[0]).toBe(0);
    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('refuses to install a legacy view for a working copy, even through the public installer', async () => {
    // !87 note 37884: the working provenance retains the SOURCE's (firstImageId, labelmapIndex),
    // so an install for the copy would replace the source's legacy slot and open an
    // editor->legacy route.
    importSegmentation();
    forkSegmentationForEditor(SEGMENTATION_ID);
    const sourceLabelmap3D = mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0];

    expect(ensureLegacyLabelmapView(WORKING_ID)).toBe(false);

    // The source's slot still holds the source's own object; the copy stays Cornerstone3D-only.
    expect(Object.is(
      mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0], sourceLabelmap3D)).toBe(true);
    expect(getLabelmapRegistration(WORKING_ID).labelmap3D).toBeNull();

    // And a working-side voxel event still cannot reach the legacy buffer.
    const volume = attachSegmentationDisplay(WORKING_ID);
    mockImageCache.get(volume.imageIds[2]).voxelManager.getScalarData()[0] = 9;
    mockC3dEventTarget.dispatch('SEGMENTATION_DATA_MODIFIED', {
      segmentationId: WORKING_ID, modifiedSlicesToUse: [2],
    });
    expect(new Uint16Array(sourceLabelmap3D.buffer)[2 * SLICE_LENGTH]).toBe(1);
    expect(new Uint16Array(sourceLabelmap3D.buffer)[0]).toBe(0);

    detachSegmentationDisplay(WORKING_ID);
    releaseEditorWorkingCopy(WORKING_ID);
  });

  it('refuses to release a non-working segmentation through this entry point', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    importSegmentation();

    expect(releaseEditorWorkingCopy(SEGMENTATION_ID)).toBe(false);
    expect(mockC3dSegmentationState.has(SEGMENTATION_ID)).toBe(true);
    warn.mockRestore();
  });
});


describe('lazy legacy install (post-#92 deployments)', () => {
  it('skips the legacy view at import and installs it on demand', async () => {
    mockAppConfig = { lazyLegacyLabelmap: true };
    importSegmentation();

    // No legacy labelmap was built ...
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID]).toBeUndefined();

    // ... the volumetric identity path works without it ...
    const records = getCanonicalSegmentationsForSeries(FIRST_IMAGE_ID);
    expect(records).toHaveLength(1);
    expect(records[0].segmentationId).toBe(SEGMENTATION_ID);

    // ... and a classic consumer can ask for it later, correctly seeded.
    expect(ensureLegacyLabelmapView(SEGMENTATION_ID)).toBe(true);
    const installed = mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0];
    expect(new Uint16Array(installed.buffer)[2 * SLICE_LENGTH]).toBe(1);
  });

  it('is eager by default', async () => {
    importSegmentation();
    expect(mockSegmentationModuleState.series[FIRST_IMAGE_ID].labelmaps3D[0]).toBeDefined();
  });
});
