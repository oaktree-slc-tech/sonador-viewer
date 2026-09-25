import _ from 'lodash';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import {
  cache as c3dCache,
  eventTarget as c3dEventTarget,
  imageLoader as c3dImageLoader,
  volumeLoader as c3dVolumeLoader,
  utilities as c3dUtilities,
} from '@cornerstonejs/core';

import {
  Enums as c3dToolsEnums,
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import OHIF from '@ohif/core';

import {
  getSegmentsOnPixelData,
  invertLabelmapSliceMap,
} from './labelmapOrder.js';


// The labelmap bridge: Cornerstone3D owns the segmentation, this supplies the legacy view of it.
//
// The DURABLE segmentation lives in Cornerstone3D state, in a Cornerstone3D-supported backing
// form, for its whole life:
//
//   * `createCanonicalSegmentation` (the importer's one call) registers ONE logical segmentation
//     under the stable segmentationId, with `representationData.Labelmap.imageIds` naming a STACK
//     of per-slice local images in the Cornerstone3D image cache -- the CPU voxel store, `Uint8`,
//     in canonical slice order. The segmentation, its segment identity and its DICOM provenance
//     (on `cachedStats`, the library's extension point) are visible through
//     `segmentation.state` / `SegmentationService` from import until an explicit removal, whether
//     or not any viewport is open.
//   * `attachSegmentationDisplay` materialises the GL-facing side per viewing session: a
//     generation-numbered volume built over those SAME cached images
//     (`volumeLoader.createAndCacheVolumeFromImagesSync`), recorded as
//     `representationData.Labelmap.volumeId` -- the library's own stack->volume labelmap shape
//     (`internalConvertStackToVolumeLabelmap` does exactly this).
//   * `detachSegmentationDisplay` on the last view removes the viewport representations and the
//     volume (its vtkImageData and texture with it) and clears `volumeId`; the logical
//     segmentation, the stack images and every edit stay. Close/reopen therefore raises no
//     SEGMENTATION_ADDED / SEGMENTATION_REMOVED domain events.
//
// The classic 2D viewport, `SegmentationPanel` and the cornerstone-tools brush still need a legacy
// `labelmap3D`. The bridge derives one FROM the canonical Cornerstone3D data -- always a
// bridge-owned `Uint16` copy in stack order (the 8-bit store the renderer requires can never be
// viewed by the 16-bit legacy module) -- and carries changed slices in both directions.
//
// Ownership is explicit and single (AR-1): Cornerstone3D holds the one authoritative
// representation; the legacy object is a compatibility view, never a second record; and this
// module keeps only runtime wiring (event subscriptions, the legacy view, the display refcount).
// Only an explicit removal through `SegmentationService` / `segmentation.state.removeSegmentation`
// destroys a segmentation (FR-8).
//
// Direction reversed in the third amendment of #136, authorised in !87 note 37485; the durable
// stack-backed form replaces an interim bridge-private record after review finding !87 note 37598.

const segmentationModule = cornerstoneTools.getModule('segmentation');

const LABELMAP_MODIFIED = cornerstoneTools.EVENTS.LABELMAP_MODIFIED;

// The document-level events the dicom-segmentation extension uses to keep `SegmentationPanel` and
// the legacy segmentation module in step. They are plain DOM CustomEvents on `document` rather than
// imports, deliberately: the vtk extension and the dicom-segmentation extension do not depend on
// one another, and this keeps it that way.
//
//  - LABELMAP_STATE_MODIFIED is raised HERE, after a Cornerstone3D-side edit, to make an open
//    `SegmentationPanel` re-read the legacy state.
//  - METADATA_MODIFIED is raised by `SegmentationPanel` after it writes `activeSegmentIndex` or
//    `segmentsHidden` directly, which is the only notice the bridge gets of a panel-side change.
//
// LABELMAP_STATE_MODIFIED is deliberately NOT `extensiondicomsegmentationsegloaded`. That event
// means "a SEG finished loading" and carries a load payload (`segDisplaySet`, `segMetadata`,
// `labelmapBuffer`, ...); `dicom-segmentation`'s `index.js` subscribes to it and dereferences
// `detail.segDisplaySet`. Re-raising it for a refresh threw `can't access property
// "StudyInstanceUID", segDisplaySet is undefined` and took the panel down. A refresh is a different
// signal from a load and gets its own name.
const LEGACY_LABELMAP_STATE_EVENT = 'extensiondicomsegmentationlabelmapstatemodified';
const LEGACY_METADATA_MODIFIED_EVENT = 'extensiondicomsegmentationlabelmapmetadatamodified';

// Registrations, keyed by segmentationId. The segmentationId is the labelmapInstanceUID,
// `${firstImageId}_${labelmapIndex}` (AR-7), which is also how a legacy element event finds its
// registration: the element yields the firstImageId, the event yields the labelmapIndex.
const _registrations = new Map();

// One `registration` per segmentation, created at import and destroyed only by
// `removeCanonicalSegmentation`: the legacy-view bookkeeping, the event-subscription state, and the
// display materialisation for the current view session (`volume`, `displayVoxels`, `holders`).
// `holders` counts VIEWS only -- the importer takes no hold, which is what lets the count reach
// zero and the display state actually retire when a layout closes.

// Where the DICOM provenance lives on the Cornerstone3D segmentation. `Segmentation.cachedStats` and
// `Segment.cachedStats` are the library's own extension points, so this stays inside the record the
// service hands out.
const CANONICAL_FLAG = 'sonadorCanonicalSegmentation';
const SEG_METADATA_KEY = 'sonadorDicomSegMetadata';

// The reversible mapping from DICOM segment numbers to canonical Uint8 voxel values, stored with
// the provenance when a SEG declares segment numbers above 255 (see `planSegmentValueRemap`).
const SEGMENT_VALUE_MAP_KEY = 'sonadorSegmentValueMap';

// The Sonador-side identity and geometry of the canonical segmentation -- the legacy address
// (firstImageId, labelmapIndex), the display-set stack order, the colour LUT index and the volume
// geometry -- held on `cachedStats` so every read model derives from Cornerstone3D state alone.
const CANONICAL_INFO_KEY = 'sonadorCanonical';

// The display VOLUME is deliberately NOT permanent. An `ImageVolume` owns exactly one
// `vtkStreamingOpenGLTexture`, and `vtkOpenGLTexture.render()` reassigns its render window directly
// without releasing GL resources (vtk.js `Rendering/OpenGL/Texture.js`; the safe path,
// `setOpenGLRenderWindow`, is not the one `render()` takes). So a volume that survives the teardown
// of the WebGL context that first uploaded it carries a texture handle from a dead context into the
// next one -- `bindTexture: tex is from a different (or lost) WebGL context`, and a labelmap drawn
// from uninitialised texture memory. Each `attachSegmentationDisplay` therefore builds a
// generation-numbered volume over the durable stack images, and the last detach removes it; the
// logical segmentation and its stack never leave Cornerstone3D state.
//
// Durable stack images are pinned against LRU eviction with the cache's own `sharedCacheKey`
// protection (`decacheIfNecessaryUntilBytesAvailable` never evicts a stamped image). There is no
// public setter for the stamp, so the pin reaches into `cache._imageCache` behind a guard -- the
// same documented reach-in `_reclaimSharedCacheKeys` uses, pinned by
// `cache.sharedCacheKey.test.js`.
const DURABLE_PIN_PREFIX = 'sonadorseg-pin:';

// The imageId scheme for the durable per-slice stack images.
const DURABLE_IMAGE_SCHEME = 'sonadorseglabel:';

// Marks a Seg-Editor working segmentation: a distinct Cornerstone3D-owned copy forked from a
// canonical segmentation for an editor session (#136 fifth amendment, note 37810). Filtered from
// the SegmentationService roster; never bridged to the legacy view; save/export (#95) persists
// it as a NEW DICOM instance.
const EDITOR_COPY_OF_KEY = 'sonadorEditorWorkingCopyOf';

// Marks a segmentation that exists only in memory: created in the viewer (a blank segmentation,
// or 3D models voxelized onto a series; ohif-viewers#143) rather than loaded from a DICOM SEG.
// Value: { origin: 'blank' | 'models', createdAt }.
const IN_MEMORY_KEY = 'sonadorInMemory';

// One LABELMAP_MODIFIED listener per enabled element. The legacy event is an element event and
// cornerstone-core dispatches it without bubbling, so there is nowhere central to listen; elements
// come and go with the layout, hence the ELEMENT_ENABLED/ELEMENT_DISABLED subscriptions.
const _boundElements = new Map();

let _globalListeners = null;

// The concurrent-registration race that needed an in-flight promise map is gone with the ownership
// inversion: the canonical segmentation is created once by the importer, and installing a legacy
// view is synchronous, so two views arriving in the same tick cannot both create one.

// FR-7 asks for one log per SERIES. Keyed by `firstImageId` (the series key in the legacy module),
// not by segmentationId, which also carries the labelmap index -- two labelmaps on one series would
// otherwise each log. Never cleared: the point is one line per series per session, so re-opening the
// same series does not repeat it.
const _fallbackLoggedSeries = new Set();


export function canonicalScalarTypeFor() {
  // The canonical labelmap's voxel store is ALWAYS `Uint8Array`, because that is the only thing
  // Cornerstone3D's labelmap rendering can display.
  //
  // `labelmapDisplay.js` builds its colour transfer function with
  // `cfun.addRGBPoint(segmentIndex, ...)` -- it maps the RAW scalar the texture delivers to a
  // colour -- and `vtkStreamingOpenGLTexture.updateVolumeInfoForGL` forces
  // `dataComputedScale = [1]` / `dataComputedOffset = [0]`, so no rescaling happens on the way in.
  // The shader therefore has to receive the literal integer 1, 2, 3.
  //
  // Only an 8-bit texture does that:
  //   * `Uint8Array`  -> R8, integers preserved. Correct.
  //   * `Uint16Array` with `EXT_texture_norm16` -> R16_SNORM, values normalised into [-1, 1], so
  //     segment 1 reaches the shader as ~0.00003 and the lookup lands on background. The
  //     segmentation is invisible.
  //   * `Uint16Array` without norm16 -> converted to R32F with the same scale-1 assumption, which
  //     also does not deliver the index, and costs four bytes per voxel besides.
  //
  // This is why Cornerstone3D's own `createAndCacheDerivedLabelmapVolume` hard-defaults its
  // `targetBuffer.type` to `Uint8Array`.
  //
  // The consequence is that the legacy `labelmap3D` can never view this memory: the
  // cornerstone-tools segmentation module builds its per-slice views as `new Uint16Array(buffer,
  // ...)` and has no other layout. #136 FR-1's "no pixel copy" is therefore not achievable in
  // either ownership direction, and the legacy view is always a bridge-owned copy (FR-7). Raised on
  // the MR; segment indices do not reach 256, so nothing is lost but the sharing.

  return Uint8Array;
}


function _isLazyLegacyInstall() {
  // When true, the legacy `labelmap3D` is NOT built at import; a caller that actually needs it asks
  // through `ensureLegacyLabelmapView`. Default false, deliberately: in today's UI a SEG import is
  // triggered by the user selecting the SEG for display in the CLASSIC viewport, so a legacy
  // consumer exists at import time in practice, and skipping the install would show them nothing.
  // The flag exists for deployments past #92 / the classic-viewport sunset, where volumetric views
  // (which no longer read legacy state) can be the only consumers -- that is where the 2 B/voxel
  // idle saving actually materialises.

  const config = OHIF?.utils?.cornerstone3dUtils?.getCornerstone3dConfig
    ? OHIF.utils.cornerstone3dUtils.getCornerstone3dConfig()
    : {};

  return config.lazyLegacyLabelmap === true;
}


export function ensureLegacyLabelmapView(segmentationId) {
  // Build and install the legacy compatibility view if it does not exist yet. The trigger for lazy
  // deployments; a no-op everywhere else.
  //
  // Never for a Seg-Editor working copy: it is Cornerstone3D-only by contract (V-2), and its
  // provenance retains the SOURCE's (firstImageId, labelmapIndex) address -- an install would
  // replace the source's legacy slot and open an editor->legacy route.

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  if (((segmentation && segmentation.cachedStats) || {})[EDITOR_COPY_OF_KEY]) {
    return false;
  }

  const registration = _ensureRegistration(segmentationId);
  if (!registration) {
    return false;
  }

  if (!registration.labelmap3D) {
    _installLegacyView(registration);
  }

  return true;
}


export function getCanonicalSegmentationsForSeries(firstImageId) {
  // Every canonical segmentation on a series, for the volumetric viewports -- which read
  // Cornerstone3D state rather than the legacy module for identity, so the legacy view can one day
  // be lazy (#92). Derived entirely from `segmentation.state`; the bridge keeps no roster of its
  // own.

  return _.filter(
    _.map(c3dSegmentations.state.getSegmentations() || [], (segmentation) => {
      const cachedStats = segmentation.cachedStats || {};
      const info = cachedStats[CANONICAL_INFO_KEY];
      // A Seg-Editor working copy carries the same provenance record (it is a full copy) but is
      // session state, never part of the series roster the viewports and the importer consult.
      return info && info.firstImageId === firstImageId && !cachedStats[EDITOR_COPY_OF_KEY]
        ? getCanonicalSegmentation(segmentation.segmentationId)
        : undefined;
    }),
    Boolean);
}


function _durableImageId(segmentationId, sliceIndex) {
  return `${DURABLE_IMAGE_SCHEME}${segmentationId}:${sliceIndex}`;
}


function _setDurableImagePins(imageIds, segmentationId, pinned) {
  // Stamp (or clear) the cache's eviction protection on the durable stack images. The stamp is a
  // volume-shaped key; `_decacheVolume` clears only stamps matching ITS volumeId, so the pin
  // survives display-volume teardown -- but `putVolumeSync` overwrites stamps when a display
  // generation is put, so the retire path re-pins unconditionally.

  const pinKey = `${DURABLE_PIN_PREFIX}${segmentationId}`;
  const imageCache = c3dCache._imageCache;
  if (!imageCache || typeof imageCache.get !== 'function') {
    return;
  }

  _.each(imageIds, (imageId) => {
    const cachedImage = imageCache.get(imageId);
    if (!cachedImage) {
      return;
    }
    if (pinned) {
      cachedImage.sharedCacheKey = pinKey;
    } else if (cachedImage.sharedCacheKey === pinKey) {
      cachedImage.sharedCacheKey = undefined;
    }
  });
}


function _rollbackStackImages(segmentationId, imageIds) {
  // Remove a set of stack images this module admitted and pinned: the pin comes off first,
  // because the pinned 4.22.13 cache REFUSES `removeImageLoadObject` for an image carrying a
  // `sharedCacheKey` (`_decacheImage`: "Cannot decache an image with a shared cache key").

  _setDurableImagePins(imageIds || [], segmentationId, false);
  _.each(imageIds || [], (imageId) => {
    try {
      if (c3dCache.getImageLoadObject(imageId)) {
        c3dCache.removeImageLoadObject(imageId);
      }
    } catch (error) {
      console.warn(`[vtk:labelmapBridge] rollback: failed to remove ${imageId}:`, error);
    }
  });
}


function _replacementStackIds(segmentationId, currentImageIds, slices) {
  // Generation-numbered ids for a REPLACEMENT stack (`...:r<N>:<slice>`), so a rebuilt stack
  // never collides with the published one -- the replacement is fully admitted and verified
  // before anything commits, and the previous stack is never touched on failure.

  let next = 1;
  _.each(currentImageIds || [], (imageId) => {
    const match = /:r(\d+):/.exec(imageId);
    if (match) {
      next = Math.max(next, Number(match[1]) + 1);
    }
  });

  const ids = [];
  for (let i = 0; i < slices; i++) {
    ids.push(`${DURABLE_IMAGE_SCHEME}${segmentationId}:r${next}:${i}`);
  }
  return ids;
}


function _registerDurableStackImages({
  segmentationId, scalarData, dimensions, spacing, origin, direction, metadata, slices, sliceLength,
  journal, imageIds: explicitImageIds,
}) {
  // Create the durable per-slice images the canonical stack labelmap is backed by. Each image's
  // pixel data is a `subarray` of the one canonical array (exactly as `createLocalVolume` lays a
  // volume out), and `createAndCacheLocalImage` registers `imagePlaneModule` / `imagePixelModule`
  // for the id itself -- so `generateVolumePropsFromImageIds` can rebuild the volume geometry from
  // library metadata alone. `generalSeriesModule` is the one module it needs that the library does
  // not self-register (`makeVolumeMetadata` destructures it unguarded).
  //
  // Admission is TRANSACTIONAL in three respects. The whole decoded footprint is pre-flighted
  // against the cache limit before anything is admitted. Each image is pinned THE MOMENT it is
  // admitted -- `putImageSync` runs `decacheIfNecessaryUntilBytesAvailable`, so a later admission
  // under cache pressure could otherwise evict an earlier, still-unpinned slice, and these ids
  // have no loader to bring one back. And the complete stack is verified present before the
  // caller may publish the segmentation; the caller rolls the admissions back on any failure.

  // @input journal (str[]): CALLER-OWNED admission journal. Every id this call admits is pushed
  //   into it synchronously, BEFORE anything that can throw runs next -- so the caller's rollback
  //   sees the full admission set even when this helper itself is what threw.
  // @returns the complete ordered imageId list

  const totalBytes = sliceLength * slices;
  if (_.isFunction(c3dCache.isCacheable) && !c3dCache.isCacheable(totalBytes)) {
    throw new Error(
      `[vtk:labelmapBridge] the labelmap stack for ${segmentationId} (${totalBytes} bytes) does `
      + 'not fit the Cornerstone3D cache; raise cornerstone3d.maxCacheSizeBytes or reduce the '
      + 'series');
  }

  const normal = direction.slice(6, 9);
  const zSpacing = spacing[2];
  const imageIds = [];

  for (let i = 0; i < slices; i++) {
    const imageId = explicitImageIds ? explicitImageIds[i] : _durableImageId(segmentationId, i);
    imageIds.push(imageId);

    if (c3dCache.getImageLoadObject(imageId)) {
      _setDurableImagePins([imageId], segmentationId, true);
      continue;
    }

    const sliceOrigin = [
      origin[0] + i * zSpacing * normal[0],
      origin[1] + i * zSpacing * normal[1],
      origin[2] + i * zSpacing * normal[2],
    ];

    c3dImageLoader.createAndCacheLocalImage(imageId, {
      scalarData: scalarData.subarray(i * sliceLength, (i + 1) * sliceLength),
      dimensions: [dimensions[0], dimensions[1]],
      spacing: [spacing[0], spacing[1]],
      origin: sliceOrigin,
      direction,
      frameOfReferenceUID: metadata && metadata.FrameOfReferenceUID,
      targetBuffer: { type: 'Uint8Array' },
    });
    if (journal) {
      journal.push(imageId);
    }
    _setDurableImagePins([imageId], segmentationId, true);

    c3dUtilities.genericMetadataProvider.add(imageId, {
      type: 'generalSeriesModule',
      metadata: {
        modality: 'SEG',
        seriesInstanceUID: (metadata && metadata.SeriesInstanceUID) || segmentationId,
      },
    });
  }

  const missing = _.filter(imageIds, (imageId) => !c3dCache.getImageLoadObject(imageId));
  if (missing.length) {
    throw new Error(
      `[vtk:labelmapBridge] the labelmap stack for ${segmentationId} is incomplete after `
      + `admission: ${missing.length} of ${imageIds.length} slices missing (first: ${missing[0]})`);
  }

  return imageIds;
}


function _rollbackCanonicalCreation(segmentationId, createdImageIds) {
  // Undo a failed import so a retry starts clean: the published state entry, if any, and the
  // images THIS attempt admitted, with their pins. Images that already existed before the attempt
  // are left alone. `genericMetadataProvider` has no per-id removal; stale plane/pixel entries
  // for these ids are inert and overwritten by a retry.

  try {
    if (c3dSegmentations.state.getSegmentation(segmentationId)) {
      c3dSegmentations.state.removeSegmentation(segmentationId);
    }
  } catch (error) {
    console.warn(`[vtk:labelmapBridge] rollback: failed to remove ${segmentationId}:`, error);
  }

  _rollbackStackImages(segmentationId, createdImageIds);
}


function _assembleScalarDataFromImages(imageIds, sliceLength, slices) {
  // The flat canonical array, recovered from the cached stack images. The images were created as
  // subarrays of one allocation, so the common case is a zero-copy alias over their shared
  // buffer; a foreign layout falls back to a copy (the caller re-backs the images onto it so
  // writes still reach the cache).

  // @returns { scalarData, contiguous } or undefined when any slice is missing

  const pixels = [];
  for (let i = 0; i < imageIds.length; i++) {
    const image = c3dCache.getImage(imageIds[i]);
    const pixelData = image
      && (image.voxelManager ? image.voxelManager.getScalarData() : image.getPixelData());
    if (!pixelData) {
      return undefined;
    }
    pixels.push(pixelData);
  }

  const buffer = pixels[0].buffer;
  const contiguous = pixels[0].byteOffset === 0
    && buffer.byteLength === sliceLength * slices
    && _.every(pixels, (pixelData, i) =>
      pixelData.buffer === buffer && pixelData.byteOffset === i * sliceLength);

  if (contiguous) {
    return { scalarData: new Uint8Array(buffer), contiguous: true, pixels };
  }

  const scalarData = new Uint8Array(sliceLength * slices);
  _.each(pixels, (pixelData, i) => {
    scalarData.set(pixelData.subarray(0, sliceLength), i * sliceLength);
  });
  return { scalarData, contiguous: false, pixels };
}


function _reconstructRegistration(segmentationId) {
  // Rebuild the runtime wiring for a canonical segmentation from Cornerstone3D state and the
  // image cache alone -- what makes `_registrations` a rebuildable cache rather than mandatory
  // process-lifetime state. Everything needed is on the segmentation entry: the stack imageIds on
  // `representationData.Labelmap`, the identity/geometry on `cachedStats.sonadorCanonical`, the
  // segment metadata and value map beside them.

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  const cachedStats = (segmentation && segmentation.cachedStats) || {};
  const info = cachedStats[CANONICAL_INFO_KEY];
  // A Seg-Editor working copy reconstructs the same way -- its provenance and stack live on its
  // own Cornerstone3D entry, so `_registrations` is a rebuildable cache for it too -- but it is
  // recognised by its own flag and never treated as canonical.
  if (!segmentation || !(cachedStats[CANONICAL_FLAG] || cachedStats[EDITOR_COPY_OF_KEY])
      || !info || !info.dimensions) {
    return undefined;
  }

  const labelmapData = (segmentation.representationData || {})[
    c3dToolsEnums.SegmentationRepresentations.Labelmap] || {};
  let stackVolumeImageIds = labelmapData.imageIds || [];
  const [columns, rows, slices] = info.dimensions;
  const sliceLength = columns * rows;

  if (!stackVolumeImageIds.length || stackVolumeImageIds.length !== slices) {
    console.warn(
      `[vtk:labelmapBridge] cannot reconstruct ${segmentationId}: the stack names `
      + `${stackVolumeImageIds.length} images for ${slices} slices`);
    return undefined;
  }

  const metadata = {
    FrameOfReferenceUID: info.frameOfReferenceUID,
    SeriesInstanceUID: info.seriesInstanceUID,
  };

  let assembled = _assembleScalarDataFromImages(stackVolumeImageIds, sliceLength, slices);
  if (!assembled) {
    console.warn(
      `[vtk:labelmapBridge] cannot reconstruct ${segmentationId}: stack images are missing from `
      + 'the cache');
    return undefined;
  }

  if (!assembled.contiguous) {
    // A foreign per-slice layout: rebuild over one contiguous array so writes through the
    // canonical array reach cache-held pixels again. FAIL-CLOSED, never destructive: the
    // replacement stack is admitted and verified under fresh generation-numbered ids
    // (`...:r<N>:<slice>`), the representation data commits through the supported state route
    // only once the replacement is complete, and the previous stack is retired last -- a failure
    // at any point leaves the published segmentation exactly as it was.
    const previousIds = [...stackVolumeImageIds];
    const replacementIds = _replacementStackIds(segmentationId, previousIds, slices);
    const journal = [];

    try {
      _registerDurableStackImages({
        segmentationId, scalarData: assembled.scalarData,
        dimensions: info.dimensions, spacing: info.spacing, origin: info.origin,
        direction: info.direction, metadata, slices, sliceLength,
        journal, imageIds: replacementIds,
      });
    } catch (error) {
      _rollbackStackImages(segmentationId, journal);
      console.warn(
        `[vtk:labelmapBridge] cannot reconstruct ${segmentationId}: replacement-stack admission `
        + 'failed; the published stack is untouched:', error);
      return undefined;
    }

    // Commit: the supported representation-data route (state-managed, SEGMENTATION_MODIFIED for
    // this id -- the bridge holds no registration yet, so its own listener ignores the event).
    c3dSegmentations.updateSegmentations([{
      segmentationId,
      payload: {
        representationData: {
          ...(segmentation.representationData || {}),
          [c3dToolsEnums.SegmentationRepresentations.Labelmap]: {
            ...labelmapData,
            imageIds: replacementIds,
          },
        },
      },
    }]);
    stackVolumeImageIds = replacementIds;

    // Retire the previous stack, unpin-then-remove. A remove refused here (a stamp some other
    // volume owns) leaves an unpinned image for the LRU -- a leak at worst, never a broken
    // published state.
    _setDurableImagePins(previousIds, segmentationId, false);
    _.each(previousIds, (imageId) => {
      try {
        if (c3dCache.getImageLoadObject(imageId)) {
          c3dCache.removeImageLoadObject(imageId);
        }
      } catch (error) {
        console.warn(
          `[vtk:labelmapBridge] could not retire replaced stack image ${imageId}:`, error);
      }
    });
  } else {
    _setDurableImagePins(stackVolumeImageIds, segmentationId, true);
  }

  const registration = {
    segmentationId,
    firstImageId: info.firstImageId,
    labelmapIndex: info.labelmapIndex,
    stackImageIds: [...(info.stackImageIds || [])],
    canonicalImageIds: labelmapData.referencedImageIds || info.canonicalImageIds,
    stackVolumeImageIds: [...stackVolumeImageIds],
    slices,
    sliceLength,
    dimensions: info.dimensions,
    spacing: info.spacing,
    origin: info.origin,
    direction: info.direction,
    metadata,
    segMetadata: cachedStats[SEG_METADATA_KEY],
    colorLUTIndex: info.colorLUTIndex || 0,
    referencedVolumeId: info.referencedVolumeId,
    scalarData: assembled.scalarData,
    shared: false,
    volume: null,
    holders: 0,
    generation: 0,
    retiring: false,
    derivedDisplays: new Map(),
    labelmap3D: null,
    buffer: null,
    sliceMap: null,
    inverseMap: null,
    marks: [],
    inBridge: false,
    serviceSubscriptions: [],
    knownSegments: new Set(_.map(
      _.filter(_.values(segmentation.segments || {}), Boolean),
      (segment) => segment.segmentIndex)),
  };

  _registrations.set(segmentationId, registration);
  _ensureGlobalListeners();

  // Never for a working copy: it is Cornerstone3D-only by contract, and installing a legacy view
  // at the source's (firstImageId, labelmapIndex) address would collide with the source's own.
  if (!cachedStats[EDITOR_COPY_OF_KEY]
      && !_isLazyLegacyInstall()
      && !(segmentationModule.state.series[registration.firstImageId]
        && segmentationModule.state.series[registration.firstImageId]
          .labelmaps3D[registration.labelmapIndex])) {
    _installLegacyView(registration);
  }

  return registration;
}


function _ensureRegistration(segmentationId) {
  return _registrations.get(segmentationId) || _reconstructRegistration(segmentationId);
}


export function getCanonicalSegmentation(segmentationId) {
  // Read the primary record for a segmentation. NON-materialising: this creates nothing, so a read
  // after the last view has detached cannot resurrect display state behind the lifecycle's back.
  //
  // `volume` is the CURRENT display generation, or undefined when no view is attached -- which is a
  // normal state, not an error. `scalarData` is the primary copy, kept current by the sync paths.

  // @returns { segmentationId, segmentation, volume, scalarData, canonicalImageIds, dimensions,
  //   sliceLength, slices, segMetadata, referencedVolumeId } or undefined

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  const cachedStats = (segmentation && segmentation.cachedStats) || {};
  const info = cachedStats[CANONICAL_INFO_KEY];
  if (!segmentation || !info) {
    return undefined;
  }

  const registration = _ensureRegistration(segmentationId);
  const labelmapData = (segmentation.representationData || {})[
    c3dToolsEnums.SegmentationRepresentations.Labelmap] || {};

  return {
    segmentationId,
    segmentation,
    volume: registration ? registration.volume : undefined,

    // The canonical voxels: the flat array the durable stack images subarray. Present for the
    // segmentation's whole life -- the CPU store is the cache-held stack, not display state.
    scalarData: registration ? registration.scalarData : undefined,
    canonicalImageIds: labelmapData.referencedImageIds || info.canonicalImageIds,
    dimensions: info.dimensions,
    sliceLength: info.dimensions ? info.dimensions[0] * info.dimensions[1] : undefined,
    slices: info.dimensions ? info.dimensions[2] : undefined,
    segMetadata: cachedStats[SEG_METADATA_KEY],
    referencedVolumeId: info.referencedVolumeId || labelmapData.referencedVolumeId,

    // The legacy address and colour LUT, so consumers need no string surgery on the id.
    firstImageId: info.firstImageId,
    labelmapIndex: info.labelmapIndex,
    colorLUTIndex: info.colorLUTIndex,
  };
}


export function getSegmentationVoxels(segmentationId) {
  // The segmentation's voxels: the flat canonical array the durable stack images subarray. For
  // serializers and other whole-volume readers; slice-scoped paths use the same array inside the
  // bridge. Reconstructs the runtime wiring from Cornerstone3D state when this module has none.

  const registration = _ensureRegistration(segmentationId);
  return registration ? registration.scalarData : undefined;
}


export function isCanonicalSegmentation(segmentationId) {
  // True for a segmentation this viewer owns as canonical state, as opposed to a derived or
  // disposable one (the editor's `vol3d:`, anything a viewport built for itself).
  //
  // The flag lives on the Cornerstone3D segmentation, not in this module, so code that must not
  // destroy canonical state -- `volumeLease.release`, the 3D viewer's reset -- can check it without
  // importing the bridge.

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  return !!(segmentation && (segmentation.cachedStats || {})[CANONICAL_FLAG]);
}


export function createCanonicalSegmentation(params) {
  // The importer's entry point, and the origin of a segmentation in this viewer.
  //
  // Registers the DURABLE Cornerstone3D segmentation: the `Uint8` reference voxels as a stack of
  // per-slice local images in the Cornerstone3D image cache (`representationData.Labelmap.imageIds`
  // -- the library's stack labelmap form), the segment identity, and the DICOM provenance on
  // `cachedStats`. The segmentation is visible through `segmentation.state` /
  // `SegmentationService` from this call until an explicit removal; no viewport is involved.
  //
  // Deliberately creates NO display state and takes NO display hold: display materialisation
  // belongs to views (`attachSegmentationDisplay`), is reference counted by them alone, and is
  // retired completely when the last of them goes. That separation is the fix for a defect that
  // defeated three earlier attempts at this lifecycle: the importer previously took a hold it
  // never released, so the view refcount could never reach zero, no teardown ever ran, and the
  // second open of a series inherited a volume, texture, representations and colour LUT belonging
  // to a WebGL context that had been destroyed.

  // @input params.segmentationId (str): the id every consumer addresses this segmentation by
  // @input params.imageIds (str[]): the referenced series' imageIds, in the order the SEG was
  //   parsed against (the stack order)
  // @input params.labelmapBuffer (ArrayBuffer|TypedArray): the parsed labelmap, in that same order
  // @input params.segMetadata (object): the dcmjs segment metadata, carried for legacy consumers
  // @input params.segmentValueMap (object): ORIGINAL segment number -> canonical Uint8 value, from
  //   `planSegmentValueRemap`; identity when absent. Stored with the provenance (FR-5).
  // @input params.layerSegments (num[]): the segment numbers present on THIS labelmap layer; an
  //   overlapping SEG imports one layer per call, and each layer's segmentation must carry only
  //   its own membership
  // @input params.firstImageId (str): the legacy series key (`state.series[firstImageId]`)
  // @input params.labelmapIndex (num): the slot within that series
  // @input params.colorLUTIndex (num): the legacy colour LUT index for this labelmap
  // @input params.referencedVolumeId (str): the image volume id, when one is already known
  // @input params.label (str): the segmentation's name, for segmentations created in the viewer
  // @returns the canonical read-model (see `getCanonicalSegmentation`)

  const {
    segmentationId, imageIds, labelmapBuffer, segMetadata, segmentValueMap, layerSegments,
    firstImageId, labelmapIndex, colorLUTIndex, referencedVolumeId, label,
  } = params;

  if (_registrations.has(segmentationId)
      || c3dSegmentations.state.getSegmentation(segmentationId)) {
    // Idempotent: an existing registration answers directly; a state entry without one (an
    // earlier process, or a lost runtime map) is reconstructed by the read model below rather
    // than short-circuiting to a half-usable segmentation.
    return getCanonicalSegmentation(segmentationId);
  }

  const props = c3dUtilities.generateVolumePropsFromImageIds(imageIds, segmentationId);
  const { dimensions, spacing, origin, direction, metadata } = props;

  // `sortedImageIds` is the canonical slice order -- the order the reference image volume is also
  // in, because the streaming loader sorts by position with the same helper.
  const canonicalImageIds = props.imageIds;
  const [columns, rows, slices] = dimensions;
  const sliceLength = columns * rows;

  // The canonical voxels. `Uint8Array` because that is the only format Cornerstone3D's labelmap
  // renderer can display (see `canonicalScalarTypeFor`); segment numbers above 255 are remapped
  // explicitly through `segmentValueMap`, never narrowed silently.
  const ScalarType = canonicalScalarTypeFor();
  const scalarData = new ScalarType(sliceLength * slices);
  _seedCanonicalVoxels({
    scalarData, sliceLength, slices, labelmapBuffer, imageIds, canonicalImageIds,
    segmentValueMap, segmentationId,
  });

  // The durable CPU form: per-slice images in the Cornerstone3D image cache, pinned against LRU
  // eviction, each a subarray of `scalarData`. Everything from here to the end of the function is
  // one transaction: any failure rolls the admissions and any published state back, so a retry
  // starts from nothing rather than from a partial import.
  let stackVolumeImageIds;
  const createdImageIds = [];
  try {
    stackVolumeImageIds = _registerDurableStackImages({
      segmentationId, scalarData, dimensions, spacing, origin, direction, metadata,
      slices, sliceLength, journal: createdImageIds,
    });

    // The logical segmentation, registered ONCE, in the library's stack labelmap form. Everything a
    // serializer needs is reachable from here through `segmentationId` alone.
    c3dSegmentations.state.addSegmentations([{
      segmentationId,
      representation: {
        type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
        data: {
          imageIds: stackVolumeImageIds,

          // The source series, in canonical slice order: what a serializer needs for per-frame
          // source-image references, and what the order check runs against.
          referencedImageIds: canonicalImageIds,

          // Both spellings: this viewer reads `referenceVolumeId`, Cornerstone3D's own
          // `LabelmapSegmentationData` names it `referencedVolumeId`.
          referenceVolumeId: referencedVolumeId,
          referencedVolumeId: referencedVolumeId,
        },
      },
      config: {
        ..._canonicalSegmentConfig(segMetadata, layerSegments, segmentValueMap),
        ...(label ? { label } : {}),
      },
    }]);

    _writeCanonicalProvenance(segmentationId, segMetadata, {
      segmentValueMap,
      info: {
        firstImageId,
        labelmapIndex,
        colorLUTIndex: colorLUTIndex || 0,
        stackImageIds: [...imageIds],
        canonicalImageIds,
        dimensions,
        spacing,
        origin,
        direction,
        referencedVolumeId,

        // What a reconstruction needs to re-admit the stack images, should the runtime wiring ever
        // have to be rebuilt from Cornerstone3D state alone.
        frameOfReferenceUID: metadata && metadata.FrameOfReferenceUID,
        seriesInstanceUID: metadata && metadata.SeriesInstanceUID,
      },
    });

    const registration = {
      segmentationId,
      firstImageId,
      labelmapIndex,
      stackImageIds: [...imageIds],
      canonicalImageIds,
      stackVolumeImageIds,
      slices,
      sliceLength,
      dimensions,
      spacing,
      origin,
      direction,
      metadata,
      segMetadata,
      colorLUTIndex: colorLUTIndex || 0,
      referencedVolumeId,

      // Runtime wiring only. The durable state -- voxels, identity, provenance -- lives in
      // Cornerstone3D; `scalarData` here is a convenience reference to the same array the cached
      // stack images subarray, recoverable from the cache if this module restarted.
      scalarData,

      // The legacy view can never share memory with the canonical store (8-bit vs the 16-bit layout
      // the legacy module requires), so it is always a bridge-owned copy kept in step by events.
      shared: false,

      // Display materialisation state. `holders` counts VIEWS only; `generation` numbers the display
      // volumeIds so nothing keyed by a previous session's ids can be resurrected by accident.
      volume: null,
      holders: 0,
      generation: 0,
      retiring: false,

      // Per-view DERIVED displays (the lightbox/inspection modal renders in its own rendering
      // engine, so it needs a volume -- and therefore a segmentation entry -- of its own; a
      // Cornerstone3D volume owns exactly one GL texture). Keyed by the derived segmentationId;
      // each entry is { volume, holders, generation }.
      derivedDisplays: new Map(),

      labelmap3D: null,
      buffer: null,
      sliceMap: null,
      inverseMap: null,
      marks: [],
      inBridge: false,
      serviceSubscriptions: [],
      knownSegments: new Set(),
    };

    if (!_isLazyLegacyInstall()) {
      _installLegacyView(registration);
    }

    _registrations.set(segmentationId, registration);
    _ensureGlobalListeners();

    const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
    registration.knownSegments = new Set(_.map(
      _.filter(_.values((segmentation && segmentation.segments) || {}), Boolean),
      (segment) => segment.segmentIndex));
  } catch (error) {
    _rollbackCanonicalCreation(segmentationId, createdImageIds);
    throw error;
  }

  return getCanonicalSegmentation(segmentationId);
}


export function forkSegmentationForEditor(sourceSegmentationId, options) {
  // Create the Seg-Editor's WORKING SEGMENTATION: a distinct Cornerstone3D-owned copy of a
  // canonical segmentation, initialised ONE WAY from a snapshot of the source voxels and segment
  // identity at this moment (#136 fifth amendment, note 37810 -- "editing" creates a copy; the
  // editor must not modify a PACS-parsed segmentation in place, and editor changes must not
  // propagate to other views).
  //
  // Isolation is structural, not policed: the working copy has its own voxel allocation, its own
  // stack images, its own segmentation entry and its own registration. It carries the full
  // provenance record on its own entry -- deep-cloned SEG metadata, the segment-value map and
  // the identity/geometry record, everything the #95 serializer needs -- but never the canonical
  // flag: the series roster excludes it, reconstruction rebuilds it as a working copy, and no
  // legacy view is ever installed for it (`ensureLegacyLabelmapView` refuses it), so no legacy
  // event can reach it and none of its events reach the legacy module; and no source<->copy
  // event route exists in either direction. Everything display-side (attach/detach, generations,
  // derived displays) works on it exactly as on a canonical segmentation.
  //
  // A leftover copy from a previous session under the same id is removed first -- every editor
  // session starts from a fresh snapshot of the source.

  // @input options.workingSegmentationId (str): override the `<sourceId>::edit` default
  // @returns { workingSegmentationId, sourceSegmentationId } or undefined when the source is
  //   unknown

  options = options || {};

  const source = _ensureRegistration(sourceSegmentationId);
  if (!source) {
    console.warn(
      `[vtk:labelmapBridge] forkSegmentationForEditor: no canonical segmentation for `
      + `${sourceSegmentationId}.`);
    return undefined;
  }

  const workingSegmentationId =
    options.workingSegmentationId || `${sourceSegmentationId}::edit`;

  if (_registrations.has(workingSegmentationId)
      || c3dSegmentations.state.getSegmentation(workingSegmentationId)) {
    removeCanonicalSegmentation(workingSegmentationId);
  }

  // The one-time snapshot: a fresh allocation, never an alias of the source.
  const scalarData = new Uint8Array(source.scalarData);

  const createdImageIds = [];
  let stackVolumeImageIds;
  try {
    stackVolumeImageIds = _registerDurableStackImages({
      segmentationId: workingSegmentationId, scalarData,
      dimensions: source.dimensions, spacing: source.spacing, origin: source.origin,
      direction: source.direction, metadata: source.metadata,
      slices: source.slices, sliceLength: source.sliceLength,
      journal: createdImageIds,
    });

    // Segment identity snapshotted from the source segmentation entry. Deep clones: a segment
    // carries nested state (its `cachedStats.dicom` coded entry above all), and an editor-side
    // metadata change must not be able to reach the source through a shared reference.
    const sourceSegmentation = c3dSegmentations.state.getSegmentation(sourceSegmentationId);
    const sourceCachedStats = (sourceSegmentation && sourceSegmentation.cachedStats) || {};
    const segments = {};
    _.each(_.values((sourceSegmentation && sourceSegmentation.segments) || {}), (segment) => {
      if (segment) {
        segments[segment.segmentIndex] = _.cloneDeep(segment);
      }
    });

    // The working copy's own DICOM provenance: the deep-cloned SEG metadata (the source's dcmjs
    // object also backs the SOURCE's legacy view), shared between the working entry's cachedStats
    // and the registration exactly as an import shares them.
    const workingSegMetadata = _.cloneDeep(source.segMetadata);
    const sourceInfo = sourceCachedStats[CANONICAL_INFO_KEY];
    const workingInfo = sourceInfo ? _.cloneDeep(sourceInfo) : undefined;
    if (workingInfo && options.referencedVolumeId) {
      workingInfo.referencedVolumeId = options.referencedVolumeId;
    }

    c3dSegmentations.state.addSegmentations([{
      segmentationId: workingSegmentationId,
      representation: {
        type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
        data: {
          imageIds: stackVolumeImageIds,
          referencedImageIds: source.canonicalImageIds,
          referenceVolumeId: options.referencedVolumeId,
          referencedVolumeId: options.referencedVolumeId,
        },
      },
      config: {
        ...(_.size(segments) ? { segments } : {}),
        // The source's name, when it has one (segmentations created in the viewer are named)
        label: c3dSegmentations.state.getSegmentation(sourceSegmentationId)?.label ?? undefined,
        cachedStats: { [EDITOR_COPY_OF_KEY]: sourceSegmentationId },
      },
    }]);

    // The full FR-5 record on the WORKING Cornerstone3D entry -- source references, geometry,
    // DICOM provenance and the reversible segment-value map -- so the state the editor operates
    // on is sufficient for #95's serializer by itself, and `_registrations` stays a rebuildable
    // cache rather than the only holder of the copy's SEG metadata. Re-points each cloned
    // segment's `cachedStats.dicom` at the working copy's own metadata entries.
    _writeCanonicalProvenance(workingSegmentationId, workingSegMetadata, {
      workingCopyOf: sourceSegmentationId,
      segmentValueMap: sourceCachedStats[SEGMENT_VALUE_MAP_KEY],
      ...(workingInfo ? { info: workingInfo } : {}),
    });

    const registration = {
      segmentationId: workingSegmentationId,
      firstImageId: source.firstImageId,
      labelmapIndex: source.labelmapIndex,
      stackImageIds: [...source.stackImageIds],
      canonicalImageIds: source.canonicalImageIds,
      stackVolumeImageIds,
      slices: source.slices,
      sliceLength: source.sliceLength,
      dimensions: source.dimensions,
      spacing: source.spacing,
      origin: source.origin,
      direction: source.direction,
      metadata: source.metadata,

      segMetadata: workingSegMetadata,

      colorLUTIndex: source.colorLUTIndex,
      referencedVolumeId: options.referencedVolumeId,
      scalarData,
      shared: false,
      volume: null,
      holders: 0,
      generation: 0,
      retiring: false,
      derivedDisplays: new Map(),

      // Never a legacy view: the working copy is Cornerstone3D-only by contract.
      labelmap3D: null,
      buffer: null,
      sliceMap: null,
      inverseMap: null,
      marks: [],
      inBridge: false,
      serviceSubscriptions: [],
      knownSegments: new Set(_.map(_.values(segments), (segment) => segment.segmentIndex)),
    };
    _registrations.set(workingSegmentationId, registration);
    _ensureGlobalListeners();
  } catch (error) {
    _rollbackCanonicalCreation(workingSegmentationId, createdImageIds);
    throw error;
  }

  return { workingSegmentationId, sourceSegmentationId };
}


export function releaseEditorWorkingCopy(workingSegmentationId) {
  // Close the editor session's working segmentation: displays, state entry, stack images and
  // wiring all go; the SOURCE canonical segmentation and its legacy view are untouched (they are
  // separate objects with no event route between them).

  const registration = _ensureRegistration(workingSegmentationId);
  if (!registration
      || !((c3dSegmentations.state.getSegmentation(workingSegmentationId) || {})
        .cachedStats || {})[EDITOR_COPY_OF_KEY]) {
    // Only a working copy may be released through this entry point.
    if (registration) {
      console.warn(
        `[vtk:labelmapBridge] releaseEditorWorkingCopy: ${workingSegmentationId} is not an `
        + 'editor working copy.');
    }
    return false;
  }

  return removeCanonicalSegmentation(workingSegmentationId);
}


export function attachSegmentationDisplay(segmentationId) {
  // A view wants to display this segmentation. Reference counted; the first attach materialises a
  // FRESH display generation -- a volume built over the durable stack images under a
  // generation-numbered volumeId -- so a new layout never inherits a GL resource that belonged to
  // a torn-down one. The logical segmentation is untouched: it has been in Cornerstone3D state
  // since import, and no SEGMENTATION_ADDED fires here.

  // @returns the display volume for this session, or undefined when no segmentation is recorded

  const registration = _ensureRegistration(segmentationId);
  if (!registration) {
    console.warn(
      `[vtk:labelmapBridge] attachSegmentationDisplay: no segmentation recorded for `
      + `${segmentationId}. The importer creates it; a view cannot.`);
    return undefined;
  }

  // The holder commits only after a successful materialisation: a failed attach that left the
  // count raised would make the eventual last detach stop above zero and never retire the
  // display -- exactly the stale-volume lifecycle the generation scheme exists to prevent.
  if (!registration.volume) {
    registration.inBridge = true;
    try {
      _materialiseDisplay(registration);
    } catch (error) {
      _unwindFailedMaterialisation(registration);
      throw error;
    } finally {
      registration.inBridge = false;
    }
  }

  registration.holders += 1;
  return registration.volume;
}


function _unwindFailedMaterialisation(registration) {
  // Undo whatever a failed `_materialiseDisplay` left behind: the generation's volume if it was
  // cached, the representation-data volumeId if it was set, and the eviction pins the volume's
  // teardown clears.

  const volumeId = `${registration.segmentationId}::display-${registration.generation}`;

  try {
    const segmentation = c3dSegmentations.state.getSegmentation(registration.segmentationId);
    const labelmapData = segmentation && (segmentation.representationData || {})[
      c3dToolsEnums.SegmentationRepresentations.Labelmap];
    if (labelmapData && labelmapData.volumeId === volumeId) {
      delete labelmapData.volumeId;
    }

    if (c3dCache.getVolumeLoadObject(volumeId)) {
      c3dCache.removeVolumeLoadObject(volumeId);
    }
  } catch (cleanupError) {
    console.warn('[vtk:labelmapBridge] failed to unwind a failed attach:', cleanupError);
  }

  registration.volume = null;
  _setDurableImagePins(registration.stackVolumeImageIds, registration.segmentationId, true);
}


export function detachSegmentationDisplay(segmentationId, options) {
  // A view is done with this segmentation. When the last one detaches, the display materialisation
  // is retired -- viewport representations, the generation's volume, its vtkImageData and texture
  // -- and `representationData.Labelmap.volumeId` is cleared back to the stack form. The logical
  // segmentation, the durable stack images and the legacy view stay: close/reopen raises no
  // segmentation-removed domain event, and every edit is already in the canonical voxels (the
  // volume's voxelManager reads and writes the cached stack images directly).

  options = options || {};

  const registration = _registrations.get(segmentationId);
  if (!registration) {
    return 0;
  }

  registration.holders = Math.max(0, registration.holders - 1);
  if (registration.holders > 0 && !options.force) {
    return registration.holders;
  }
  registration.holders = 0;

  if (registration.volume) {
    _retireDisplay(registration);
  }

  return 0;
}


export function attachDerivedSegmentationDisplay(segmentationId, derivedSegmentationId, options) {
  // A view that renders in its OWN rendering engine (the inspection/lightbox modal) wants the
  // segmentation on screen. It cannot share the canonical display volume -- an ImageVolume owns
  // exactly one vtkStreamingOpenGLTexture, and that texture cannot be bound to two WebGL contexts
  // -- so it gets a DERIVED display: its own segmentation entry under `derivedSegmentationId`,
  // with its own generation-numbered volume built over the SAME durable stack images. The voxels
  // are therefore the canonical voxels (no copy, always in sync); only the GL-facing objects are
  // per view.
  //
  // The derived segmentation is disposable display state, deliberately NOT flagged canonical:
  // `_releaseDerivedSegmentations` may dispose of it with its image volume's lease, and removing
  // it never touches the canonical segmentation.

  // @input options.referencedVolumeId (str): the view's own image volume, recorded on the derived
  //   representation so lease-release disposal can find it
  // @returns the derived display volume, or undefined when no segmentation is recorded

  options = options || {};

  const registration = _ensureRegistration(segmentationId);
  if (!registration || !derivedSegmentationId || derivedSegmentationId === segmentationId) {
    if (!registration) {
      console.warn(
        `[vtk:labelmapBridge] attachDerivedSegmentationDisplay: no segmentation recorded for `
        + `${segmentationId}.`);
    }
    return undefined;
  }

  let entry = registration.derivedDisplays.get(derivedSegmentationId);
  if (!entry) {
    entry = { volume: null, holders: 0, generation: 0 };
    registration.derivedDisplays.set(derivedSegmentationId, entry);
  }

  if (!entry.volume) {
    entry.generation += 1;
    const volumeId = `${derivedSegmentationId}::display-${entry.generation}`;
    let addedSegmentation = false;

    try {
    const volume = c3dVolumeLoader.createAndCacheVolumeFromImagesSync(
      volumeId, registration.stackVolumeImageIds);
    if (options.referencedVolumeId) {
      volume.referencedVolumeId = options.referencedVolumeId;
    }

    const representationData = {
      imageIds: registration.stackVolumeImageIds,
      volumeId,
      referencedImageIds: registration.canonicalImageIds,
      referenceVolumeId: options.referencedVolumeId,
      referencedVolumeId: options.referencedVolumeId,
    };

    const existing = c3dSegmentations.state.getSegmentation(derivedSegmentationId);
    if (!existing) {
      addedSegmentation = true;
      // Segment identity cloned from the canonical segmentation, so per-view visibility toggles
      // and panel listings work against the derived entry without writing canonical state.
      const canonical = c3dSegmentations.state.getSegmentation(segmentationId);
      const segments = {};
      _.each(_.values((canonical && canonical.segments) || {}), (segment) => {
        if (segment) {
          segments[segment.segmentIndex] = { ...segment };
        }
      });

      // The display-only flag travels IN the registration config so it is already on the entry
      // when the library fires SEGMENTATION_ADDED -- that is the moment `SegmentationService`
      // classifies the entry and keeps it out of the domain roster and events.
      c3dSegmentations.state.addSegmentations([{
        segmentationId: derivedSegmentationId,
        representation: {
          type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
          data: representationData,
        },
        config: {
          ...(_.size(segments) ? { segments } : {}),
          cachedStats: { sonadorDerivedFromSegmentation: segmentationId },
        },
      }]);

      const derived = c3dSegmentations.state.getSegmentation(derivedSegmentationId);
      if (derived) {
        derived.cachedStats = derived.cachedStats || {};
        derived.cachedStats.sonadorDerivedFromSegmentation = segmentationId;
      }
    } else {
      const labelmapData = (existing.representationData || {})[
        c3dToolsEnums.SegmentationRepresentations.Labelmap];
      if (labelmapData) {
        _.assign(labelmapData, representationData);
      }
    }

    entry.volume = volume;
    } catch (error) {
      // Unwind the attempt: the cached volume, a segmentation entry THIS attempt added, and the
      // pins its teardown cleared. The holder was never committed, so a retry starts clean.
      try {
        if (addedSegmentation && c3dSegmentations.state.getSegmentation(derivedSegmentationId)) {
          c3dSegmentations.state.removeSegmentation(derivedSegmentationId);
        }
        if (c3dCache.getVolumeLoadObject(volumeId)) {
          c3dCache.removeVolumeLoadObject(volumeId);
        }
      } catch (cleanupError) {
        console.warn('[vtk:labelmapBridge] failed to unwind a failed derived attach:', cleanupError);
      }
      entry.volume = null;
      _setDurableImagePins(registration.stackVolumeImageIds, segmentationId, true);
      throw error;
    }
  }

  entry.holders += 1;
  return entry.volume;
}


export function detachDerivedSegmentationDisplay(segmentationId, derivedSegmentationId, options) {
  // The derived view is done. The last detach removes the derived segmentation entry, its
  // representations and its volume; the canonical segmentation, its display and the durable stack
  // are untouched. Idempotent with `_releaseDerivedSegmentations` (the image-volume lease-release
  // disposal), which may run first -- every removal checks existence.

  options = options || {};

  const registration = _registrations.get(segmentationId);
  const entry = registration && registration.derivedDisplays.get(derivedSegmentationId);
  if (!entry) {
    return 0;
  }

  entry.holders = Math.max(0, entry.holders - 1);
  if (entry.holders > 0 && !options.force) {
    return entry.holders;
  }
  entry.holders = 0;

  registration.retiring = true;
  try {
    _.each(
      c3dSegmentations.state.getViewportIdsWithSegmentation(derivedSegmentationId) || [],
      (viewportId) => {
        _.each(
          c3dSegmentations.state.getSegmentationRepresentations(
            viewportId, { segmentationId: derivedSegmentationId }) || [],
          (representation) => {
            try {
              c3dSegmentations.removeSegmentationRepresentation(viewportId, {
                segmentationId: derivedSegmentationId, type: representation.type,
              });
            } catch (error) {
              // A viewport already disabled has nothing to remove.
            }
          });
      });

    if (c3dSegmentations.state.getSegmentation(derivedSegmentationId)) {
      c3dSegmentations.state.removeSegmentation(derivedSegmentationId);
    }

    if (entry.volume && c3dCache.getVolumeLoadObject(entry.volume.volumeId)) {
      c3dCache.removeVolumeLoadObject(entry.volume.volumeId);
    }

    _setDurableImagePins(registration.stackVolumeImageIds, segmentationId, true);
  } finally {
    registration.retiring = false;
  }

  entry.volume = null;
  return 0;
}


function _materialiseDisplay(registration) {
  // Build this session's display volume from the durable stack images -- the library's own
  // stack -> volume labelmap shape (`internalConvertStackToVolumeLabelmap` performs exactly this
  // sequence). Everything GL-facing created here is new: the ImageVolume, its vtkImageData and its
  // vtkStreamingOpenGLTexture belong to this generation alone. The voxels are not copied -- the
  // volume's voxelManager reads and writes the cached stack images, whose pixel data subarrays the
  // one canonical array.

  registration.generation += 1;
  const volumeId = `${registration.segmentationId}::display-${registration.generation}`;

  const volume = c3dVolumeLoader.createAndCacheVolumeFromImagesSync(
    volumeId, registration.stackVolumeImageIds);

  if (registration.referencedVolumeId) {
    volume.referencedVolumeId = registration.referencedVolumeId;
  }

  const segmentation = c3dSegmentations.state.getSegmentation(registration.segmentationId);
  const labelmapData = segmentation && (segmentation.representationData || {})[
    c3dToolsEnums.SegmentationRepresentations.Labelmap];
  if (labelmapData) {
    labelmapData.volumeId = volumeId;
  }

  registration.volume = volume;
  return volume;
}


function _retireDisplay(registration) {
  // Tear this session's GL-facing state down. Anything left behind is bound to a WebGL context, a
  // viewport id or a colour LUT index belonging to the layout that has just gone, and would be
  // resurrected -- wrongly -- by the next layout's identical ids. The LOGICAL segmentation is not
  // touched: `removeSegmentation` is never called here, so no domain removal event fires and
  // `SegmentationService` continues to see the segmentation between sessions.

  const { segmentationId } = registration;

  registration.retiring = true;
  try {
    // Representations first: they hold actors and colour transfer functions bound to viewports.
    _.each(
      c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId) || [],
      (viewportId) => {
        _.each(
          c3dSegmentations.state.getSegmentationRepresentations(viewportId, { segmentationId }) || [],
          (representation) => {
            try {
              c3dSegmentations.removeSegmentationRepresentation(viewportId, {
                segmentationId, type: representation.type,
              });
            } catch (error) {
              // A viewport already disabled has nothing to remove; not worth failing teardown over.
            }
          });
      });

    // Back to the stack form: the durable representation data keeps its imageIds; only the
    // session's volumeId goes.
    const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
    const labelmapData = segmentation && (segmentation.representationData || {})[
      c3dToolsEnums.SegmentationRepresentations.Labelmap];
    if (labelmapData && labelmapData.volumeId) {
      delete labelmapData.volumeId;
    }

    const volume = registration.volume;

    // `removeVolumeLoadObject` runs the cache's own `_decacheVolume`: the vtkImageData (and with
    // it the GL texture binding) is deleted, and `sharedCacheKey` stamps matching this volumeId
    // are cleared from the images -- which are the DURABLE stack images, so they are left in the
    // cache and re-pinned below. Nothing else references this generation's ids again.
    if (volume && c3dCache.getVolumeLoadObject(volume.volumeId)) {
      c3dCache.removeVolumeLoadObject(volume.volumeId);
    }

    _setDurableImagePins(registration.stackVolumeImageIds, segmentationId, true);
  } finally {
    registration.retiring = false;
  }

  registration.volume = null;
}


