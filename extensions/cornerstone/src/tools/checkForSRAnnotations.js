import csTools from 'cornerstone-tools';
import cs from 'cornerstone-core';
import OHIF from '@ohif/core';

import { getEnabledElement } from '../state';
import id from './id';

const { studyMetadataManager } = OHIF.utils;


const checkForSRAnnotations = ({ viewportIndex, displaySet }) => {
  // Check the provided viewport and displayset to determine if there are any SR annotations

  const srModule = csTools.getModule(id);

  // Retrieve the currently active element
  const element = getEnabledElement(viewportIndex);
  if (!element) {
    return;
  }

  // Study and series metadata
  const { StudyInstanceUID } = displaySet;
  const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
  if (!studyMetadata) {
    return;
  }

  const srDisplaySets = studyMetadata
    .getDisplaySets()
    .filter(ds => ds.Modality === 'SR');
  if (srDisplaySets.length === 0) {
    return;
  }

  // Collate tracking UIDs from SR displaysets
  let measurements = [];

  _.each(srDisplaySets, (srDisplaySet) => {
    const { measurements: _measurements } = srDisplaySet;
    if (!_measurements || !_measurements.length) {
      return;
    }

    measurements = [...measurements, ..._measurements.filter(m => m.loaded === true)];
  });

  if (!measurements || !measurements.length) {
    return;
  }

  const measurement = measurements[0];
  if (!measurement) {
    return;
  }

  try {

    // Update 
    srModule.setters.trackingUniqueIdentifiersForElement(element,
      measurements.map(measurement => measurement.TrackingUniqueIdentifier), measurement);

    // Set the active tracking identifier
    const { TrackingUniqueIdentifier } = measurement;
    srModule.setters.activeTrackingUniqueIdentifierForElement(element, TrackingUniqueIdentifier);

    cs.updateImage(element);
  } catch(err) {
    console.error('Unable to set unique identifiers for the element due to an error:', err);
  }
};


export default checkForSRAnnotations;
