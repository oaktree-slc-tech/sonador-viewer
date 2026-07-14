import _ from 'lodash';

import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
  init as c3dCoreInit,

  ImageVolume as C3dImageVolume, 
  Enums as C3dEnums,
  volumeLoader as c3dVolumeLoader,
  cache as c3dCache,
  eventTarget as c3dEventTarget,
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


export function vtkImage2CornerstoneImageOptions(vtkImg, meta, options) {
  // Convert the provided vtkImage instance to a ConerstoneImageVolume instance
  options = options || {};
  _.defaults(options, { imageIds: [], });

  vtkImg = vtkVolume2vtkImage(vtkImg);

  // Initialize Cornerstone image
  return _.extend(_.pick(options, 'imageIds'), {
    metadata: meta,
    dimensions: vtkImg.getDimensions(), 
    origin: vtkImg.getOrigin(),
    spacing: vtkImg.getSpacing(),
    direction: vtkImg.getDirection(),
    scalarData: vtkImg.getPointData().getScalars().getData(),
  });
}


export function cacheVtkImage(volumeUid, meta, vtkImg, options) {
  // Convert the provided vtkImageData instance to a Cornerstone volume and place it in the
  // Cornerstone 3D cache. This method creates a local volume. `purgeLocalVolume` from this module
  // should be used when cleaning up references.

  // @input volumeUid (str): UID to be used to identify the new volume
  // @input meta (object): metadata to attach to the new volume
  // @input vtkImg (object): vtkImage instance to be cached.
  // @input options (object): objects for the volume. Passed to vtkImage2CornerstoneImageOptions.

  // Initialize and return a new local volume instance
  return c3dVolumeLoader.createLocalVolume(volumeUid, vtkImage2CornerstoneImageOptions(vtkImg, meta, options));
}


export async function cacheVtkLabelmapImage(refUid, labelmapUid, labelmapImg, options) {
  // Convert the provided vtkImageLabelmap instance to a cornerstone volume and place it in the
  // Cornerstone 3D cache.

  // @input refUid (str): UID of the reference volume. This is used by Cornerstone3D to create
  //    and link within the cache.
  // @input labelmapUid (str): UID of the labelmap volume which will be created.
  // @input labelmapImg (vtkImage): VTK image instance that will be used to create the labelamp
  // @input options (object): options

  options = options || {};

  // Ensure that the provided image is a vtkImage instance, retrieve scalar data
  labelmapImg = vtkVolume2vtkImage(labelmapImg);
  const segScalarData = labelmapImg.getPointData().getScalars().getData();

  // Create the volume and link to the reference, cache labelmap volume
  const segVol = await c3dVolumeLoader.createAndCacheDerivedLabelmapVolume(refUid, {
    volumeId: labelmapUid,
    scalarData: segScalarData,
  });

  // Ensure that the scalar data was populated
  if (segVol && !segVol.voxelManager.scalarData) {
    segVol.voxelManager.setCompleteScalarDataArray(segScalarData);
  }

  return segVol;
}


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

    // Filter segmentation by reference volume UID within the representation data
    const r = s.representationData || {};
    return r.referenceVolumeId == volumeUid || (r.Labelmap || {}).referenceVolumeId == volumeUid;
  });
}


export function purgeVolumeCache() {
  // Purge the entire Cornerstone3D volume cache. Call this when unmounting the study viewer
  // to release all cached volumes and their associated actor references.
  return c3dCache.purgeCache();
}


export function purgeLocalVolume(volumeUid, options) {
  // Remove the provided image volume from the cache

  options = options || {};
  _.defaults(options, {
    force: true, 
    annotations: true, 
    segmentations: true, 
  });

  // Clear volume loader object
  if (c3dCache.getVolumeLoadObject(volumeUid)) {
    c3dCache.removeVolumeLoadObject(volumeUid);
    triggerEvent(c3dEventTarget, c3dEvents.VOLUME_CACHE_VOLUME_REMOVED, {
      volumeUid,
    });
  } 

  // Iterate across image instances in cache and remove
  const imageIterator = c3dCache._imageCache.keys();
  while (true) {
    const { value: imageId, done } = imageIterator.next();

    if (done) {
      break;
    }

    if (_.includes(imageId, volumeUid)) {
    
      // Clear image loader object
      c3dCache.removeImageLoadObject(imageId, _.pick(options, 'force'));
        triggerEvent(c3dEventTarget, c3dEvents.IMAGE_CACHE_IMAGE_REMOVED, {
        imageId,
      });
    }
  }

  // Remove all annotations associated with the local volume
  if (options.annotations) {

    _.each(getVolumeAnnotations(volumeUid), (a) => {
      c3dAnnotations.state.removeAnnotation(a.annotationUID);
    });   
  }

  // Remove all segmentations
  if (options.segmentations) {

    // Remove segmentations
    _.each(getVolumeSegmentations(volumeUid), (s) => {
      
      // Remove segmentation from state
      c3dSegmentations.state.removeSegmentation(s.segmentationId);

      // Remove volume from cache
      const _segvol_id = s.representationData?.Labelmap?.volumeId;
      purgeLocalVolume(_segvol_id, { force: true, annotations: true, segmentations: false });
    });
  }
}


export function inspectVtkLabelmapImage(vtkImg) {
  // Inspect the provided VTK labelmap image. Determine the segment count, number of unique labels,
  // and the length of the data.

  vtkImg = vtkVolume2vtkImage(vtkImg);
  const scalarData = vtkImg.getPointData().getScalars().getData();

  if (!scalarData || scalarData.length === 0) {
    throw new Error('Segmentation ${segmentationVolumeId} scalar data is empty.')
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
  // Forcibly clear a segmentIndex from the provided segmentation. Utilizes 
  options = options || {};
  _.defaults(options, { checkOnly: false, recordHistory: true, triggerEvent: true, });

  // Remove segment from segmentation
  if (!options.checkOnly) {
    await c3dSegmentations.helpers.clearSegmentValue(segmentationId, segmentIndex, options);
  }

  // Ensure that the segmentation was cleared
  const segVol = c3dCache.getVolume(segmentationId);
  if (segVol) {
    const scalarData = segVol.voxelManager.getCompleteScalarDataArray();

    // Count pixels for the segment index
    const _segment = Array.from(scalarData).filter(v => v === segmentIndex);
    if (_segment.length) {
    console.warn(`[vtk:cornerstone3d:utils] Found non-zero voxels for segmentIndex=${segmentIndex} count=${_segment.length}. `
      + 'Force zero segment layer.');

    segVol.imageIds.forEach(async (imageId, sliceIndex) => {
      // Iterate through all images of the volume and zero slicces with non-zero segment values

      // Retrieve image/slice from cache
      const image = c3dCache.getImage(imageId);
      if (!image) {
          console.warn(`[vtk:cornerstone3d:utils] No cached image for slice segmentationId=${segmentationId} sliceIdx=${sliceIndex} imageId=${imageId}`);
          return;
      }

      // Retrieve slice scalar data
      const sliceData = image.voxelManager.getScalarData();
      const hits = Array.from(sliceData).filter(v => v === segmentIndex);
      if (hits.length > 0) {
          for (let i = 0; i < sliceData.length; i++) {
            if (sliceData[i] == segmentIndex) {
              sliceData[i] = 0;
            }
          }
        }
      });
    }

    // Invalidate the image volume (forces re-load and re-render)
    segVol.invalidate();
    if (options.triggerEvent) {
      c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
    }
  }
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