function _writeCanonicalProvenance(segmentationId, segMetadata, extras) {
  // Park the DICOM provenance on the Cornerstone3D segmentation, so the whole FR-5 record is
  // reachable through `segmentationId` and nothing depends on this module still being loaded.
  //
  // `cachedStats` is Cornerstone3D's own extension point on both the segmentation and each segment,
  // which is why it is used rather than a field of our own invention on the representation.

  extras = extras || {};

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  if (!segmentation) {
    return;
  }

  segmentation.cachedStats = segmentation.cachedStats || {};
  if (extras.workingCopyOf) {
    // A Seg-Editor working copy carries the FULL provenance record -- everything a serializer
    // (#95) needs is on its own Cornerstone3D entry -- but never the canonical flag: it must stay
    // out of the series roster and must not reconstruct as a canonical segmentation.
    segmentation.cachedStats[EDITOR_COPY_OF_KEY] = extras.workingCopyOf;
  } else {
    segmentation.cachedStats[CANONICAL_FLAG] = true;
  }
  segmentation.cachedStats[SEG_METADATA_KEY] = segMetadata;
  if (extras.info) {
    segmentation.cachedStats[CANONICAL_INFO_KEY] = extras.info;
  }
  if (extras.segmentValueMap && _.size(extras.segmentValueMap)) {
    segmentation.cachedStats[SEGMENT_VALUE_MAP_KEY] = { ...extras.segmentValueMap };
  }

  const valueMap = extras.segmentValueMap || {};

  // Per-segment coded metadata alongside each segment, where a serializer looks for it. Segments
  // are keyed by the CANONICAL voxel value; the dicom entry retains the original SegmentNumber, so
  // a remapped segment stays reversible.
  _.each((segMetadata && segMetadata.data) || [], (entry, segmentNumber) => {
    if (!entry) {
      return;
    }
    const canonicalIndex = valueMap[segmentNumber] || segmentNumber;
    const segment = segmentation.segments && segmentation.segments[canonicalIndex];
    if (!segment) {
      return;
    }

    segment.cachedStats = segment.cachedStats || {};
    segment.cachedStats.dicom = entry;
  });
}


