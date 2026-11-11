// The SEG parser: the Cornerstone3D adapter's labelmap images, reshaped into the layers the dcmjs
// 0.41 loader returned, checked against that loader on synthetic SEGs (see
// __fixtures__/generate_seg_fixtures.py). The adapter runs from its ESM build; @cornerstonejs/core
// is replaced by a metadata registry, an image cache and an event target that behave as the
// library's own do for what the adapter uses.

import dcmjs from 'dcmjs';
import fs from 'fs';
import path from 'path';

const mockProviders = [];
const mockCacheEntries = new Map();
const mockListeners = {};
let mockDerivedCount = 0;

jest.mock('@cornerstonejs/core', () => {
  const get = (type, imageId) => {
    for (const provider of mockProviders) {
      const answer = provider(type, imageId);
      if (answer !== undefined) {
        return answer;
      }
    }
    return undefined;
  };
  const metaData = { get, addProvider: provider => mockProviders.push(provider) };
  const eventTarget = {
    addEventListener: (type, fn) => {
      (mockListeners[type] = mockListeners[type] || new Set()).add(fn);
    },
    removeEventListener: (type, fn) => mockListeners[type] && mockListeners[type].delete(fn),
  };
  const triggerEvent = (target, type, detail) => {
    (mockListeners[type] || new Set()).forEach(fn => fn({ type, detail }));
  };
  const Events = { IMAGE_CACHE_IMAGE_ADDED: 'CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED' };
  const cache = {
    putImageSync: (imageId, image) => {
      if (mockCacheEntries.has(imageId)) {
        throw new Error('putImageSync: imageId already in cache');
      }
      const cached = { imageId, image };
      mockCacheEntries.set(imageId, cached);
      triggerEvent(eventTarget, Events.IMAGE_CACHE_IMAGE_ADDED, { image: cached });
    },
    getImageLoadObject: imageId => (mockCacheEntries.has(imageId) ? {} : undefined),
    removeImageLoadObject: imageId => {
      if (!mockCacheEntries.has(imageId)) {
        throw new Error('removeImageLoadObject: imageId was not present in imageCache');
      }
      mockCacheEntries.delete(imageId);
    },
  };
  // As createAndCacheDerivedLabelmapImage: a Uint8 image the size of the referenced image, whose
  // voxel manager and getPixelData share one array, admitted to the cache under `derived:<n>`.
  const createAndCacheDerivedLabelmapImage = referencedImageId => {
    const plane = get('imagePlaneModule', referencedImageId);
    const scalarData = new Uint8Array(plane.rows * plane.columns);
    mockDerivedCount += 1;
    const imageId = `derived:${mockDerivedCount}`;
    const image = {
      imageId,
      referencedImageId,
      getPixelData: () => scalarData,
      voxelManager: {
        getScalarData: () => scalarData,
        setAtIndex: (index, value) => { scalarData[index] = value; },
      },
    };
    cache.putImageSync(imageId, image);
    return image;
  };
  const isEqual = (a, b, tolerance = 1e-5) => {
    if (Array.isArray(a) || ArrayBuffer.isView(a)) {
      return a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]) <= tolerance);
    }
    return Math.abs(a - b) <= tolerance;
  };
  return {
    metaData,
    cache,
    eventTarget,
    triggerEvent,
    Enums: { Events },
    imageLoader: { createAndCacheDerivedLabelmapImage },
    utilities: { isEqual },
  };
}, { virtual: true });

jest.mock('@cornerstonejs/tools', () => ({ utilities: { throttle: fn => fn } }), { virtual: true });

const mockAdapterDist = '../../../../node_modules/@cornerstonejs/adapters/dist/esm/adapters';

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSEG: {
    Cornerstone3D: {
      Segmentation: {
        createFromDICOMSegBuffer: (...args) => jest.requireActual(
          `${mockAdapterDist}/Cornerstone3D/Segmentation/generateToolState.js`).createFromDICOMSegBuffer(...args),
      },
    },
  },
}), { virtual: true });

