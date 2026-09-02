// Cornerstone3D streaming-volume utilities for the volumetric surfaces.
//
// Everything Cornerstone3D, vtk.js and @ohif/core is replaced here: those packages are ESM-only or
// pull the whole viewer in, and what these cases are about is the viewer's own decision logic --
// which volume id a display set gets, when a decimated volume is built instead of a full one, how
// a legacy labelmap buffer is mapped onto a volume's slices, and when a shared volume is evicted.

// The image-cache half of this mock models Cornerstone3D 4.22.13's own sharedCacheKey handling,
// because that is the behaviour the eviction-protection case is about. Verified against
// @cornerstonejs/core/dist/esm/cache/cache.js at the pinned version:
//
//   _putVolumeCommon  -- on load, stamps every one of the volume's imageIds with its volumeId,
//                        overwriting whatever key was there.
//   _decacheVolume    -- on removal, clears the key only on images where it equals that volumeId.
//
// The library invariants themselves are pinned separately, in cache.sharedCacheKey.test.js.
const mockCache = {
  volumes: new Map(),
  loadObjects: new Map(),
  _imageCache: new Map(),
  getVolume: jest.fn(id => mockCache.volumes.get(id)),
  getVolumeLoadObject: jest.fn(id => mockCache.loadObjects.get(id)),
  removeVolumeLoadObject: jest.fn(id => {
    const volume = mockCache.volumes.get(id);

    (volume?.imageIds || []).forEach(imageId => {
      const cachedImage = mockCache._imageCache && mockCache._imageCache.get(imageId);
      if (cachedImage && cachedImage.sharedCacheKey === id) {
        cachedImage.sharedCacheKey = undefined;
      }
    });

    mockCache.loadObjects.delete(id);
    mockCache.volumes.delete(id);
  }),
};

// Stand-in for the load completing: the volume enters the cache and claims the slice images.
function completeVolumeLoad(volumeId, imageIds) {
  mockCache.volumes.set(volumeId, { volumeId, imageIds });
  mockCache.loadObjects.set(volumeId, { promise: Promise.resolve() });

  imageIds.forEach(imageId => {
    if (!mockCache._imageCache.has(imageId)) {
      mockCache._imageCache.set(imageId, { imageId });
    }
    mockCache._imageCache.get(imageId).sharedCacheKey = volumeId;
  });
}

const mockCreateAndCacheVolume = jest.fn(async (volumeId, options) => {
  const volume = { volumeId, imageIds: options.imageIds, options };
  mockCache.volumes.set(volumeId, volume);
  mockCache.loadObjects.set(volumeId, { promise: Promise.resolve(volume) });
  return volume;
});

const mockAssessVolumeFit = jest.fn(() => ({
  fits: true,
  reason: 'ok',
  textureBytes: 0,
  budgetBytes: 0,
  maxDepth: 2048,
  suggestedDecimation: null,
}));

const mockGetAllAnnotations = jest.fn(() => []);
const mockRemoveAnnotation = jest.fn();
const mockGetSegmentations = jest.fn(() => []);
const mockRemoveSegmentation = jest.fn();
const mockMetaDataGet = jest.fn(() => undefined);
const mockCanRenderFloatTextures = jest.fn(() => false);

jest.mock('@cornerstonejs/core', () => ({
  init: jest.fn(),
  ImageVolume: class {},
  Enums: { Events: { VOLUME_CACHE_VOLUME_REMOVED: 'VOLUME_CACHE_VOLUME_REMOVED' }, RequestType: {} },
  volumeLoader: { createAndCacheVolume: (...args) => mockCreateAndCacheVolume(...args) },
  cache: mockCache,
  eventTarget: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  metaData: { get: (...args) => mockMetaDataGet(...args) },
  canRenderFloatTextures: (...args) => mockCanRenderFloatTextures(...args),
  getRenderingEngines: jest.fn(() => []),
  getWebWorkerManager: jest.fn(() => ({})),
}), { virtual: true });

