import _ from 'lodash';

import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
  init as c3dCoreInit,

  ImageVolume as C3dImageVolume, 
  Enums as C3dEnums,
  volumeLoader as c3dVolumeLoader,
  cache as c3dCache,
  eventTarget as c3dEventTarget,
  metaData as c3dMetaData,
  canRenderFloatTextures as c3dCanRenderFloatTextures,
  getRenderingEngines,
  getWebWorkerManager as c3dGetWebWorkerManager,
} from '@cornerstonejs/core';
import triggerEvent from '@cornerstonejs/core/utilities/triggerEvent';

import {
  init as c3dToolsInit,
  
  // Annotation management
  annotation as c3dAnnotations,

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import OHIF from '@ohif/core';

const { Events: c3dEvents } = C3dEnums;

import { init as c3dDcmImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';
import { init as c3dPolySegInit } from '@cornerstonejs/polymorphic-segmentation';



// Add reference to initCornerstone3d to preserve backwards compatibility
export const initCornerstone3d = OHIF.utils.cornerstone3dUtils.initCornerstone3d;


export const gridReferenceLineColors = {
  red: 'rgba(255, 0, 0, 0.2)',
  green: 'rgba(0, 255, 0, 0.2)',
  yellow: 'rgba(255, 255, 0, 0.2)',
  default: 'rgba(255, 255, 255, 0.3)', // fallback (white)
}


export function vtkVolume2vtkImage(vtkImg) {
  // Ensure that the input value is a vtkImage instance. If a vtkVolume is provided, convert
  // to a vtkImage and returns.

  // @input vtkImg (vtkImg or vtkVolume): object to check and convert
  // @returns vtkImg

  // Check input type and convert to vtkImg
  if (!vtkImg.getClassName() != 'vtkImageData') {
    if (vtkImg.getClassName() == 'vtkVolume') {
      vtkImg = vtkImg.getMapper().getInputData();
    }
  }

  // Ensure that the image it an instance of vtkImageData
  if (vtkImg.getClassName() != 'vtkImageData') {
    throw new Error('Unable to convert img to Cornerstone image, invalid type: '+vtkImg.getClassName());
  }

  return vtkImg;
}


// Volume-loader schemes. The scheme is the substring before the first
// colon of a volumeId and is what `volumeLoader.loadVolumeFromVolumeLoader` uses to pick the loader,
// so the decimated navigation volume needs a scheme of its own -- a `#decimated` suffix alone would
// still route to the full-resolution streaming loader. Both are registered in the cornerstone
// extension's `initDataIntegrations`.
export const VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';
export const DECIMATED_VOLUME_LOADER_SCHEME = 'cornerstoneDecimatedImageVolume';

// Marker kept on the decimated id so it is self-describing in logs and in the cache listing.
const DECIMATED_SUFFIX = '#decimated';

// A Cornerstone3D volume owns exactly ONE vtkOpenGLTexture (`ImageVolume` constructs it), and
// `vtkOpenGLTexture.render()` reassigns that texture's `_openGLRenderWindow` to whichever window is
// drawing it. So a volume cannot be displayed from two WebGL contexts at once: the second binding
// steals the texture, and when that context is torn down the first renders through a dead render
// window (`model._textureResourceIds is undefined`). Contexts are pooled per viewport
// (`webGlContextCount` defaults to 7), so this is not avoidable by sharing a rendering engine.
//
// Surfaces that render a series in their own context therefore need their own volume id. That is
// cheap for a streaming volume: `ImageVolume` holds no CPU scalar array, and the per-slice images
// are already decoded in the shared image cache, so the second volume costs a GPU texture and
// almost no CPU memory.
const VIEW_SUFFIXES = {
  inspection: '::inspection',
};


export function getVolumeIdForDisplaySet(displaySet, options) {
  // The single place a volume id is derived from a display set. Every consumer -- the MPR panes,
  // the inspection modal, the 3D viewer, the segmentation editor's `vol3d:` labelmap ids -- must
  // go through this, so that views sharing a rendering engine agree on one cache entry per series
  // and a view that needs its own (see `options.view`) gets a predictable id rather than an
  // ad-hoc one.

  // @input displaySet (object|str): a display set, or a displaySetInstanceUID
  // @input options.decimated (bool): return the id of the reduced-resolution navigation volume
  // @input options.view (str): a surface that renders in its own WebGL context and so needs its
  //   own volume (see VIEW_SUFFIXES). Omit for the display set's primary volume.

  options = options || {};

  const uid = _.isString(displaySet) ? displaySet : displaySet?.displaySetInstanceUID;
  if (!uid) {
    return undefined;
  }

  const viewSuffix = options.view ? VIEW_SUFFIXES[options.view] || '' : '';
  const scheme = options.decimated ? DECIMATED_VOLUME_LOADER_SCHEME : VOLUME_LOADER_SCHEME;
  const decimatedSuffix = options.decimated ? DECIMATED_SUFFIX : '';

  // The scheme is everything before the FIRST colon, which is what the volume loader dispatches
  // on, so the suffixes are safe to append.
  return `${scheme}:${uid}${viewSuffix}${decimatedSuffix}`;
}


export function isDecimatedVolumeId(volumeId) {
  // True when the volume id refers to a reduced-resolution navigation volume
  return _.isString(volumeId) && volumeId.endsWith(DECIMATED_SUFFIX);
}


function _sampleIndices(length) {
  // First, middle and last, the same three slices `_determineDataType` inspects upstream
  return _.uniq([0, Math.floor(length / 2), Math.max(0, length - 1)]);
}


export function estimateVolumeShape(imageIds) {
  // Work out the dimensions and data type a streaming volume built from these imageIds WOULD have,
  // without creating it. This mirrors the inputs of Cornerstone3D's
  // `generateVolumePropsFromImageIds` / `_determineDataType`, reading the same metadata modules; it
  // exists because the fit assessment has to happen before any allocation.

  // @input imageIds (str[]): the stack's imageIds
  // @returns { dimensions: [x, y, z], dataType }

  if (!imageIds || !imageIds.length) {
    return { dimensions: [0, 0, 0], dataType: 'Int16Array' };
  }

  const plane = c3dMetaData.get('imagePlaneModule', imageIds[0]) || {};
  const pixel = c3dMetaData.get('imagePixelModule', imageIds[0]) || {};

  const columns = plane.columns || pixel.columns || 0;
  const rows = plane.rows || pixel.rows || 0;
  const dimensions = [Math.floor(columns), Math.floor(rows), imageIds.length];

  // Rescale values decide between the signed, unsigned and float 16-bit paths upstream.
  const rescale = _sampleIndices(imageIds.length)
    .map(i => c3dMetaData.get('modalityLutModule', imageIds[i]) || {});

  const hasNegativeRescale = rescale.some(
    m => m.rescaleIntercept < 0 || m.rescaleSlope < 0);
  const floatAfterScale = rescale.some(
    m => (m.rescaleIntercept !== undefined && !Number.isInteger(Number(m.rescaleIntercept)))
      || (m.rescaleSlope !== undefined && !Number.isInteger(Number(m.rescaleSlope))));

  const signed = Number(pixel.pixelRepresentation) === 1;

  let dataType;
  switch (Number(pixel.bitsAllocated)) {
    case 8:
    case 24:
      dataType = 'Uint8Array';
      break;
    case 16:
      if (c3dCanRenderFloatTextures() && floatAfterScale) {
        dataType = 'Float32Array';
      } else if (signed || hasNegativeRescale) {
        dataType = 'Int16Array';
      } else {
        dataType = 'Uint16Array';
      }
      break;
    case 32:
      dataType = 'Float32Array';
      break;
    default:
      // Unknown bit depth: assume 16-bit signed, which is the common case and never
      // under-estimates the texture cost of an 8-bit series.
      dataType = 'Int16Array';
  }

  return { dimensions, dataType };
}


export function assessDisplaySetVolumeFit(imageIds) {
  // Decide, before allocating anything, whether the volume this stack would produce fits the
  // client's GPU, via `gpuCapabilities.assessVolumeFit`. Returns the assessment together with
  // the shape it was made against.

  const { dimensions, dataType } = estimateVolumeShape(imageIds);
  const assessment = OHIF.utils.gpuCapabilities.assessVolumeFit({ dimensions, dataType });

  return { ...assessment, dimensions, dataType };
}


export function suggestDecimationAfterFailure(fit) {
  // Work out a decimation for a volume the client accepted at pre-flight but then failed to
  // allocate. The budget is halved and the assessment re-run, which gives
  // the smallest decimation that brings the volume to half the size the client just refused --
  // rather than an arbitrary factor, and never a second attempt at full resolution.

  if (!fit || !fit.dimensions || !fit.textureBytes) {
    return null;
  }

  const retry = OHIF.utils.gpuCapabilities.assessVolumeFit({
    dimensions: fit.dimensions,
    dataType: fit.dataType,
    budgetBytes: Math.floor(fit.textureBytes / 2),
  });

  return retry.suggestedDecimation;
}


export async function createImageVolumeForDisplaySet({ imageIds, displaySet, fit, volumeIdOptions }) {
  // Create (or reuse) the Cornerstone3D streaming volume for a display set. This is the ONLY
  // constructor for imaging volumes: `createLocalVolume` is reserved for labelmaps. Callers must have taken a `volumeLease` for the returned id.
  //
  // On a failing pre-flight the reduced-resolution navigation volume is built instead, through
  // Cornerstone3D's `decimatedVolumeLoader`, using the decimation the assessment suggested.

  // @input imageIds (str[]): the stack's imageIds, in stack order (the loader re-sorts by position)
  // @input displaySet (object): the display set the volume belongs to
  // @input fit (object): the `assessDisplaySetVolumeFit` result
  // @input volumeIdOptions (object): extra `getVolumeIdForDisplaySet` options, e.g. the `view`
  //   discriminator a surface with its own WebGL context needs
  // @returns { volumeId, volume, decimated }

  const decimation = fit && !fit.fits && fit.suggestedDecimation ? fit.suggestedDecimation : null;
  const volumeId = getVolumeIdForDisplaySet(displaySet, {
    ...(volumeIdOptions || {}),
    decimated: !!decimation,
  });

  const cached = c3dCache.getVolume(volumeId);
  if (cached) {
    return { volumeId, volume: cached, decimated: !!decimation };
  }

  // `decimatedVolumeLoader` rewrites `options.imageIds` in place, so it gets its own copy.
  const options = decimation
    ? { imageIds: [...imageIds], ijkDecimation: decimation }
    : { imageIds };

  const volume = await c3dVolumeLoader.createAndCacheVolume(volumeId, options);
  return { volumeId, volume, decimated: !!decimation };
}


// Reference counting for image volumes. One volume per rendering engine is shared by every
// viewport within it -- the three MPR panes share one, as do the 3D viewer and the editor's own
// views -- so no single view may decide to evict it. The inspection modal renders in its own
// WebGL context and so holds a lease on its own volume; a Cornerstone3D `ImageVolume` owns exactly
// one texture, which cannot be bound to two contexts at once (see VIEW_SUFFIXES above). Its slices
// are still the shared image-cache entries, so the extra cost is one GPU texture rather than a
// second copy of the series. Same shape as the reference-counted m3dCacheService introduced for
// M3D geometry in !58.
const _volumeLeases = new Map();


export function isCanonicalSegmentation(segmentation) {
  // True for a segmentation the viewer owns as CANONICAL state -- the record the labelmap bridge
  // created at import and that `SegmentationService` hands out -- as opposed to a derived or
  // disposable one (the editor's `vol3d:`, anything a viewport built for itself).
  //
  // The flag lives on the Cornerstone3D segmentation's `cachedStats`, so this reads it out of
  // Cornerstone3D state rather than importing the bridge.

  // @input segmentation (object|str): a segmentation record, or a segmentationId

  const record = _.isString(segmentation)
    ? c3dSegmentations.state.getSegmentation(segmentation)
    : segmentation;

  return !!(record && (record.cachedStats || {}).sonadorCanonicalSegmentation);
}


function _releaseDerivedSegmentations(volumeUid) {
  // Remove the segmentations (and their labelmap volumes) DERIVED from this image volume.
  //
  // A canonical segmentation is never one of them. It outlives every view of it and every image
  // volume lease (#136 FR-8): closing the last MPR pane must not destroy the segmentation the
  // classic viewport, the panel and a future serializer still read. Only an explicit product-level
  // removal (`removeCanonicalSegmentation` / `SegmentationService`) destroys one.

  _.each(getVolumeSegmentations(volumeUid), (s) => {
    if (isCanonicalSegmentation(s)) {
      return;
    }

    c3dSegmentations.state.removeSegmentation(s.segmentationId);

    const _segvol_id = s.representationData?.Labelmap?.volumeId;
    if (_segvol_id && c3dCache.getVolumeLoadObject(_segvol_id)) {
      c3dCache.removeVolumeLoadObject(_segvol_id);
    }
  });
}


function _reclaimSharedCacheKeys(removedVolumeId) {
  // Cornerstone3D 4.22.13 protects a volume's slice images from LRU eviction with a
  // `sharedCacheKey` on the cached image, and it manages that key per volume rather than by
  // reference count: `_putVolumeCommon` stamps every slice with the id of the volume that has just
  // finished loading, and `_decacheVolume` clears the stamp from every slice still naming the
  // volume being removed.
  //
  // Two volumes over the same imageIds therefore pass the protection between them. A view that
  // needs its own volume id loads second, so it takes the stamp from the volume already displaying
  // the series; removing it then clears the stamp outright and leaves the first volume live,
  // leased, and rendering slices that nothing protects. Unstamped images are precisely what
  // `decacheIfNecessaryUntilBytesAvailable` evicts first, so those panes would start losing slices
  // under cache pressure.
  //
  // Re-stamp any slice left unprotected against a volume that still holds a lease. There is no
  // public setter for a cached image's shared key, so this reaches the cache's image map; the
  // access is guarded, so a library change makes this a no-op rather than a crash.
  const imageCache = c3dCache && c3dCache._imageCache;
  if (!imageCache || typeof imageCache.get !== 'function') {
    return 0;
  }

  let restamped = 0;

  _.each([..._volumeLeases.keys()], (volumeId) => {
    if (volumeId === removedVolumeId) {
      return;
    }

    const volume = c3dCache.getVolume(volumeId);

    _.each((volume && volume.imageIds) || [], (imageId) => {
      const cachedImage = imageCache.get(imageId);
      if (cachedImage && !cachedImage.sharedCacheKey) {
        cachedImage.sharedCacheKey = volumeId;
        restamped += 1;
      }
    });
  });

  return restamped;
}

export const volumeLease = {

  acquire(volumeId) {
    // Register a holder of the volume. Returns the new hold count.
    if (!volumeId) {
      return 0;
    }

    const count = (_volumeLeases.get(volumeId) || 0) + 1;
    _volumeLeases.set(volumeId, count);
    return count;
  },

  release(volumeId, options) {
    // Give up a hold. The volume is evicted only when the last holder lets go.
    options = options || {};
    _.defaults(options, { annotations: true, segmentations: true });

    if (!volumeId || !_volumeLeases.has(volumeId)) {
      return 0;
    }

    const remaining = _volumeLeases.get(volumeId) - 1;
    if (remaining > 0) {
      _volumeLeases.set(volumeId, remaining);
      return remaining;
    }

    _volumeLeases.delete(volumeId);

    if (options.annotations) {
      _.each(getVolumeAnnotations(volumeId), (a) => {
        c3dAnnotations.state.removeAnnotation(a.annotationUID);
      });
    }

    if (options.segmentations) {
      _releaseDerivedSegmentations(volumeId);
    }

    // removeVolumeLoadObject deletes the vtkImageData, which is what actually returns the memory,
    // and clears the slice images' sharedCacheKey so they can age out of the LRU normally. That
    // last part is only correct when no other live volume is still displaying those slices, so
    // hand the protection back to one that is.
    if (c3dCache.getVolumeLoadObject(volumeId)) {
      c3dCache.removeVolumeLoadObject(volumeId);
      _reclaimSharedCacheKeys(volumeId);
      triggerEvent(c3dEventTarget, C3dEnums.Events.VOLUME_CACHE_VOLUME_REMOVED, { volumeId });
    }

    return 0;
  },

  count(volumeId) {
    return _volumeLeases.get(volumeId) || 0;
  },

  releaseAll() {
    // Release every lease this session knows about, for the study viewer's unmount. Deliberately
    // not `cache.purgeCache()`: a global purge also destroys cache entries owned by other
    // subsystems (M3D geometry, segmentations).
    const volumeIds = [..._volumeLeases.keys()];
    _volumeLeases.clear();

    _.each(volumeIds, (volumeId) => {
      _.each(getVolumeAnnotations(volumeId), (a) => {
        c3dAnnotations.state.removeAnnotation(a.annotationUID);
      });
      _releaseDerivedSegmentations(volumeId);

      if (c3dCache.getVolumeLoadObject(volumeId)) {
        c3dCache.removeVolumeLoadObject(volumeId);
        triggerEvent(c3dEventTarget, C3dEnums.Events.VOLUME_CACHE_VOLUME_REMOVED, { volumeId });
      }
    });

    return volumeIds;
  },
};


// The stack-order/volume-order arithmetic lives in `labelmapOrder.js`, which the labelmap bridge
// also needs. Re-exported here because this module was its first home and the extension's public
// surface names it.
//
// `cacheVtkLabelmapImage` -- the one-way copy that turned a legacy labelmap into a Cornerstone3D
// Uint8 volume -- is gone (AR-6). The labelmap bridge supersedes it: Cornerstone3D holds the
// canonical stack-backed labelmap and the bridge derives the legacy compatibility copy from it.
export { mapLabelmapBufferToVolumeOrder, planSegmentValueRemap } from './labelmapOrder.js';


export function getVolumeAnnotations(volumeUid, options) {
  // Retrieve all comments for the provided volume UID

  options = options || {};

  return _.filter(c3dAnnotations.state.getAllAnnotations(), (a) => {
    const _meta = a.metadata || {};
    return _meta.volumeId == volumeUid;
  });
}


export function getVolumeSegmentations(volumeUid, options) {
  // Retrieve all segmentations for the provided volume UID

  options = options || {};  

  return _.filter(c3dSegmentations.state.getSegmentations(), (s) => {

    // Filter segmentation by reference volume UID within the representation data.
    //
    // Both spellings are accepted: this viewer has always written `referenceVolumeId`, while
    // Cornerstone3D's own `LabelmapSegmentationData` names the field `referencedVolumeId` (which is
    // what its GrowCut tools read). The bridge writes both, so a segmentation registered either way
    // is found here and released with its image volume (FR-8).
    const r = s.representationData || {};
    const labelmap = r.Labelmap || {};

    return r.referenceVolumeId == volumeUid
      || r.referencedVolumeId == volumeUid
      || labelmap.referenceVolumeId == volumeUid
      || labelmap.referencedVolumeId == volumeUid;
  });
}


export function inspectVtkLabelmapImage(labelmapData) {
  // Inspect a labelmap. Determine the segment count, number of unique labels, and the length of
  // the data. Accepts a vtkImage, or the raw labelmap scalars the viewport carries instead.

  // An absent labelmap is a caller error, but it must produce the clear message below rather than a
  // `getClassName of undefined` from the vtkImage branch.
  const scalarData = !labelmapData || ArrayBuffer.isView(labelmapData)
    ? labelmapData
    : vtkVolume2vtkImage(labelmapData).getPointData().getScalars().getData();

  if (!scalarData || scalarData.length === 0) {
    throw new Error('Unable to inspect the labelmap: its scalar data is absent or empty.');
  }

  // // Get unique labels (excluding 0 = background)
  const labelSet = new Set();
  for (let i = 0; i < scalarData.length; i++) {
    const label = scalarData[i];
    if (label !== 0) {
      labelSet.add(label);
    }
  }

  const segmentCount = labelSet.size;
  const uniqueLabels = [...labelSet];

  return { segmentCount, uniqueLabels, scalarData, length: scalarData.length }
}


export async function forceClearSegment(segmentationId, segmentIndex, options) {
  // Forcibly clear a segmentIndex from the provided segmentation, then verify that every slice is
  // actually clear of it and zero the ones that are not.

  // @input segmentationId (str): the segmentation to clear the segment from
  // @input segmentIndex (num): the segment to clear
  // @input options.checkOnly (bool): only verify and repair; the caller has already cleared
  // @input options.triggerEvent (bool): raise SEGMENTATION_DATA_MODIFIED for the changed slices
  // @returns the volume slice indices this call zeroed

  options = options || {};
  _.defaults(options, { checkOnly: false, recordHistory: true, triggerEvent: true, });

  // Remove segment from segmentation
  if (!options.checkOnly) {
    await c3dSegmentations.helpers.clearSegmentValue(segmentationId, segmentIndex, options);
  }

  // Ensure that the segmentation was cleared. The volume behind a segmentation carries a
  // per-generation volumeId, so it is resolved through the segmentation entry's own
  // representation data -- the route Cornerstone3D's internals take -- with a direct cache
  // lookup for callers that pass a literal volumeId (the editor's `vol3d:`).
  const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
  const _labelmapVolumeId =
    (_seg && _seg.representationData && _seg.representationData.Labelmap
      && _seg.representationData.Labelmap.volumeId) || segmentationId;
  const segVol = c3dCache.getVolume(_labelmapVolumeId);
  const modifiedSlices = [];

  if (segVol) {
    const scalarData = segVol.voxelManager.getCompleteScalarDataArray();

    // Count pixels for the segment index
    const _segment = Array.from(scalarData).filter(v => v === segmentIndex);
    if (_segment.length) {
      console.warn(`[vtk:cornerstone3d:utils] Found non-zero voxels for segmentIndex=${segmentIndex} count=${_segment.length}. `
        + 'Force zero segment layer.');

      segVol.imageIds.forEach((imageId, sliceIndex) => {
        // Iterate through all images of the volume and zero slices with non-zero segment values

        // Retrieve image/slice from cache
        const image = c3dCache.getImage(imageId);
        if (!image) {
          console.warn(`[vtk:cornerstone3d:utils] No cached image for slice segmentationId=${segmentationId} sliceIdx=${sliceIndex} imageId=${imageId}`);
          return;
        }

        // Retrieve slice scalar data
        const sliceData = image.voxelManager.getScalarData();
        let cleared = false;

        for (let i = 0; i < sliceData.length; i++) {
          if (sliceData[i] == segmentIndex) {
            sliceData[i] = 0;
            cleared = true;
          }
        }

        if (cleared) {
          modifiedSlices.push(sliceIndex);
        }
      });
    }

    // Invalidate the image volume (forces re-load and re-render)
    segVol.invalidate();
    if (options.triggerEvent) {
      // Slice-scoped (AR-4): the list names exactly the slices this repair pass zeroed. An empty
      // list is deliberate and is not the same as omitting one -- `invalidate()` above has already
      // marked every frame for re-upload, and an empty list tells the labelmap bridge there is
      // nothing to write back into the legacy labelmap rather than making it recompute
      // `segmentsOnLabelmap` for the whole series.
      c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(
        segmentationId, modifiedSlices);
    }
  }

  return modifiedSlices;
}


export function getCornerstone3dViewport(viewportId) {
  /**
   * Get a Cornerstone3D viewport by ID, searching across all registered rendering engines.
   *
   * cornerstoneViewportService (from @ohif/extension-cornerstone) only tracks viewports that
   * were created through OHIF's viewport grid. The Sonador volume viewer creates its rendering
   * engine directly via `new RenderingEngine(renderId)`, bypassing that service. Using
   * getRenderingEngines() from Cornerstone3D directly ensures the viewport is always found
   * regardless of how it was registered.
   *
   * @param {string} viewportId - The Cornerstone3D viewport ID to look up.
   * @returns {import('@cornerstonejs/core').Types.IVolumeViewport | null}
  */
  for (const engine of getRenderingEngines()) {
    const viewport = engine.getViewport(viewportId);
    if (viewport) {
      return viewport;
    }
  }
  return null;
}


export function removeVolumeActors(viewportId, options) {
  // Remove volume actors from the provided viewport

  // @input volumeportId (str): viewport from which the volume actors should be removed
  // @input options (object): options for the operation

  // @returns actorUids of volumes associated with the scene

  options = options || {};
  _.defaults(options, { volumeClassName: 'vtkVolume', immediate: false });

  const _view3d = getCornerstone3dViewport(viewportId);
  if (!_view3d) {
    cosole.warn('Unable to retrieve viewport for viewportId='+viewportId);
    return;
  }

  // Filter scene for volumes
  const volumeActorUids = _view3d.getActors()
    .filter(_e => _e.actor.getClassName() == options.volumeClassName)        
    .map(_e => _e.uid);

  // Remove volumes from scene and render      
  _view3d.removeVolumeActors(volumeActorUids, options.immediate);
  return volumeActorUids;
}


export function terminateWorkerComputeJobs(options) {
  // Terminate Cornerstone3D backround compute jobs.

  // Cancel background operations
  const c3dWorkerManager = c3dGetWebWorkerManager();
  try {
    c3dWorkerManager.workerPoolManager.clearRequestStack(C3dEnums.RequestType.Compute);
  } catch(err) {
    console.warn('Unable to clear background compute requests due to an error.', err);
  }

  // Terminate polySeg background worker
  try {
    if (c3dWorkerManager?.workerRegistry?.['polySeg']) {
      c3dWorkerManager.terminate('polySeg');
    }
  } catch(err) {
    console.warn('Unable to terminate polySeg worker due to an error.', err);
  }

  return c3dWorkerManager;
}