jest.mock('@cornerstonejs/adapters/cornerstone/Segmentation_4X', () => jest.requireActual(
  `${mockAdapterDist}/Cornerstone/Segmentation_4X.js`), { virtual: true });

jest.mock('cornerstone-core', () => ({
  metaData: { get: (type, imageId) => require('@cornerstonejs/core').metaData.get(type, imageId) },
}));

const { metaData } = require('@cornerstonejs/core');
const {
  default: parseSeg, parseSegWithLegacyLoader, getLegacyParserReason,
} = require('./parseSegWithAdapter.js');

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const FIXTURES = path.join(__dirname, '__fixtures__');
const SLICES = 4;
const SLICE_LENGTH = 64;

// Voxels per segment in the fixtures (generate_seg_fixtures.py)
const NONOVERLAP_VOXELS = { 1: 2 * 9, 2: 3 * 9 };
const OVERLAP_VOXELS = { 1: 3 * 16, 2: 4 * 16 };

function readFixture(name) {
  const buffer = fs.readFileSync(path.join(FIXTURES, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function naturalize(arrayBuffer) {
  const dicomData = DicomMessage.readFile(arrayBuffer);
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);
  return dataset;
}

function rewrite(arrayBuffer, change) {
  const dataset = naturalize(arrayBuffer);
  change(dataset);
  return dcmjs.data.datasetToDict(dataset).write();
}

// The modules the adapter and the dcmjs loader ask for, from one instance (or one frame of one)
function modulesFor(instance, framePosition) {
  const iop = instance.ImageOrientationPatient
    || instance.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient;
  const spacing = instance.PixelSpacing
    || instance.SharedFunctionalGroupsSequence.PixelMeasuresSequence.PixelSpacing;
  const imagePositionPatient = framePosition || instance.ImagePositionPatient;
  return {
    instance: { ...instance, ImagePositionPatient: imagePositionPatient },
    generalImageModule: { sopInstanceUID: instance.SOPInstanceUID },
    generalSeriesModule: { seriesInstanceUID: instance.SeriesInstanceUID },
    sopCommonModule: { sopInstanceUID: instance.SOPInstanceUID },
    imagePixelModule: { rows: instance.Rows, columns: instance.Columns },
    imagePlaneModule: {
      rows: instance.Rows,
      columns: instance.Columns,
      rowCosines: iop.slice(0, 3),
      columnCosines: iop.slice(3, 6),
      imagePositionPatient,
      rowPixelSpacing: spacing[0],
      columnPixelSpacing: spacing[1],
      frameOfReferenceUID: instance.FrameOfReferenceUID,
    },
  };
}

const mockRegistry = new Map();
metaData.addProvider((type, imageId) => {
  const modules = mockRegistry.get(imageId);
  return modules ? modules[type] : undefined;
});

const ctInstances = [0, 1, 2, 3].map(i => naturalize(readFixture(`ct_${i}.dcm`)));
const CT_IMAGE_IDS = ctInstances.map(
  instance => `dicomweb:https://example.invalid/wado?requestType=WADO&objectUID=${instance.SOPInstanceUID}`);
ctInstances.forEach((instance, i) => mockRegistry.set(CT_IMAGE_IDS[i], modulesFor(instance)));

const enhanced = naturalize(readFixture('enhanced_ct.dcm'));
const framePositions = enhanced.PerFrameFunctionalGroupsSequence.map(
  group => group.PlanePositionSequence.ImagePositionPatient);
const MULTIFRAME_ID_SCHEMES = {
  dicomweb: frame => `dicomweb:https://example.invalid/wado?requestType=WADO&objectUID=${enhanced.SOPInstanceUID}&frame=${frame}`,
  wadors: frame => `wadors:https://example.invalid/studies/s/series/r/instances/${enhanced.SOPInstanceUID}/frames/${frame + 1}`,
  sonadorlocal: frame => `sonadorlocal:${enhanced.SOPInstanceUID}?frame=${frame}`,
};
Object.values(MULTIFRAME_ID_SCHEMES).forEach(idFor => framePositions.forEach((position, frame) => {
  mockRegistry.set(idFor(frame), modulesFor(enhanced, position));
}));

function voxelsPerSegment(buffer) {
  const counts = {};
  new Uint16Array(buffer).forEach(value => {
    if (value) {
      counts[value] = (counts[value] || 0) + 1;
    }
  });
  return counts;
}

function layerSegments(segmentsOnFrame) {
  return [...new Set(segmentsOnFrame.filter(Boolean).flat())].sort();
}

function adapterImagesInCache() {
  return [...mockCacheEntries.keys()].filter(imageId => imageId.startsWith('derived:'));
}

beforeEach(() => {
  mockCacheEntries.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseSeg through the Cornerstone3D adapter', () => {
  it('returns the dcmjs loader\'s buffer, membership and metadata for a non-overlapping SEG', async () => {
    const arrayBuffer = readFixture('seg_nonoverlap.dcm');

    const result = await parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2);
    const legacy = parseSegWithLegacyLoader(arrayBuffer, CT_IMAGE_IDS, 1e-2, metaData);

    expect(result.parser).toBe('adapter');
    expect(result.labelmapBufferArray).toHaveLength(1);
    // An ArrayBuffer, as the dcmjs loader's (compared by tag: jest runs suites in their own realm)
    expect(Object.prototype.toString.call(result.labelmapBufferArray[0])).toBe('[object ArrayBuffer]');
    expect(result.labelmapBufferArray[0].byteLength).toBe(SLICE_LENGTH * SLICES * 2);
    expect(new Uint16Array(result.labelmapBufferArray[0]))
      .toEqual(new Uint16Array(legacy.labelmapBufferArray[0]));
    expect(voxelsPerSegment(result.labelmapBufferArray[0])).toEqual(NONOVERLAP_VOXELS);

    // Per-frame membership, in the dcmjs form: slice -> segment numbers
    expect(result.segmentsOnFrameArray[0]).toEqual([[1], [1, 2], [2], [2]]);
    expect(result.segmentsOnFrame).toEqual(legacy.segmentsOnFrame.map(list => [...list].sort()));

    // The segment metadata the panel and colour LUT read
    expect(result.segMetadata.seriesInstanceUid).toBe(legacy.segMetadata.seriesInstanceUid);
    expect(result.segMetadata.data).toHaveLength(3);
    expect(result.segMetadata.data[0]).toBeUndefined();
    [1, 2].forEach(n => {
      const segment = result.segMetadata.data[n];
      const legacySegment = legacy.segMetadata.data[n];
      expect(segment.SegmentNumber).toBe(legacySegment.SegmentNumber);
      expect(segment.SegmentLabel).toBe(legacySegment.SegmentLabel);
      expect(segment.RecommendedDisplayCIELabValue).toEqual(legacySegment.RecommendedDisplayCIELabValue);
      expect(JSON.parse(JSON.stringify(segment))).toEqual(JSON.parse(JSON.stringify(legacySegment)));
    });
  });

  it('puts each overlapping segment whole on one layer, losing no voxel', async () => {
    const arrayBuffer = readFixture('seg_overlap.dcm');

    const result = await parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2);

    expect(result.labelmapBufferArray).toHaveLength(2);
    const perLayer = result.labelmapBufferArray.map(voxelsPerSegment);
    expect(perLayer).toEqual([{ 1: OVERLAP_VOXELS[1] }, { 2: OVERLAP_VOXELS[2] }]);
    expect(result.segmentsOnFrameArray.map(layerSegments)).toEqual([[1], [2]]);
    expect(result.segmentsOnFrameArray[1]).toEqual([[2], [2], [2], [2]]);
    expect(result.segmentsOnFrame).toEqual([[1, 2], [1, 2], [1, 2], [2]]);

    // Same layers as the dcmjs loader on this frame order
    const legacy = parseSegWithLegacyLoader(arrayBuffer, CT_IMAGE_IDS, 1e-2, metaData);
    result.labelmapBufferArray.forEach((buffer, layer) => {
      expect(new Uint16Array(buffer)).toEqual(new Uint16Array(legacy.labelmapBufferArray[layer]));
    });
  });

  it('keeps the frame the dcmjs loader skips when a moved segment owns SEG frame 0', async () => {
    // Slice-major frame order puts segment 2 (which must move to a second layer) at frame 0. The
    // dcmjs loader restarts its scan at frame 1 after the move, and loses that frame.
    const arrayBuffer = readFixture('seg_overlap_interleaved.dcm');

    const result = await parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2);
    const legacy = parseSegWithLegacyLoader(arrayBuffer, CT_IMAGE_IDS, 1e-2, metaData);

    expect(result.labelmapBufferArray.map(voxelsPerSegment))
      .toEqual([{ 1: OVERLAP_VOXELS[1] }, { 2: OVERLAP_VOXELS[2] }]);
    expect(voxelsPerSegment(legacy.labelmapBufferArray[1])[2]).toBe(OVERLAP_VOXELS[2] - 16);
  });

  it('removes every image the adapter created from the Cornerstone3D cache', async () => {
    const before = mockDerivedCount;
    const unrelated = 'derived:held-by-someone-else';
    mockCacheEntries.set(unrelated, { imageId: unrelated, image: { referencedImageId: CT_IMAGE_IDS[0] } });

    await parseSeg(readFixture('seg_overlap.dcm'), CT_IMAGE_IDS, 1e-2);

    // The overlapping path builds a first set of images and then one set per layer
    expect(mockDerivedCount - before).toBe(SLICES * 3);
    expect(adapterImagesInCache()).toEqual([unrelated]);
  });

  it('removes the adapter\'s images when the parse fails', async () => {
    // A frame whose plane is perpendicular to the series: rejected as orthogonal
    const arrayBuffer = rewrite(readFixture('seg_nonoverlap.dcm'), dataset => {
      dataset.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient = [1, 0, 0, 0, 0, -1];
    });

    await expect(parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2)).rejects.toThrow(/orthogonal/);
    expect(adapterImagesInCache()).toEqual([]);
  });

  describe('leaves alone a labelmap another consumer creates for the same source image meanwhile', () => {
    const segmentation = () => require('@cornerstonejs/adapters').adaptersSEG.Cornerstone3D.Segmentation;
    let original;
    let unrelated;
    beforeEach(() => {
      original = segmentation().createFromDICOMSegBuffer;
      segmentation().createFromDICOMSegBuffer = (...args) => {
        const pending = original(...args);
        // While the parse waits on the adapter
        Promise.resolve().then(() => {
          unrelated = require('@cornerstonejs/core').imageLoader.createAndCacheDerivedLabelmapImage(CT_IMAGE_IDS[0]).imageId;
        });
        return pending;
      };
    });
    afterEach(() => { segmentation().createFromDICOMSegBuffer = original; });

    it('after a successful parse', async () => {
      await parseSeg(readFixture('seg_overlap.dcm'), CT_IMAGE_IDS, 1e-2);
      expect(adapterImagesInCache()).toEqual([unrelated]);
    });

    it('after a failed parse', async () => {
      const arrayBuffer = rewrite(readFixture('seg_nonoverlap.dcm'), dataset => {
        dataset.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient = [1, 0, 0, 0, 0, -1];
      });
      await expect(parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2)).rejects.toThrow(/orthogonal/);
      expect(adapterImagesInCache()).toEqual([unrelated]);
    });
  });

  it('keeps the oblique error message the tolerance hint matches on', async () => {
    const arrayBuffer = rewrite(readFixture('seg_nonoverlap.dcm'), dataset => {
      dataset.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient = [0.8, 0.6, 0, -0.6, 0.8, 0];
    });

    await expect(parseSeg(arrayBuffer, CT_IMAGE_IDS, 1e-2)).rejects.toThrow(/oblique/);
  });

  it('parses a LABELMAP SEG, which the dcmjs loader cannot read', async () => {
    const reference = parseSegWithLegacyLoader(readFixture('seg_nonoverlap.dcm'), CT_IMAGE_IDS, 1e-2, metaData);

    const result = await parseSeg(readFixture('seg_labelmap.dcm'), CT_IMAGE_IDS, 1e-2);

    expect(result.parser).toBe('adapter');
    expect(new Uint16Array(result.labelmapBufferArray[0]))
      .toEqual(new Uint16Array(reference.labelmapBufferArray[0]));
    expect(result.segmentsOnFrameArray[0]).toEqual([[1], [1, 2], [2], [2]]);
    expect(adapterImagesInCache()).toEqual([]);
  });

  it('parses an RLE-compressed LABELMAP SEG', async () => {
    const reference = parseSegWithLegacyLoader(readFixture('seg_nonoverlap.dcm'), CT_IMAGE_IDS, 1e-2, metaData);

    const result = await parseSeg(readFixture('seg_labelmap_rle.dcm'), CT_IMAGE_IDS, 1e-2);

    expect(new Uint16Array(result.labelmapBufferArray[0]))
      .toEqual(new Uint16Array(reference.labelmapBufferArray[0]));
  });

  Object.entries(MULTIFRAME_ID_SCHEMES).forEach(([scheme, idFor]) => {
    it(`resolves frames of a multiframe reference through ${scheme} imageIds`, async () => {
      const imageIds = framePositions.map((position, frame) => idFor(frame));
      const reference = parseSegWithLegacyLoader(readFixture('seg_nonoverlap.dcm'), CT_IMAGE_IDS, 1e-2, metaData);

      const result = await parseSeg(readFixture('seg_multiframe_ref.dcm'), imageIds, 1e-2);

      expect(result.parser).toBe('adapter');
      expect(new Uint16Array(result.labelmapBufferArray[0]))
        .toEqual(new Uint16Array(reference.labelmapBufferArray[0]));
    });
  });
});