jest.mock('@cornerstonejs/core/utilities/triggerEvent', () => jest.fn(), { virtual: true });

jest.mock('@cornerstonejs/tools', () => ({
  init: jest.fn(),
  annotation: {
    state: {
      getAllAnnotations: (...args) => mockGetAllAnnotations(...args),
      removeAnnotation: (...args) => mockRemoveAnnotation(...args),
    },
  },
  segmentation: {
    state: {
      getSegmentations: (...args) => mockGetSegmentations(...args),
      removeSegmentation: (...args) => mockRemoveSegmentation(...args),
    },
    helpers: {},
    triggerSegmentationEvents: {},
  },
}), { virtual: true });

jest.mock('@cornerstonejs/dicom-image-loader', () => ({ init: jest.fn() }), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: jest.fn() }), { virtual: true });
jest.mock('@kitware/vtk.js/Common/DataModel/ImageData', () => ({ vtkImageData: {} }), {
  virtual: true,
});

jest.mock('@ohif/core', () => ({
  utils: {
    cornerstone3dUtils: { initCornerstone3d: jest.fn() },
    gpuCapabilities: { assessVolumeFit: (...args) => mockAssessVolumeFit(...args) },
  },
}), { virtual: true });

const {
  assessDisplaySetVolumeFit,
  createImageVolumeForDisplaySet,
  estimateVolumeShape,
  getVolumeIdForDisplaySet,
  isDecimatedVolumeId,
  mapLabelmapBufferToVolumeOrder,
  suggestDecimationAfterFailure,
  volumeLease,
} = require('./cornerstone3d.js');

const DISPLAY_SET = { displaySetInstanceUID: 'ds-1' };

function resetCache() {
  mockCache.volumes.clear();
  mockCache.loadObjects.clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCache();
  mockAssessVolumeFit.mockReturnValue({
    fits: true,
    reason: 'ok',
    textureBytes: 0,
    budgetBytes: 0,
    maxDepth: 2048,
    suggestedDecimation: null,
  });
  mockGetAllAnnotations.mockReturnValue([]);
  mockGetSegmentations.mockReturnValue([]);
});

// The lease table is module state, so it has to be emptied between cases.
afterEach(() => {
  volumeLease.releaseAll();
});

describe('getVolumeIdForDisplaySet', () => {
  it('is stable, scheme-prefixed, and accepts a display set or a uid', () => {
    expect(getVolumeIdForDisplaySet(DISPLAY_SET)).toBe('cornerstoneStreamingImageVolume:ds-1');
    expect(getVolumeIdForDisplaySet('ds-1')).toBe('cornerstoneStreamingImageVolume:ds-1');
    expect(getVolumeIdForDisplaySet(DISPLAY_SET)).toBe(getVolumeIdForDisplaySet(DISPLAY_SET));
  });

  it('gives the decimated volume a distinct id under its own loader scheme', () => {
    const full = getVolumeIdForDisplaySet(DISPLAY_SET);
    const decimated = getVolumeIdForDisplaySet(DISPLAY_SET, { decimated: true });

    expect(decimated).not.toBe(full);
    // The loader is chosen by the scheme, so the decimated id cannot simply suffix the streaming
    // one -- it would route back to the full-resolution loader.
    expect(decimated.startsWith('cornerstoneDecimatedImageVolume:')).toBe(true);
    expect(isDecimatedVolumeId(decimated)).toBe(true);
    expect(isDecimatedVolumeId(full)).toBe(false);
  });

  it('gives a view with its own WebGL context a distinct id under the same scheme', () => {
    // A Cornerstone3D volume owns one vtkOpenGLTexture, and that texture binds to one render
    // window at a time -- so the inspection modal, which has its own rendering engine, cannot
    // share the MPR panes' volume. It drew black and then left the panes rendering through a
    // destroyed render window.
    const primary = getVolumeIdForDisplaySet(DISPLAY_SET);
    const inspection = getVolumeIdForDisplaySet(DISPLAY_SET, { view: 'inspection' });

    expect(inspection).not.toBe(primary);
    // The loader dispatches on the substring before the first colon, so the scheme must survive.
    expect(inspection.split(':')[0]).toBe('cornerstoneStreamingImageVolume');
    expect(inspection).toContain('ds-1');
  });

  it('combines a view discriminator with the decimated scheme', () => {
    const id = getVolumeIdForDisplaySet(DISPLAY_SET, { view: 'inspection', decimated: true });

    expect(id.split(':')[0]).toBe('cornerstoneDecimatedImageVolume');
    expect(isDecimatedVolumeId(id)).toBe(true);
    expect(id).not.toBe(getVolumeIdForDisplaySet(DISPLAY_SET, { decimated: true }));
  });

  it('ignores an unknown view rather than inventing an id', () => {
    expect(getVolumeIdForDisplaySet(DISPLAY_SET, { view: 'nope' }))
      .toBe(getVolumeIdForDisplaySet(DISPLAY_SET));
  });

  it('returns undefined without a display set', () => {
    expect(getVolumeIdForDisplaySet(undefined)).toBeUndefined();
    expect(getVolumeIdForDisplaySet({})).toBeUndefined();
  });
});