function _canonicalSegmentConfig(segMetadata, layerSegments, segmentValueMap) {
  // The segment identity the SEG declares, which is what Cornerstone3D should hold.
  //
  // Taken from the SEG's own metadata rather than from the voxels: a segment a SEG declares but
  // never paints is still a segment, and deriving the list from the pixels would silently drop it.
  //
  // An overlapping SEG imports as several labelmap layers, each its own segmentation; when the
  // caller names this layer's segments, only those are installed -- the full declared set on every
  // layer is exactly the membership loss review finding 37558 called out. Segments -- and the
  // caller's `layerSegments` -- are keyed by the CANONICAL voxel value (`segmentValueMap`), which
  // is the value the renderer maps and the one identity every live operation uses.

  const data = (segMetadata && segMetadata.data) || [];
  const valueMap = segmentValueMap || {};
  const layerFilter = _.isArray(layerSegments) && layerSegments.length
    ? new Set(_.map(layerSegments, Number))
    : null;
  const segments = {};

  _.each(data, (entry, segmentNumber) => {
    if (!entry || !segmentNumber) {
      return;
    }

    const segmentIndex = valueMap[segmentNumber] || segmentNumber;
    if (layerFilter && !layerFilter.has(Number(segmentIndex))) {
      return;
    }

    segments[segmentIndex] = {
      segmentIndex,
      label: entry.SegmentLabel || `Segment ${segmentNumber}`,
      isVisible: true,
      active: false,
    };
  });

  const config = {};
  if (_.size(segments)) {
    config.segments = segments;
  }

  return config;
}


