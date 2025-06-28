import _ from 'lodash';

import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
	init as c3dCoreInit,

	ImageVolume as C3dImageVolume, 
	Enums as C3dEnums,
	volumeLoader as c3dVolumeLoader,
	cache as c3dCache,
	eventTarget as c3dEventTarget,
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
	// 		and link within the cache.
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


export function purgeLocalVolume(volumeUid, options) {
	// Remove the provided image volume from the cache

	options = options || {};
	_.defaults(options, { force: true, annotations: true, segmentations: true });

	// Clear volume loader object
	c3dCache.removeVolumeLoadObject(volumeUid);
	triggerEvent(c3dEventTarget, c3dEvents.VOLUME_CACHE_VOLUME_REMOVED, {
		volumeUid,
	});

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