describe('estimateVolumeShape', () => {
  it('reads dimensions and data type from the metadata modules, before any volume exists', () => {
    mockMetaDataGet.mockImplementation(module => {
      if (module === 'imagePlaneModule') {
        return { rows: 512, columns: 512 };
      }
      if (module === 'imagePixelModule') {
        return { bitsAllocated: 16, pixelRepresentation: 1 };
      }
      return { rescaleSlope: 1, rescaleIntercept: -1024 };
    });

    expect(estimateVolumeShape(['a', 'b', 'c'])).toEqual({
      dimensions: [512, 512, 3],
      dataType: 'Int16Array',
    });
  });

  it('uses Uint16 for unsigned data with a non-negative rescale', () => {
    mockMetaDataGet.mockImplementation(module => {
      if (module === 'imagePlaneModule') {
        return { rows: 256, columns: 256 };
      }
      if (module === 'imagePixelModule') {
        return { bitsAllocated: 16, pixelRepresentation: 0 };
      }
      return { rescaleSlope: 1, rescaleIntercept: 0 };
    });

    expect(estimateVolumeShape(['a']).dataType).toBe('Uint16Array');
  });

  it('falls back to Int16 when the bit depth is unknown, which never under-estimates', () => {
    mockMetaDataGet.mockReturnValue(undefined);
    expect(estimateVolumeShape(['a']).dataType).toBe('Int16Array');
  });
});