function _seedCanonicalVoxels({
  scalarData, sliceLength, slices, labelmapBuffer, imageIds, canonicalImageIds,
  segmentValueMap, segmentationId,
}) {
  // Copy the parsed labelmap into the canonical store, mapping the parse order onto the canonical
  // slice order by imageId. This is the one copy the import makes, and it is unavoidable: the parser
  // hands back its own buffer in its own order.
  //
  // Values are narrowed EXPLICITLY. `Uint16 -> Uint8` through `TypedArray.set` reduces modulo 256
  // -- segment 256 would silently become background -- so every voxel above 255 must be covered by
  // `segmentValueMap` (from `planSegmentValueRemap`); a value above 255 the SEG never declared is
  // malformed input, dropped to background with one warning rather than aliased onto a real
  // segment.

  if (!labelmapBuffer) {
    return;
  }

  const source = labelmapBuffer instanceof Uint16Array
    ? labelmapBuffer
    : new Uint16Array(labelmapBuffer);

  const valueMap = segmentValueMap || {};
  let droppedValues = null;

  _.each(imageIds, (imageId, parsedIndex) => {
    const canonicalIndex = canonicalImageIds.indexOf(imageId);
    if (canonicalIndex < 0 || canonicalIndex >= slices) {
      return;
    }

    const from = parsedIndex * sliceLength;
    if (from + sliceLength > source.length) {
      return;
    }

    const to = canonicalIndex * sliceLength;
    for (let i = 0; i < sliceLength; i++) {
      let value = source[from + i];
      if (value > 255) {
        const mapped = valueMap[value];
        if (mapped === undefined) {
          droppedValues = droppedValues || new Set();
          droppedValues.add(value);
          value = 0;
        } else {
          value = mapped;
        }
      }
      scalarData[to + i] = value;
    }
  });

  if (droppedValues) {
    console.warn(
      `[vtk:labelmapBridge] ${segmentationId}: labelmap values above 255 with no declared segment `
      + `were dropped to background: ${[...droppedValues].join(', ')}`);
  }
}