describe('parseSeg falls back to the dcmjs loader', () => {
  it('when a frame references an image outside the series, rather than never settling', async () => {
    // Without slice 0 the adapter's BINARY path would return from its chunk loop unresolved
    const imageIds = CT_IMAGE_IDS.slice(1);

    const result = await parseSeg(readFixture('seg_nonoverlap.dcm'), imageIds, 1e-2);

    expect(result.parser).toBe('legacy');
    expect(voxelsPerSegment(result.labelmapBufferArray[0])).toEqual({ 1: 9, 2: 27 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('reference images outside the series'));
  });

  it('when a segment number does not fit the adapter\'s 8-bit labelmap', () => {
    const dataset = naturalize(readFixture('seg_nonoverlap.dcm'));
    dataset.SegmentSequence[1].SegmentNumber = 300;

    expect(getLegacyParserReason(dataset, CT_IMAGE_IDS, metaData)).toMatch(/segment number 300/);
  });

  it('when the SEG has no FrameOfReferenceUID', () => {
    const dataset = naturalize(readFixture('seg_nonoverlap.dcm'));
    delete dataset.FrameOfReferenceUID;

    expect(getLegacyParserReason(dataset, CT_IMAGE_IDS, metaData)).toMatch(/FrameOfReferenceUID/);
  });

  it('when the referenced images have no Cornerstone3D instance metadata', () => {
    const dataset = naturalize(readFixture('seg_nonoverlap.dcm'));

    expect(getLegacyParserReason(dataset, ['dicomweb:unregistered'], metaData)).toMatch(/metadata/);
  });

  it('but not for a LABELMAP with segment numbers above 255, which neither loader reads', () => {
    const dataset = naturalize(readFixture('seg_labelmap.dcm'));
    dataset.SegmentSequence[1].SegmentNumber = 300;

    expect(() => getLegacyParserReason(dataset, CT_IMAGE_IDS, metaData)).toThrow(/LABELMAP/);
  });

  it('and accepts the fixtures the adapter handles', () => {
    ['seg_nonoverlap.dcm', 'seg_overlap.dcm', 'seg_labelmap.dcm'].forEach(name => {
      expect(getLegacyParserReason(naturalize(readFixture(name)), CT_IMAGE_IDS, metaData)).toBeNull();
    });
  });
});