describe('pre-flight branch selection', () => {
  const imageIds = ['i0', 'i1', 'i2', 'i3'];

  it('ok -> the full-resolution streaming loader and the full id', async () => {
    const fit = assessDisplaySetVolumeFit(imageIds);
    const { volumeId, decimated } = await createImageVolumeForDisplaySet({
      imageIds, displaySet: DISPLAY_SET, fit,
    });

    expect(decimated).toBe(false);
    expect(volumeId).toBe('cornerstoneStreamingImageVolume:ds-1');
    expect(mockCreateAndCacheVolume).toHaveBeenCalledWith(volumeId, { imageIds });
  });

  it('depth -> the decimated loader with the suggested decimation', async () => {
    mockAssessVolumeFit.mockReturnValue({
      fits: false, reason: 'depth', maxDepth: 2048, suggestedDecimation: [1, 1, 2],
    });

    const fit = assessDisplaySetVolumeFit(imageIds);
    const { volumeId, decimated } = await createImageVolumeForDisplaySet({
      imageIds, displaySet: DISPLAY_SET, fit,
    });

    expect(decimated).toBe(true);
    expect(volumeId.startsWith('cornerstoneDecimatedImageVolume:')).toBe(true);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledWith(volumeId, {
      imageIds, ijkDecimation: [1, 1, 2],
    });
  });

  it('budget -> the decimated loader too, and the caller gets its own imageIds copy', async () => {
    mockAssessVolumeFit.mockReturnValue({
      fits: false, reason: 'budget', maxDepth: 2048, suggestedDecimation: [2, 2, 3],
    });

    const fit = assessDisplaySetVolumeFit(imageIds);
    await createImageVolumeForDisplaySet({ imageIds, displaySet: DISPLAY_SET, fit });

    const passed = mockCreateAndCacheVolume.mock.calls[0][1];
    expect(passed.ijkDecimation).toEqual([2, 2, 3]);
    // decimatedVolumeLoader rewrites options.imageIds in place, so the caller's array must not be
    // the one it is handed.
    expect(passed.imageIds).not.toBe(imageIds);
    expect(passed.imageIds).toEqual(imageIds);
  });

  it('falls back to a decimation after a failed allocation the pre-flight had passed', () => {
    // The client accepted the shape and then refused the allocation, so the retry is sized against
    // half the bytes it just refused rather than an arbitrary factor.
    mockAssessVolumeFit.mockReturnValue({
      fits: false, reason: 'budget', maxDepth: 2048, suggestedDecimation: [1, 1, 2],
    });

    const decimation = suggestDecimationAfterFailure({
      fits: true,
      reason: 'ok',
      dimensions: [512, 512, 1600],
      dataType: 'Int16Array',
      textureBytes: 800000000,
    });

    expect(decimation).toEqual([1, 1, 2]);
    expect(mockAssessVolumeFit).toHaveBeenCalledWith({
      dimensions: [512, 512, 1600], dataType: 'Int16Array', budgetBytes: 400000000,
    });
  });

  it('has no fallback to offer when the assessment carries no shape', () => {
    expect(suggestDecimationAfterFailure(undefined)).toBeNull();
    expect(suggestDecimationAfterFailure({ fits: true })).toBeNull();
  });

  it('builds the volume under the view-specific id when one is asked for', async () => {
    const fit = assessDisplaySetVolumeFit(imageIds);
    const { volumeId } = await createImageVolumeForDisplaySet({
      imageIds, displaySet: DISPLAY_SET, fit, volumeIdOptions: { view: 'inspection' },
    });

    expect(volumeId).toBe(getVolumeIdForDisplaySet(DISPLAY_SET, { view: 'inspection' }));
    expect(mockCreateAndCacheVolume).toHaveBeenCalledWith(volumeId, { imageIds });
  });

  it('reuses the volume already in the cache instead of creating a second one', async () => {
    const fit = assessDisplaySetVolumeFit(imageIds);
    const first = await createImageVolumeForDisplaySet({ imageIds, displaySet: DISPLAY_SET, fit });
    const second = await createImageVolumeForDisplaySet({ imageIds, displaySet: DISPLAY_SET, fit });

    expect(second.volume).toBe(first.volume);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(1);
  });
});