export function resolveLegacyViewPlacement(record, stackImageIds) {
  // Compute the stack-order -> canonical-order slice map the legacy `labelmap3D` is carried
  // across with, and report why the store itself is never shared. The legacy module addresses
  // slices in STACK order -- `getLabelmap2DByImageIdIndex` builds
  // `new Uint16Array(buffer, sliceLength * i * 2, sliceLength)` for stack index i -- while the
  // canonical stack is in position-sorted order; and the canonical store is `Uint8`, which the
  // 16-bit-only legacy module cannot view in any order. `shared` is always false; the
  // `shareLabelmapBuffer` switch that once selected the copy is removed per the #136 AR-5
  // disposition (note 37720).

  // @returns { shared, sliceMap, reason }

  const map = _.map(stackImageIds || [], (imageId) => {
    const index = record.canonicalImageIds.indexOf(imageId);
    return index >= 0 && index < record.slices ? index : -1;
  });

  const identity = map.length === record.slices && _.every(map, (v, i) => v === i);
  const sixteenBit = record.scalarData instanceof Uint16Array;

  let reason;
  if (!sixteenBit) {
    // The canonical store is 8-bit because that is the only format Cornerstone3D's labelmap
    // rendering can display (see `canonicalScalarTypeFor`), and the legacy module can only view
    // 16-bit memory. So the legacy labelmap is always a bridge-owned copy.
    reason = 'the canonical store is 8-bit, which is what Cornerstone3D labelmap rendering requires; '
      + 'the legacy labelmap can only view 16-bit memory';
  } else if (!identity) {
    reason = 'the classic stack order and the canonical slice order differ';
  }

  return { shared: !reason, sliceMap: map, reason };
}


function _installLegacyView(registration) {
  // Build the legacy `labelmap3D` from the canonical Cornerstone3D data and install it in the
  // cornerstone-tools segmentation module. Runs once, at import: the legacy view persists for the
  // classic viewport and `SegmentationPanel` regardless of whether any volumetric view is open,
  // and is kept in step with the canonical voxels by the event bridge.

  const placement = resolveLegacyViewPlacement(registration, registration.stackImageIds);
  if (!placement.shared && !_.every(placement.sliceMap, (v, i) => v === i)) {
    _logFallbackOnce(registration.firstImageId, registration.segmentationId,
      'the classic stack order and the canonical slice order differ');
  }

  const { sliceLength } = registration;
  const buffer = new ArrayBuffer(sliceLength * registration.stackImageIds.length * 2);
  const labelmap3D = _buildLegacyLabelmap3D({
    registration, buffer, sliceMap: placement.sliceMap,
    colorLUTIndex: registration.colorLUTIndex,
  });

  // Seed the legacy voxels from the canonical store. `_buildLegacyLabelmap3D` computes each
  // slice's `segmentsOnLabelmap` from it but leaves the buffer to the caller.
  _.each(placement.sliceMap, (canonicalIndex, stackIndex) => {
    if (canonicalIndex < 0) {
      return;
    }

    const target = new Uint16Array(buffer, stackIndex * sliceLength * 2, sliceLength);
    target.set(registration.scalarData.subarray(
      canonicalIndex * sliceLength, (canonicalIndex + 1) * sliceLength));
  });

  registration.previousActiveLabelmapIndex = _installLegacyLabelmap3D(
    registration.firstImageId, registration.labelmapIndex, labelmap3D);

  registration.labelmap3D = labelmap3D;
  registration.buffer = buffer;
  registration.sliceMap = placement.sliceMap;
  registration.inverseMap = invertLabelmapSliceMap(placement.sliceMap);
  _snapshotLegacyMarks(registration);
}


