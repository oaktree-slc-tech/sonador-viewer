// Helper module used to parse DICOM-SR reports to OHIF measurement instances
// which can be displayed by the Sonador viewer. Measurements created by this
// module are read-only and are displayed via the DICOMSRDisplayTool.

import _ from 'lodash';

import { ImageSet } from '../../classes';
import Enums from '../../measurements/enums.js';
import MeasurementApi from '../../measurements/classes/MeasurementApi';
const { Cornerstone } = Enums;

import initDisplaySetMeasurements from '../utils/initDisplaySetMeasurements.js';

import addMeasurement from './utils/addMeasurement';
import getMeasurements from './utils/getMeasurements';
import isRehydratable from './utils/isRehydratable';
import { findImageForPoints, planeFromInstance } from '../readOnly/imagePlane';
import { patientPoints } from '../readOnly/renderableData';
import { renderSRDisplayAnnotations } from '../readOnly/srDisplayAnnotations';


const parseSCOORD3D = ({ servicesManager, displaySets }, options) => {
  // Scan SR instances within the provided displaysets and parse measurements

  const { MeasurementService } = servicesManager.services;

  // Initialize displaySets for processing via the MeasurementService
  const { srDisplaySets, imageDisplaySets } = initDisplaySetMeasurements(displaySets, servicesManager, {
    sourceName: Cornerstone.sr.name, sourceVersion: Cornerstone.sr.version, adapters: Cornerstone.sr.adapers,
  });

  srDisplaySets.forEach((srDisplaySet) => {

    // Ensure that the SR displaySet includes a metadata section
    const firstInstance = srDisplaySet.metadata;
    if (!firstInstance) {
      return;
    }

    // Explicitly detect (and indicate) if the displaySet can be processed via Cornerstone mappings
    const mappings = MeasurementService.getSourceMappings(Cornerstone.sr.name, Cornerstone.sr.version);
    srDisplaySet.isRehydratable = isRehydratable(srDisplaySet, mappings);

    imageDisplaySets.forEach((imageDisplaySet) => {
      
      // Check currently added displaySets and add measurements if the sources exist.
      checkIfCanAddMeasurementsToDisplaySet(srDisplaySet, imageDisplaySet);
    });
  });
};


const checkIfCanAddMeasurementsToDisplaySet = (srDisplaySet, imageDisplaySet) => {
  // Check if the provide srDisplaySet can be processed and the results added
  // the imageDisplaySet using a DICOM SR display tool instance.

  const measurementApi = MeasurementApi.Instance;

  // Retrieve measurements from the displayset
  let measurements = srDisplaySet.measurements;

  /**
   * Look for image sets.
   * This also filters out _this_ displaySet, as it is not an image set.
   */
  if (!(imageDisplaySet instanceof ImageSet)) {
    return;
  }

  const { sopClassUIDs, images } = imageDisplaySet;

  // The display set's images with their planes, for placing SCOORD3D content by position
  let _candidates;
  const candidates = () => {
    _candidates = _candidates || images.map((image) => {
      const imageMetadata = image.getData().metadata;
      return { imageMetadata, plane: planeFromInstance(imageMetadata) };
    });
    return _candidates;
  };

  /**
   * Filter measurements that references the correct sop class.
   */
  measurements = measurements.filter((measurement) => {

    // Filter out measurements which have already been added
    const trackingUid = measurement.metadata?.TrackingUniqueIdentifier || measurement.TrackingUniqueIdentifier;

    if (trackingUid && measurementApi.getMeasurementByTrackingUid(trackingUid)) {
      return false;
    }

    return measurement.coords.some((coord) => {
      if (coord.ReferencedSOPSequence === undefined) {
        /** we miss the referenced information. We can compare the annotation SCOORD3D coordinates with
         * the ImagePatientPosition of the frames. However (WARNING!!!),
         * if more than a source series is present, this logic can find the wrong frame
         * (i.e. two source series, with the same frameOfReferenceUID,
         * that have each a frame with the same ImagePositionPatient of the annotation 3D coordinates)
         */
        const match = findImageForPoints(candidates(), patientPoints(coord), {
          FrameOfReferenceUID: coord.ReferencedFrameOfReferenceSequence,
        });

        if (match) {
          coord.ReferencedSOPSequence = {
            ReferencedSOPClassUID: match.imageMetadata.SOPClassUID,
            ReferencedSOPInstanceUID: match.imageMetadata.SOPInstanceUID,
          };
        }

        if (coord.ReferencedSOPSequence === undefined) {
          return false;
        }
      }

      return sopClassUIDs.includes(coord.ReferencedSOPSequence.ReferencedSOPClassUID);
    });
  });

  /**
   * New display set doesn't have measurements that references the correct sop class.
   */
  if (measurements.length === 0) {
    return;
  }

  const imageIds = images.map((i) => i.getImageId());
  const SOPInstanceUIDs = images.map((i) => i.SOPInstanceUID);
  const colors = new Map();
  measurements.forEach((measurement) => {

    const trackingUid = measurement.metadata?.TrackingUniqueIdentifier || measurement.TrackingUniqueIdentifier;
    const { coords } = measurement;

    coords.forEach((coord, index) => {

      if (coord.ReferencedSOPSequence !== undefined) {
        const imageIndex = SOPInstanceUIDs.findIndex((SOPInstanceUID) => {
          return SOPInstanceUID === coord.ReferencedSOPSequence.ReferencedSOPInstanceUID;
        }) ;

        if (imageIndex > -1) {
          if (!srDisplaySet.referencedDisplaySets.includes(imageDisplaySet)) {
            srDisplaySet.referencedDisplaySets.push(imageDisplaySet);
            console.log('[parseSCOORD3D:checkIfCanAddMeasurementsToDisplaySet] add imageDisplaySet reference to srDisplaySet. '
              +'imageDisplaySetUid='+imageDisplaySet.displaySetInstanceUID+' srDisplaySetUid='+srDisplaySet.displaySetInstanceUID);
          }

          const imageId = imageIds[imageIndex];
          const imageMetadata = images[imageIndex].getData().metadata;

          if (coord.GraphicType === 'TEXT') {

            const key = measurement.labels[index].label + measurement.labels[index].value;
            let color = colors.get(key);
            if (!color) {
              // random dark color
              color = 'hsla(' + Math.floor(Math.random() * 360) + ', 70%, 30%, 1)';
              colors.set(key, color);
            }

            measurement.labels[index].color = color;
            measurement.isSRText = true;
            measurement.labels[index].visible = true;

            imageDisplaySet.SRLabels.push({
              ReferencedSOPInstanceUID: coord.ReferencedSOPSequence.ReferencedSOPInstanceUID,
              labels: measurement.labels[index],
            });

            if (index === 0) {
              const mr = addMeasurement(measurement, imageId, imageMetadata, imageDisplaySet.displaySetInstanceUID);
            }
          } else {
            const { measurementRepresentation: mr } = addMeasurement(measurement, imageId, imageMetadata, imageDisplaySet.displaySetInstanceUID);
            console.log('[parseSCOORD3D:checkIfCanAddMeasurementsToDisplaySet:addMeasurement] srDisplaySet='+srDisplaySet.displaySetInstanceUID
              +' trackingUid='+trackingUid+' imageIndex='+imageIndex, 'measurement', measurement, 'measurement representation', mr);
          }
        }
      }
    });
  });

  measurementApi.syncMeasurementsAndToolData();
  renderSRDisplayAnnotations();
};


export default parseSCOORD3D;