describe('volumeLease and slice-eviction protection', () => {
  // Closing the inspection modal must not leave the MPR volume's slices evictable. The modal has
  // its own volume id over the same imageIds, so it is the second to load and takes the shared
  // cache key from the MPR volume; removing it clears that key, and an unstamped image is the
  // first thing the cache evicts when it needs space.
  const PRIMARY = 'cornerstoneStreamingImageVolume:ds-shared';
  const INSPECTION = 'cornerstoneStreamingImageVolume:ds-shared::inspection';
  const IMAGE_IDS = ['img-0', 'img-1', 'img-2'];

  const keys = () => IMAGE_IDS.map(id => mockCache._imageCache.get(id).sharedCacheKey);

  beforeEach(() => {
    mockCache._imageCache.clear();
    completeVolumeLoad(PRIMARY, IMAGE_IDS);
    volumeLease.acquire(PRIMARY);

    completeVolumeLoad(INSPECTION, IMAGE_IDS);
    volumeLease.acquire(INSPECTION);
  });

  it('the second volume takes the shared cache key from the first', () => {
    // Not the fix -- the library's behaviour, asserted so the case below cannot pass vacuously.
    expect(keys()).toEqual([INSPECTION, INSPECTION, INSPECTION]);
  });

  it('hands protection back to the still-leased volume when the second is released', () => {
    volumeLease.release(INSPECTION);

    expect(mockCache.volumes.has(INSPECTION)).toBe(false);
    expect(keys()).toEqual([PRIMARY, PRIMARY, PRIMARY]);
  });

  it('leaves the slices unprotected once nothing holds a lease on them', () => {
    volumeLease.release(INSPECTION);
    volumeLease.release(PRIMARY);

    // Both volumes are gone, so the slices are meant to age out of the LRU normally.
    expect(keys()).toEqual([undefined, undefined, undefined]);
  });

  it('does not re-stamp against a volume nothing holds a lease on', () => {
    volumeLease.release(PRIMARY);

    // The inspection volume owns the key and is still leased, so nothing changes hands.
    expect(keys()).toEqual([INSPECTION, INSPECTION, INSPECTION]);
  });

  it('tolerates a cache with no image map', () => {
    const imageCache = mockCache._imageCache;
    mockCache._imageCache = undefined;

    try {
      expect(() => volumeLease.release(INSPECTION)).not.toThrow();
    } finally {
      mockCache._imageCache = imageCache;
    }
  });
});

describe('volumeLease', () => {
  const volumeId = 'cornerstoneStreamingImageVolume:ds-lease';

  beforeEach(() => {
    mockCache.loadObjects.set(volumeId, { promise: Promise.resolve({}) });
    mockCache.volumes.set(volumeId, { volumeId });
  });

  it('keeps the volume while another holder still has it', () => {
    volumeLease.acquire(volumeId);
    volumeLease.acquire(volumeId);

    expect(volumeLease.release(volumeId)).toBe(1);
    expect(mockCache.removeVolumeLoadObject).not.toHaveBeenCalled();
    expect(volumeLease.count(volumeId)).toBe(1);
  });

  it('evicts the volume, its annotations and its derived labelmaps on the last release', () => {
    mockGetAllAnnotations.mockReturnValue([
      { annotationUID: 'a1', metadata: { volumeId } },
      { annotationUID: 'a2', metadata: { volumeId: 'someone-else' } },
    ]);
    mockGetSegmentations.mockReturnValue([
      {
        segmentationId: 'seg-1',
        representationData: { Labelmap: { referenceVolumeId: volumeId, volumeId: 'labelmap-1' } },
      },
    ]);
    mockCache.loadObjects.set('labelmap-1', { promise: Promise.resolve({}) });

    volumeLease.acquire(volumeId);
    volumeLease.acquire(volumeId);
    volumeLease.release(volumeId);
    expect(volumeLease.release(volumeId)).toBe(0);

    expect(mockRemoveAnnotation).toHaveBeenCalledTimes(1);
    expect(mockRemoveAnnotation).toHaveBeenCalledWith('a1');
    expect(mockRemoveSegmentation).toHaveBeenCalledWith('seg-1');
    expect(mockCache.removeVolumeLoadObject).toHaveBeenCalledWith('labelmap-1');
    expect(mockCache.removeVolumeLoadObject).toHaveBeenCalledWith(volumeId);
    expect(volumeLease.count(volumeId)).toBe(0);
  });

  it('ignores a release for a volume it never held', () => {
    expect(volumeLease.release('cornerstoneStreamingImageVolume:never')).toBe(0);
    expect(mockCache.removeVolumeLoadObject).not.toHaveBeenCalled();
  });

  it('releaseAll drops every lease it knows about', () => {
    const other = 'cornerstoneStreamingImageVolume:ds-other';
    mockCache.loadObjects.set(other, { promise: Promise.resolve({}) });

    volumeLease.acquire(volumeId);
    volumeLease.acquire(volumeId);
    volumeLease.acquire(other);

    const released = volumeLease.releaseAll();

    expect(released.sort()).toEqual([other, volumeId].sort());
    expect(mockCache.removeVolumeLoadObject).toHaveBeenCalledWith(volumeId);
    expect(mockCache.removeVolumeLoadObject).toHaveBeenCalledWith(other);
    expect(volumeLease.count(volumeId)).toBe(0);
    expect(volumeLease.releaseAll()).toEqual([]);
  });
});