function _buildLegacyLabelmap3D({ registration, buffer, sliceMap, colorLUTIndex }) {
  // The shape `cornerstoneTools`' `addLabelmap3D` / `setLabelmap3DByFirstImageId` produce, built
  // here instead so the voxels come from the canonical store rather than from a fresh allocation.
  //
  // `metadata` is remap-aware: entries sit at the CANONICAL voxel value (`_legacySegMetadata`), so
  // the panel's per-value lookups agree with what the voxels actually hold; each entry keeps its
  // original SegmentNumber for provenance.

  const { sliceLength } = registration;

  const labelmap3D = {
    buffer,
    labelmaps2D: [],
    metadata: _legacySegMetadata(registration),
    activeSegmentIndex: 1,
    colorLUTIndex: colorLUTIndex || 0,
    segmentsHidden: [],
    undo: [],
    redo: [],
  };

  // `labelmaps2D` is sparse: the legacy module only records slices that carry content, and
  // `getLabelmap2DByImageIdIndex` lazily creates the rest. Matching that keeps the panel's segment
  // list and `getLabelmapStats` behaving as they did.
  _.each(sliceMap, (canonicalIndex, stackIndex) => {
    const offset = stackIndex * sliceLength * 2;
    if (offset + sliceLength * 2 > buffer.byteLength) {
      return;
    }

    const pixelData = new Uint16Array(buffer, offset, sliceLength);
    const source = canonicalIndex >= 0
      ? registration.scalarData.subarray(
        canonicalIndex * sliceLength, (canonicalIndex + 1) * sliceLength)
      : undefined;

    const segmentsOnLabelmap = getSegmentsOnPixelData(source || pixelData);
    if (_.some(segmentsOnLabelmap, (segment) => segment)) {
      labelmap3D.labelmaps2D[stackIndex] = { pixelData, segmentsOnLabelmap };
    }
  });

  return labelmap3D;
}


function _legacySegMetadata(registration) {
  // The legacy `labelmap3D.metadata`: the dcmjs segment metadata, with each entry placed at the
  // canonical voxel value when the SEG's segment numbers had to be remapped below 256. Without the
  // remap this is the caller's object unchanged, which is what the panel has always read.
  //
  // A relocated entry's `SegmentNumber` is REWRITTEN to the canonical value, because
  // `SegmentationPanel.getSegmentList` uses that field as the OPERATIONAL key -- selection,
  // visibility and slice lookup all flow through it, and the voxels and `segmentsOnLabelmap`
  // carry only canonical values. The original DICOM number moves to `OriginalSegmentNumber` for
  // display; the serialization-side inverse lives in the provenance
  // (`cachedStats.sonadorSegmentValueMap` and each segment's `cachedStats.dicom`).

  const segMetadata = registration.segMetadata;
  const segmentation = c3dSegmentations.state.getSegmentation(registration.segmentationId);
  const valueMap = ((segmentation && segmentation.cachedStats) || {})[SEGMENT_VALUE_MAP_KEY];

  if (!valueMap || !_.size(valueMap) || !segMetadata || !_.isArray(segMetadata.data)) {
    return segMetadata;
  }

  const data = [];
  _.each(segMetadata.data, (entry, segmentNumber) => {
    if (!entry) {
      return;
    }

    const canonicalIndex = valueMap[segmentNumber] || segmentNumber;
    data[canonicalIndex] = canonicalIndex === segmentNumber
      ? entry
      : {
        ...entry,
        SegmentNumber: canonicalIndex,
        OriginalSegmentNumber: entry.SegmentNumber !== undefined
          ? entry.SegmentNumber
          : segmentNumber,
      };
  });

  return { ...segMetadata, data };
}


function _installLegacyLabelmap3D(firstImageId, labelmapIndex, labelmap3D) {
  // Install the view as the series' active labelmap. Returns the labelmap that was active before,
  // so a removal can hand the active slot back (see _releaseActiveLabelmap).
  const state = segmentationModule.state;

  if (!state.series[firstImageId]) {
    state.series[firstImageId] = { activeLabelmapIndex: labelmapIndex, labelmaps3D: [] };
  }

  const previousActiveLabelmapIndex = state.series[firstImageId].activeLabelmapIndex;
  state.series[firstImageId].labelmaps3D[labelmapIndex] = labelmap3D;
  state.series[firstImageId].activeLabelmapIndex = labelmapIndex;
  return previousActiveLabelmapIndex !== labelmapIndex ? previousActiveLabelmapIndex : undefined;
}


function _releaseActiveLabelmap(series, removedLabelmapIndex, previousActiveLabelmapIndex) {
  // After a legacy view is removed: if it was the series' active labelmap, make another one active
  // -- the one that was active before it, else the first remaining. `SegmentationPanel` lists
  // nothing while the active slot is empty, so leaving it pointing at the removed view emptied the
  // panel for every segmentation of the series (ohif-viewers#143: exiting the editor on a
  // segmentation created in the viewer). Returns true when the active labelmap changed.
  if (!series || series.activeLabelmapIndex !== removedLabelmapIndex) {
    return false;
  }
  const remaining = series.labelmaps3D;
  const next = Number.isInteger(previousActiveLabelmapIndex) && remaining[previousActiveLabelmapIndex]
    ? previousActiveLabelmapIndex
    : _.findIndex(remaining, labelmap => !!labelmap);
  if (next < 0) {
    return false;
  }
  series.activeLabelmapIndex = next;
  return true;
}


export function noteReferencedVolume(segmentationId, imageVolumeId) {
  // Record which image volume this segmentation overlays. Known only once a viewport exists, so
  // the first view that has one reports it; remembered on the Cornerstone3D segmentation so later
  // display generations and serializers see it without a viewport.

  const registration = _registrations.get(segmentationId);
  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  if (!segmentation || !imageVolumeId) {
    return;
  }

  if (registration) {
    registration.referencedVolumeId = imageVolumeId;
    if (registration.volume) {
      registration.volume.referencedVolumeId = imageVolumeId;
    }
  }

  const info = (segmentation.cachedStats || {})[CANONICAL_INFO_KEY];
  if (info) {
    info.referencedVolumeId = imageVolumeId;
  }

  const labelmapData = (segmentation.representationData || {})[
    c3dToolsEnums.SegmentationRepresentations.Labelmap];
  if (labelmapData) {
    labelmapData.referenceVolumeId = imageVolumeId;
    labelmapData.referencedVolumeId = imageVolumeId;
  }
}


/** Mark a canonical segmentation as existing only in memory (see IN_MEMORY_KEY). */
export function markInMemorySegmentation(segmentationId, { origin } = {}) {
  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  if (!segmentation) {
    return false;
  }
  segmentation.cachedStats = segmentation.cachedStats || {};
  segmentation.cachedStats[IN_MEMORY_KEY] = { origin, createdAt: Date.now() };
  return true;
}

/**
 * The in-memory marker of a segmentation, or of the segmentation an editor working copy was
 * forked from; undefined for a segmentation loaded from DICOM.
 */
export function getInMemorySegmentationInfo(segmentationId) {
  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  const cachedStats = segmentation?.cachedStats || {};
  if (cachedStats[IN_MEMORY_KEY]) {
    return { segmentationId, ...cachedStats[IN_MEMORY_KEY] };
  }
  const sourceId = cachedStats[EDITOR_COPY_OF_KEY];
  const source = sourceId && c3dSegmentations.state.getSegmentation(sourceId);
  const info = source?.cachedStats?.[IN_MEMORY_KEY];
  return info ? { segmentationId: sourceId, ...info } : undefined;
}

export function removeCanonicalSegmentation(segmentationId) {
  // Destroy a segmentation. This is the ONLY thing that does (FR-8) -- not closing a viewport, not
  // releasing an image volume's lease, not detaching the display. Reached directly, or through the
  // SEGMENTATION_REMOVED listener when the removal came through `SegmentationService` /
  // `segmentation.state.removeSegmentation` (in which case the state entry is already gone and
  // only the durable images, the legacy view and the wiring are left to clean).

  const registration = _ensureRegistration(segmentationId);
  if (!registration) {
    // Nothing reconstructable, but the removal is still honoured against whatever state exists.
    const existed = !!c3dSegmentations.state.getSegmentation(segmentationId);
    if (existed) {
      c3dSegmentations.state.removeSegmentation(segmentationId);
    }
    return existed;
  }

  registration.retiring = true;
  let activeLabelmapChanged = false;
  try {
    detachSegmentationDisplay(segmentationId, { force: true });
    _.each([...registration.derivedDisplays.keys()], (derivedSegmentationId) => {
      detachDerivedSegmentationDisplay(segmentationId, derivedSegmentationId, { force: true });
    });

    _.each(registration.serviceSubscriptions, (unsubscribe) => {
      if (_.isFunction(unsubscribe)) {
        unsubscribe();
      }
    });

    const series = segmentationModule.state.series[registration.firstImageId];
    if (series && series.labelmaps3D[registration.labelmapIndex] === registration.labelmap3D) {
      delete series.labelmaps3D[registration.labelmapIndex];
      activeLabelmapChanged = _releaseActiveLabelmap(
        series, registration.labelmapIndex, registration.previousActiveLabelmapIndex);
    }

    // The logical segmentation, unless the caller's own removal already took it out of state.
    if (c3dSegmentations.state.getSegmentation(segmentationId)) {
      c3dSegmentations.state.removeSegmentation(segmentationId);
    }

    // The durable stack images: unpin, then remove.
    _setDurableImagePins(registration.stackVolumeImageIds, segmentationId, false);
    _.each(registration.stackVolumeImageIds || [], (imageId) => {
      if (c3dCache.getImageLoadObject(imageId)) {
        c3dCache.removeImageLoadObject(imageId);
      }
    });
  } finally {
    registration.retiring = false;
  }

  _registrations.delete(segmentationId);

  if (!_registrations.size) {
    _teardownGlobalListeners();
  }

  // An open panel re-reads the series' state (its active labelmap moved)
  if (activeLabelmapChanged) {
    _notifyLegacyPanel(registration);
  }

  return true;
}


export function getLabelmapRegistration(segmentationId) {
  return _registrations.get(segmentationId);
}


export function attachSegmentationService(segmentationId, segmentationService) {
  // Subscribe the metadata half of FR-4 that Cornerstone3D's own events do not carry.
  //
  // Labels, the active segment and segment removal all reach `SEGMENTATION_MODIFIED` on the
  // Cornerstone3D event target, so they are handled without any service. Colour does not: a
  // segment's colour lives in the per-viewport colour LUT, and the only "the user changed this
  // colour" signal is `SegmentationService`'s own `SEGMENT_COLOR_MODIFIED`.

  const registration = _registrations.get(segmentationId);
  if (!registration || !segmentationService || registration.colorSubscribed) {
    return;
  }

  const colorSubscription = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENT_COLOR_MODIFIED,
    ({ segmentationId: modifiedId, segmentIndex, color }) => {
      if (modifiedId !== segmentationId) {
        return;
      }
      _writeLegacySegmentColor(registration, segmentIndex, color);
    });

  // SEGMENT_ADDED carries the new segment's config -- label, colour, visibility -- which the
  // Cornerstone3D segmentation state does not hold in one place (colour lives in the per-viewport
  // LUT, visibility on the representation). The `SEGMENTATION_MODIFIED` mirror creates the legacy
  // metadata entry on its own, so this fills in the parts only the service knows.
  const addedSubscription = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENT_ADDED,
    ({ segmentationId: modifiedId, segmentIndex, config }) => {
      if (modifiedId !== segmentationId) {
        return;
      }
      _writeLegacySegmentAdded(registration, segmentIndex, config);
    });

  registration.colorSubscribed = true;
  registration.serviceSubscriptions.push(
    colorSubscription.unsubscribe, addedSubscription.unsubscribe);
}


export function mirrorLegacyMetadataToCornerstone3d(segmentationId) {
  // Legacy -> Cornerstone3D metadata at registration (FR-4). Labels arrive with the segmentation
  // config the view builds; what is left is the state the legacy module holds separately: which
  // segment is active, and which are hidden.
  //
  // Visibility is a property of a representation, not of the segmentation, so it can only be
  // written once a viewport has one; callers apply it after `addSegmentationRepresentations`.

  const registration = _registrations.get(segmentationId);
  const labelmap3D = registration && registration.labelmap3D;
  if (!labelmap3D) {
    return;
  }

  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  registration.knownSegments = new Set(_.map(
    _.filter(_.values((segmentation && segmentation.segments) || {}), Boolean),
    (segment) => segment.segmentIndex));

  registration.inBridge = true;
  try {
    // Only when the legacy active index names a segment Cornerstone3D actually has. A SEG whose
    // segments start above 1 leaves the legacy default (1) pointing at nothing, and writing that
    // across would undo the deliberate choice the segmentation editor makes just before this runs
    // (`SegmentationEditorLayout._activateSegmentationRepresentation` selects the lowest segment).
    const activeSegmentIndex = labelmap3D.activeSegmentIndex;
    if (_.isNumber(activeSegmentIndex) && registration.knownSegments.has(activeSegmentIndex)) {
      c3dSegmentations.segmentIndex.setActiveSegmentIndex(segmentationId, activeSegmentIndex);
    }

    _.each(c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId), (viewportId) => {
      _.each(labelmap3D.segmentsHidden || [], (isHidden, segmentIndex) => {
        if (!segmentIndex) {
          return;
        }
        c3dSegmentations.config.visibility.setSegmentIndexVisibility(
          viewportId, { segmentationId, type: c3dToolsEnums.SegmentationRepresentations.Labelmap },
          segmentIndex, !isHidden);
      });
    });

    // The same per-segment visibility applies to every derived (lightbox) representation --
    // including one added AFTER a segment was hidden, since the view runs this mirror right
    // after registering its representation.
    _applyVisibilityToDerived(registration);
  } finally {
    registration.inBridge = false;
  }
}


function _applyVisibilityToDerived(registration) {
  // Carry the canonical per-segment visibility -- aggregated in the legacy `segmentsHidden`
  // array, which both mirror directions keep current -- onto every live derived representation.
  // The lightbox's own whole-overlay toggle stays viewport-local; per-SEGMENT visibility is
  // canonical state and follows the segmentation.

  const { labelmap3D } = registration;
  if (!labelmap3D) {
    return;
  }

  _.each([...registration.derivedDisplays.keys()], (derivedSegmentationId) => {
    _.each(
      c3dSegmentations.state.getViewportIdsWithSegmentation(derivedSegmentationId) || [],
      (viewportId) => {
        _.each(labelmap3D.segmentsHidden || [], (isHidden, segmentIndex) => {
          if (!segmentIndex) {
            return;
          }
          c3dSegmentations.config.visibility.setSegmentIndexVisibility(
            viewportId,
            {
              segmentationId: derivedSegmentationId,
              type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
            },
            segmentIndex, !isHidden);
        });
      });
  });
}