describe('mapLabelmapBufferToVolumeOrder', () => {
  // 2x2 slices so a slice is four voxels and its value is easy to read back.
  const COLUMNS = 2;
  const ROWS = 2;
  const SLICE_LENGTH = COLUMNS * ROWS;

  function makeVolume(volumeOrderedImageIds) {
    return {
      dimensions: [COLUMNS, ROWS, volumeOrderedImageIds.length],
      getImageIdIndex: imageId => {
        const index = volumeOrderedImageIds.indexOf(imageId);
        return index === -1 ? undefined : index;
      },
    };
  }

  function makeBuffer(sliceValues) {
    const buffer = new Uint16Array(sliceValues.length * SLICE_LENGTH);
    sliceValues.forEach((value, slice) => {
      buffer.fill(value, slice * SLICE_LENGTH, (slice + 1) * SLICE_LENGTH);
    });
    return buffer;
  }

  function sliceValues(scalars, slices) {
    return Array.from({ length: slices }, (_unused, i) => scalars[i * SLICE_LENGTH]);
  }

  it('maps each slice to the volume index of its imageId on a shuffled stack', () => {
    // The stack is in display-set order; the streaming loader sorted by image position.
    const stackImageIds = ['i-c', 'i-a', 'i-d', 'i-b'];
    const volume = makeVolume(['i-a', 'i-b', 'i-c', 'i-d']);

    // Slice n of the buffer is filled with n + 1, so the segment values name their stack slice.
    const scalars = mapLabelmapBufferToVolumeOrder(volume, stackImageIds, makeBuffer([1, 2, 3, 4]));

    // Stack slice 0 (value 1) was drawn on i-c, which is volume slice 2, and so on.
    expect(sliceValues(scalars, 4)).toEqual([2, 4, 1, 3]);
  });

  it('is the identity when the stack is already in volume order', () => {
    const stackImageIds = ['i-a', 'i-b', 'i-c'];
    const volume = makeVolume(stackImageIds);

    const scalars = mapLabelmapBufferToVolumeOrder(volume, stackImageIds, makeBuffer([5, 6, 7]));

    expect(sliceValues(scalars, 3)).toEqual([5, 6, 7]);
  });

  it('drops slices the volume does not contain, as a decimated volume does', () => {
    const stackImageIds = ['i-a', 'i-b', 'i-c', 'i-d'];
    // Every second slice survives decimation.
    const volume = makeVolume(['i-a', 'i-c']);

    const scalars = mapLabelmapBufferToVolumeOrder(volume, stackImageIds, makeBuffer([1, 2, 3, 4]));

    expect(scalars).toHaveLength(SLICE_LENGTH * 2);
    expect(sliceValues(scalars, 2)).toEqual([1, 3]);
  });

  it('accepts an ArrayBuffer as well as a typed array', () => {
    const stackImageIds = ['i-a', 'i-b'];
    const volume = makeVolume(['i-b', 'i-a']);

    const scalars = mapLabelmapBufferToVolumeOrder(
      volume, stackImageIds, makeBuffer([9, 8]).buffer);

    expect(sliceValues(scalars, 2)).toEqual([8, 9]);
  });
});