function _logFallbackOnce(firstImageId, segmentationId, reason) {
  // FR-7: once per series. The key is the series, not the labelmap -- a series with two labelmaps,
  // or one that is closed and re-opened, states the reason once.

  const seriesKey = firstImageId || segmentationId;
  if (_fallbackLoggedSeries.has(seriesKey)) {
    return;
  }
  _fallbackLoggedSeries.add(seriesKey);

  console.warn(
    `[vtk:labelmapBridge] The legacy compatibility labelmap for ${segmentationId} is a copy of `
    + `the canonical Cornerstone3D voxels: ${reason}. Edits are bridged by copying the changed `
    + `slices in both directions.`);
}


// ---------------------------------------------------------------------------------------------
// Legacy state access
// ---------------------------------------------------------------------------------------------

function _legacySliceView(registration, stackIndex) {
  // The Uint16 view of one stack slice. `labelmaps2D` is sparse -- `setLabelmap3DByFirstImageId`
  // only records slices that had content at load -- so a slice with no entry gets its view built
  // the same way `getLabelmap2DByImageIdIndex` builds one.

  const { labelmap3D, sliceLength, buffer } = registration;
  if (!labelmap3D) {
    return undefined;
  }

  const labelmap2D = labelmap3D.labelmaps2D[stackIndex];
  if (labelmap2D && labelmap2D.pixelData) {
    return labelmap2D.pixelData;
  }

  const offset = stackIndex * sliceLength * 2;
  if (!buffer || offset + sliceLength * 2 > buffer.byteLength) {
    return undefined;
  }

  return new Uint16Array(buffer, offset, sliceLength);
}


function _ensureLegacyLabelmap2D(registration, stackIndex, pixelData) {
  const { labelmap3D } = registration;

  if (!labelmap3D.labelmaps2D[stackIndex]) {
    labelmap3D.labelmaps2D[stackIndex] = { pixelData, segmentsOnLabelmap: [] };
  }

  return labelmap3D.labelmaps2D[stackIndex];
}


function _snapshotLegacyMarks(registration) {
  const labelmaps2D = (registration.labelmap3D && registration.labelmap3D.labelmaps2D) || [];

  for (let i = 0; i < labelmaps2D.length; i++) {
    if (labelmaps2D[i]) {
      registration.marks[i] = labelmaps2D[i].segmentsOnLabelmap;
    }
  }
}


// ---------------------------------------------------------------------------------------------
// Cornerstone3D state access
// ---------------------------------------------------------------------------------------------

function _volumeSliceScalarData(registration, volumeIndex) {
  const imageId = registration.volume && registration.volume.imageIds[volumeIndex];
  if (!imageId) {
    return undefined;
  }

  const image = c3dCache.getImage(imageId);
  return image && image.voxelManager ? image.voxelManager.getScalarData() : undefined;
}


// ---------------------------------------------------------------------------------------------
// Legacy -> Cornerstone3D
// ---------------------------------------------------------------------------------------------

function _modifiedStackSlices(registration, currentStackIndex) {
  // Which stack slices a brush stroke touched.

  const modified = new Set();
  const labelmaps2D = (registration.labelmap3D && registration.labelmap3D.labelmaps2D) || [];

  for (let i = 0; i < labelmaps2D.length; i++) {
    const labelmap2D = labelmaps2D[i];
    if (!labelmap2D) {
      continue;
    }

    if (registration.marks[i] !== labelmap2D.segmentsOnLabelmap) {
      registration.marks[i] = labelmap2D.segmentsOnLabelmap;
      modified.add(i);
    }
  }

  // The slice under the cursor, always: a stroke that changes voxels without changing which
  // segments are present on the slice leaves the mark identity alone in principle, and this is the
  // slice every single-slice tool paints.
  if (_.isNumber(currentStackIndex) && currentStackIndex >= 0) {
    modified.add(currentStackIndex);
  }

  return [...modified];
}


export function pushLegacyLabelmapModified(segmentationId, stackSlices) {
  // Carry a legacy edit into Cornerstone3D (FR-2). Exported so a caller that knows exactly which
  // slices it changed can say so rather than going through the event.

  const registration = _registrations.get(segmentationId);
  if (!registration || registration.inBridge) {
    return [];
  }

  const volumeSlices = _.uniq(_.filter(
    _.map(stackSlices, (stackIndex) => registration.sliceMap[stackIndex]),
    (volumeIndex) => volumeIndex >= 0));

  if (!volumeSlices.length) {
    return [];
  }

  const { scalarData, sliceLength } = registration;

  registration.inBridge = true;
  try {
    _.each(volumeSlices, (volumeIndex) => {
      const stackIndex = registration.inverseMap.get(volumeIndex);
      const source = stackIndex === undefined
        ? undefined
        : _legacySliceView(registration, stackIndex);
      if (!source) {
        return;
      }

      // The canonical voxels always take the edit, whether or not a volumetric view is open --
      // the classic viewport can be the only thing showing the series. The legacy view carries
      // only canonical (already remapped, sub-256) values, so this narrowing set is lossless.
      // While a session is attached the display volume reads this same array through the stack
      // images, so this one write is also the display write.
      scalarData
        .subarray(volumeIndex * sliceLength, (volumeIndex + 1) * sliceLength)
        .set(source);
    });

    // Marks each live display dirty and drives `performVolumeLabelmapUpdate`, which calls
    // `vtkOpenGLTexture.setUpdatedFrame(i)` for exactly these slices and then `imageData.modified()`
    // -- a partial texture re-upload rather than the whole volume (AR-4). Per DISPLAY: the CPU
    // write above is common (every display volume reads the same stack images), but each display
    // has its own vtkImageData and texture, reached through its own segmentation id -- including
    // a derived (lightbox) display that may be the ONLY one attached.
    _notifyDisplaysDataModified(registration, volumeSlices);
  } finally {
    registration.inBridge = false;
  }

  return volumeSlices;
}


// ---------------------------------------------------------------------------------------------
// Cornerstone3D -> legacy
// ---------------------------------------------------------------------------------------------

function _notifyDisplaysDataModified(registration, volumeSlices) {
  // Raise SEGMENTATION_DATA_MODIFIED for every LIVE display of this segmentation. The library's
  // own listener resolves each id's `representationData.Labelmap.volumeId` and marks that
  // volume's frames -- so the canonical id reaches the canonical display only, and each derived
  // display needs the same slice set under ITS id. The derived ids have no registration of their
  // own, so the bridge's listeners ignore the forwarded events; no echo is possible.

  if (registration.volume) {
    c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(
      registration.segmentationId, volumeSlices);
  }

  _.each([...registration.derivedDisplays.entries()], ([derivedSegmentationId, entry]) => {
    if (entry.volume) {
      c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(
        derivedSegmentationId, volumeSlices);
    }
  });
}


export function pullCornerstone3dLabelmapModified(segmentationId, volumeSlices) {
  // Carry a Cornerstone3D edit back to the legacy module (FR-3): recompute `segmentsOnLabelmap` for
  // the changed slices and redraw the classic viewports showing the series.

  const registration = _registrations.get(segmentationId);
  if (!registration || registration.inBridge || !registration.labelmap3D) {
    return [];
  }

  // An explicit list -- including an empty one -- is taken at its word. Only "no list at all" means
  // "every slice", per AR-4: a caller that raises a redraw without having changed any voxel (the
  // view's `triggerSegmentationUpdate`, `forceClearSegment` finding nothing to repair) passes `[]`
  // so this does not sweep a 1,600-slice labelmap recomputing `segmentsOnLabelmap`.
  const slices = volumeSlices || _.range(registration.slices);

  const touched = [];

  registration.inBridge = true;
  try {
    _.each(slices, (volumeIndex) => {
      const stackIndex = registration.inverseMap.get(volumeIndex);
      if (stackIndex === undefined) {
        return;
      }

      const pixelData = _legacySliceView(registration, stackIndex);
      if (!pixelData) {
        return;
      }

      const source = registration.volume
        ? _volumeSliceScalarData(registration, volumeIndex)
        : undefined;
      if (source) {
        // The display volume views the record's array, so the edit is already in the record; only
        // the legacy view has to follow.
        pixelData.set(source);
      }

      const labelmap2D = _ensureLegacyLabelmap2D(registration, stackIndex, pixelData);
      labelmap2D.segmentsOnLabelmap = getSegmentsOnPixelData(pixelData);

      // Record the new identity as already seen: this change came from Cornerstone3D, and the next
      // legacy event must not report it back as a legacy edit (AR-3).
      registration.marks[stackIndex] = labelmap2D.segmentsOnLabelmap;
      touched.push(stackIndex);
    });

    // Only when a slice was actually re-read. A redraw signal that named no slice changed nothing
    // in the legacy labelmap, and repainting the classic viewports for it is wasted work.
    //
    // `segmentsOnLabelmap` has changed for those slices, which is what the panel's segment list is
    // built from, so the panel is woken too.
    if (touched.length) {
      _updateLegacyElements(registration, { notifyPanel: true });
    }
  } finally {
    registration.inBridge = false;
  }

  return touched;
}


function _updateLegacyElements(registration, options) {
  // Redraw every classic viewport showing this series. `updateImage` throws on an element with no
  // image yet, which is a normal state during layout changes.

  // @input options.notifyPanel (bool): also wake `SegmentationPanel`, which holds React state of
  //   its own that repainting a canvas does not refresh

  options = options || {};

  _.each(_enabledElementsForSeries(registration), (element) => {
    try {
      cornerstone.updateImage(element);
    } catch (error) {
      // Not worth a log line per slice per stroke; the element redraws itself when its image lands.
    }
  });

  if (options.notifyPanel) {
    _notifyLegacyPanel(registration);
  }
}


function _notifyLegacyPanel(registration) {
  // Make `SegmentationPanel` re-read the legacy segmentation state (FR-3, V-2, V-3).
  //
  // `cornerstone.updateImage` repaints canvases; it does nothing for the panel, which keeps its
  // segment list in React state and only rebuilds it from `refreshSegmentations()`. The panel's own
  // per-element listener cannot help -- it is bound to a misspelling the library never emits (#140)
  // -- so a document-level event is the only route to an already-open panel.
  //
  // Raised while `inBridge` is set (after an edit), so a panel refresh cannot be read back as a
  // legacy edit, and after a removal moved the series' active labelmap. The panel's own handler
  // re-reads state and calls setState; it raises nothing further.

  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') {
    return;
  }

  document.dispatchEvent(new CustomEvent(LEGACY_LABELMAP_STATE_EVENT, {
    detail: {
      segmentationId: registration.segmentationId,
      firstImageId: registration.firstImageId,
      labelmapIndex: registration.labelmapIndex,
      source: 'labelmapBridge',
    },
  }));
}


function _enabledElementsForSeries(registration) {
  return _.filter(
    _.map(cornerstone.getEnabledElements() || [], (enabled) => enabled.element),
    (element) => element && _firstImageIdForElement(element) === registration.firstImageId);
}


function _firstImageIdForElement(element) {
  const stackState = cornerstoneTools.getToolState(element, 'stack');
  const stackData = stackState && stackState.data && stackState.data[0];

  return stackData && stackData.imageIds ? stackData.imageIds[0] : undefined;
}


// ---------------------------------------------------------------------------------------------
// Metadata mirror, Cornerstone3D -> legacy (FR-4)
// ---------------------------------------------------------------------------------------------

function _writeLegacySegmentColor(registration, segmentIndex, color) {
  const { labelmap3D } = registration;
  const colorLutTables = segmentationModule.state.colorLutTables || {};
  const colorLUT = labelmap3D ? colorLutTables[labelmap3D.colorLUTIndex] : undefined;

  if (!colorLUT || !color) {
    return;
  }

  colorLUT[segmentIndex] = [...color];
  _updateLegacyElements(registration, { notifyPanel: true });
}


function _writeLegacySegmentAdded(registration, segmentIndex, config) {
  // Create the legacy state for a segment added on the Cornerstone3D side (§5.2 SEGMENT_ADDED), so
  // `SegmentationPanel` lists it with the right label, colour and visibility.
  //
  // Idempotent, and safe to run after the `SEGMENTATION_MODIFIED` mirror has already created a
  // bare entry: it fills in rather than replaces.

  const { labelmap3D } = registration;
  if (!labelmap3D || registration.inBridge || !segmentIndex) {
    return;
  }

  config = config || {};

  registration.inBridge = true;
  try {
    const metadata = labelmap3D.metadata;
    if (metadata && _.isArray(metadata.data)) {
      const entry = metadata.data[segmentIndex] || { SegmentNumber: segmentIndex };
      if (config.label) {
        entry.SegmentLabel = config.label;
      } else if (!entry.SegmentLabel) {
        entry.SegmentLabel = `Segment ${segmentIndex}`;
      }
      metadata.data[segmentIndex] = entry;
    }

    labelmap3D.segmentsHidden[segmentIndex] = config.visibility === false;

    if (config.color) {
      const colorLUT = (segmentationModule.state.colorLutTables || {})[labelmap3D.colorLUTIndex];
      if (colorLUT) {
        colorLUT[segmentIndex] = [...config.color];
      }
    }

    registration.knownSegments.add(segmentIndex);
    _updateLegacyElements(registration, { notifyPanel: true });
  } finally {
    registration.inBridge = false;
  }
}


function _mirrorCornerstone3dMetadataToLegacy(registration) {
  // Labels, the active segment and segment removal, read back off the Cornerstone3D segmentation.
  // `SegmentationPanel` reads `labelmap3D.metadata.data`, `labelmap3D.activeSegmentIndex` and
  // `labelmap3D.segmentsHidden`, so those are the fields written.
  //
  // Segment LOCK is deliberately absent here and everywhere else in this module. Lock is
  // Cornerstone3D editing state, owned by `SegmentationService` / Cornerstone3D `segmentLocking`;
  // it is not part of the legacy `labelmap3D`, and the classic panel and tools neither represent
  // nor enforce it (#136 FR-4, as re-scoped in !87 note 37445). Keeping lock consistent across the
  // Cornerstone3D representations -- the primary labelmap and the editor's `vol3d:` -- belongs to
  // the editor, which does it through the service in `SegmentationEditorLayout`.

  const { labelmap3D, segmentationId } = registration;
  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);

  if (!labelmap3D || !segmentation) {
    return;
  }

  const segments = segmentation.segments || {};
  const metadata = labelmap3D.metadata;
  const present = new Set(
    _.map(_.filter(_.values(segments), Boolean), (segment) => segment.segmentIndex));

  // The dcmjs adapter stores segment metadata as `metadata.data`, indexed by segment number. The
  // legacy library's own `deleteSegment` assumes `metadata` IS that array; it is not, in this
  // viewer, so entries are removed where `SegmentationPanel` actually reads them.
  //
  // Removal is decided against the previous snapshot rather than against "absent from
  // Cornerstone3D": the segmentation's `segments` config is built from the segment indices found in
  // the voxels, so a segment a SEG declares but never paints is legitimately absent from it and
  // must not have its legacy metadata deleted.
  if (metadata && _.isArray(metadata.data)) {
    _.each([...(registration.knownSegments || [])], (segmentIndex) => {
      if (!present.has(segmentIndex) && metadata.data[segmentIndex]) {
        delete metadata.data[segmentIndex];
      }
    });

    _.each(_.values(segments), (segment) => {
      if (!segment) {
        return;
      }

      const segmentIndex = segment.segmentIndex;
      const entry = metadata.data[segmentIndex];

      // SEGMENT_ADDED (§5.2): a segment created on the Cornerstone3D side has no legacy metadata
      // at all, and without an entry `SegmentationPanel` cannot list it -- `getSegmentList` reads
      // `metadata.data[segmentIndex]` for the number and the label. Created in the shape the panel
      // reads, and only for a genuinely NEW index: an index already known but carrying no entry is
      // one the SEG declared without painting, which the panel deliberately leaves out.
      if (!entry) {
        if (!registration.knownSegments.has(segmentIndex)) {
          metadata.data[segmentIndex] = {
            SegmentNumber: segmentIndex,
            SegmentLabel: segment.label || `Segment ${segmentIndex}`,
          };
          labelmap3D.segmentsHidden[segmentIndex] = false;
        }
        return;
      }

      // Only a label that is already displayed is rewritten. An entry the SEG left unlabelled is
      // filtered out of the panel's list entirely, and the Cornerstone3D side's stand-in
      // ("Segment 3") would silently add it.
      if (entry.SegmentLabel && segment.label && segment.label !== entry.SegmentLabel) {
        entry.SegmentLabel = segment.label;
      }
    });
  }

  registration.knownSegments = present;

  const activeSegment = _.find(_.values(segments), (segment) => segment && segment.active);
  if (activeSegment && labelmap3D.activeSegmentIndex !== activeSegment.segmentIndex) {
    labelmap3D.activeSegmentIndex = activeSegment.segmentIndex;
  }
}


function _mirrorCornerstone3dVisibilityToLegacy(registration, viewportId) {
  const { labelmap3D, segmentationId } = registration;
  if (!labelmap3D) {
    return;
  }

  const representations = c3dSegmentations.state.getSegmentationRepresentations(
    viewportId, { segmentationId }) || [];

  _.each(representations, (representation) => {
    _.each(representation.segments || {}, (segment, segmentIndex) => {
      const index = Number(segmentIndex);
      if (!index || !segment) {
        return;
      }
      labelmap3D.segmentsHidden[index] = !segment.visible;
    });
  });

  // A visibility change on a canonical viewport follows into the derived (lightbox)
  // representations too, through the segmentsHidden state just updated.
  _applyVisibilityToDerived(registration);

  _updateLegacyElements(registration, { notifyPanel: true });
}


// ---------------------------------------------------------------------------------------------
// Listener wiring
// ---------------------------------------------------------------------------------------------

function _onLegacyLabelmapModified(event) {
  const element = event.currentTarget;
  const detail = event.detail || {};

  const firstImageId = _firstImageIdForElement(element);
  if (!firstImageId) {
    return;
  }

  const brushStackState = segmentationModule.state.series[firstImageId];
  const labelmapIndex = detail.labelmapIndex === undefined
    ? brushStackState && brushStackState.activeLabelmapIndex
    : detail.labelmapIndex;

  const registration = _registrations.get(`${firstImageId}_${labelmapIndex}`);
  if (!registration || registration.inBridge) {
    return;
  }

  const stackState = cornerstoneTools.getToolState(element, 'stack');
  const currentStackIndex = stackState && stackState.data && stackState.data[0]
    ? stackState.data[0].currentImageIdIndex
    : undefined;

  pushLegacyLabelmapModified(
    registration.segmentationId, _modifiedStackSlices(registration, currentStackIndex));
}


function _onCornerstone3dDataModified(event) {
  // Events raised by this module's own teardown are not user edits.
  {
    const _retiringCheck = _registrations.get((event.detail || {}).segmentationId);
    if (_retiringCheck && _retiringCheck.retiring) {
      return;
    }
  }

  const { segmentationId, modifiedSlicesToUse } = event.detail || {};

  const registration = _registrations.get(segmentationId);
  if (registration && !registration.inBridge) {
    pullCornerstone3dLabelmapModified(segmentationId, modifiedSlicesToUse);

    // A canonical edit (a Cornerstone3D tool on the canonical display) must also reach every
    // derived display's texture. Push-originated events arrive with `inBridge` set and were
    // forwarded by the push itself; forwarded derived-id events have no registration and fall
    // through above.
    _.each([...registration.derivedDisplays.entries()], ([derivedSegmentationId, entry]) => {
      if (entry.volume) {
        c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(
          derivedSegmentationId, modifiedSlicesToUse);
      }
    });
  }
}


function _refreshDerivedSegments(registration) {
  // Keep every live derived display's segment identity in step with the canonical segmentation.
  // The clone made at attach is a snapshot; a canonical label rename, segment add or segment
  // removal while a derived view (the lightbox) is open re-clones here, driven by the canonical
  // SEGMENTATION_MODIFIED events.

  const canonical = c3dSegmentations.state.getSegmentation(registration.segmentationId);
  if (!canonical) {
    return;
  }

  _.each([...registration.derivedDisplays.keys()], (derivedSegmentationId) => {
    const derived = c3dSegmentations.state.getSegmentation(derivedSegmentationId);
    if (!derived) {
      return;
    }

    const segments = {};
    _.each(_.values(canonical.segments || {}), (segment) => {
      if (segment) {
        segments[segment.segmentIndex] = { ...segment };
      }
    });

    // Through the supported state route, not direct assignment: `updateSegmentations` commits via
    // the state manager and emits SEGMENTATION_MODIFIED for the DERIVED id, which is what drives
    // the library's render path for an already-open lightbox. `SegmentationService` absorbs the
    // event (the entry is display-only) and this module's own listener ignores it (no
    // registration under the derived id), so nothing echoes.
    c3dSegmentations.updateSegmentations([{
      segmentationId: derivedSegmentationId,
      payload: { segments },
    }]);
  });
}


function _onCornerstone3dSegmentationModified(event) {
  // Events raised by this module's own teardown are not user edits.
  {
    const _retiringCheck = _registrations.get((event.detail || {}).segmentationId);
    if (_retiringCheck && _retiringCheck.retiring) {
      return;
    }
  }

  const { segmentationId } = event.detail || {};
  const registration = _registrations.get(segmentationId);

  if (!registration || registration.inBridge) {
    return;
  }

  registration.inBridge = true;
  try {
    _mirrorCornerstone3dMetadataToLegacy(registration);
    _refreshDerivedSegments(registration);

    // The segment list the panel renders is built from the fields just written, and the panel does
    // not observe them; it has to be told.
    _notifyLegacyPanel(registration);
  } finally {
    registration.inBridge = false;
  }
}


function _onCornerstone3dRepresentationModified(event) {
  // Events raised by this module's own teardown are not user edits.
  {
    const _retiringCheck = _registrations.get((event.detail || {}).segmentationId);
    if (_retiringCheck && _retiringCheck.retiring) {
      return;
    }
  }

  const { segmentationId, viewportId } = event.detail || {};
  const registration = _registrations.get(segmentationId);

  if (!registration || registration.inBridge || !viewportId) {
    return;
  }

  registration.inBridge = true;
  try {
    _mirrorCornerstone3dVisibilityToLegacy(registration, viewportId);
  } finally {
    registration.inBridge = false;
  }
}


function _onLegacyMetadataModified() {
  // A panel-side edit reached the legacy labelmap directly (T3 / FR-4 / V-3).
  //
  // `SegmentationPanel` writes `labelmap3D.activeSegmentIndex` and `labelmap3D.segmentsHidden` in
  // place and then repaints the canvases; there is no legacy event for it, so the panel raises
  // this one. Every registration is re-mirrored rather than the event carrying an identity: the
  // mirror is metadata only -- no voxel work -- and there are at most a handful of registrations.

  _.each([..._registrations.keys()], (segmentationId) => {
    const registration = _registrations.get(segmentationId);
    if (registration && !registration.inBridge) {
      mirrorLegacyMetadataToCornerstone3d(segmentationId);
    }
  });
}


function _onCornerstone3dSegmentationRemoved(event) {
  // The segmentation entry was removed from Cornerstone3D state.
  //
  // When this module's own retire did it, it is lifecycle noise -- the record and the legacy view
  // live on, and the next attach materialises a fresh generation. Anything else is a REAL removal
  // (an explicit `SegmentationService` delete), and the whole segmentation goes with it (FR-8).

  const { segmentationId } = event.detail || {};
  const registration = _registrations.get(segmentationId);

  if (!registration || registration.retiring) {
    return;
  }

  removeCanonicalSegmentation(segmentationId);
}


function _bindElement(element) {
  if (!element || _boundElements.has(element)) {
    return;
  }

  const handler = (event) => _onLegacyLabelmapModified(event);
  element.addEventListener(LABELMAP_MODIFIED, handler);
  _boundElements.set(element, handler);
}


function _unbindElement(element) {
  const handler = _boundElements.get(element);
  if (!handler) {
    return;
  }

  element.removeEventListener(LABELMAP_MODIFIED, handler);
  _boundElements.delete(element);
}


function _ensureGlobalListeners() {
  if (_globalListeners) {
    return;
  }

  const onElementEnabled = (event) => _bindElement(event.detail && event.detail.element);
  const onElementDisabled = (event) => _unbindElement(event.detail && event.detail.element);

  cornerstone.events.addEventListener(cornerstone.EVENTS.ELEMENT_ENABLED, onElementEnabled);
  cornerstone.events.addEventListener(cornerstone.EVENTS.ELEMENT_DISABLED, onElementDisabled);

  const onLegacyMetadataModified = () => _onLegacyMetadataModified();
  if (typeof document !== 'undefined') {
    document.addEventListener(LEGACY_METADATA_MODIFIED_EVENT, onLegacyMetadataModified);
  }

  const onDataModified = (event) => _onCornerstone3dDataModified(event);
  const onSegmentationModified = (event) => _onCornerstone3dSegmentationModified(event);
  const onRepresentationModified = (event) => _onCornerstone3dRepresentationModified(event);
  const onSegmentationRemoved = (event) => _onCornerstone3dSegmentationRemoved(event);

  const { Events } = c3dToolsEnums;
  c3dEventTarget.addEventListener(Events.SEGMENTATION_DATA_MODIFIED, onDataModified);
  c3dEventTarget.addEventListener(Events.SEGMENTATION_MODIFIED, onSegmentationModified);
  c3dEventTarget.addEventListener(
    Events.SEGMENTATION_REPRESENTATION_MODIFIED, onRepresentationModified);
  c3dEventTarget.addEventListener(Events.SEGMENTATION_REMOVED, onSegmentationRemoved);

  _globalListeners = {
    onElementEnabled,
    onElementDisabled,
    onLegacyMetadataModified,
    onDataModified,
    onSegmentationModified,
    onRepresentationModified,
    onSegmentationRemoved,
  };

  _.each(cornerstone.getEnabledElements() || [], (enabled) => _bindElement(enabled.element));
}


function _teardownGlobalListeners() {
  if (!_globalListeners) {
    return;
  }

  cornerstone.events.removeEventListener(
    cornerstone.EVENTS.ELEMENT_ENABLED, _globalListeners.onElementEnabled);
  cornerstone.events.removeEventListener(
    cornerstone.EVENTS.ELEMENT_DISABLED, _globalListeners.onElementDisabled);

  if (typeof document !== 'undefined') {
    document.removeEventListener(
      LEGACY_METADATA_MODIFIED_EVENT, _globalListeners.onLegacyMetadataModified);
  }

  const { Events } = c3dToolsEnums;
  c3dEventTarget.removeEventListener(
    Events.SEGMENTATION_DATA_MODIFIED, _globalListeners.onDataModified);
  c3dEventTarget.removeEventListener(
    Events.SEGMENTATION_MODIFIED, _globalListeners.onSegmentationModified);
  c3dEventTarget.removeEventListener(
    Events.SEGMENTATION_REPRESENTATION_MODIFIED, _globalListeners.onRepresentationModified);
  c3dEventTarget.removeEventListener(
    Events.SEGMENTATION_REMOVED, _globalListeners.onSegmentationRemoved);

  _.each([..._boundElements.keys()], (element) => _unbindElement(element));

  _globalListeners = null;
}
