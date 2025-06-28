import log from '../../log';

import Enums from '../../measurements/enums.js';

import getMeasurements from './utils/getMeasurements';
import isRehydratable from './utils/isRehydratable';

const { Cornerstone } = Enums;


const initDisplaySetMeasurements = (displaySet, servicesManager) => {
  // Initialize SR measurement display properties for the provided displaySet.

  // @returns displaySet if the measurement properties were initialized, otherwise null.

  const { MeasurementService } = servicesManager.services;

  const firstInstance = displaySet.metadata;
  if (!firstInstance) {
    log.warn('[DICOM-SR:Cornerstone:initDisplaySetMeasurements] displaySet='+displaySet.displaySetInstanceUID,
      'does not contain any instance or extended metadata. Skip initialization of measurement properties.')
    return null;
  }

  const { ContentSequence } = firstInstance;

  // Initialize measurement properties for the display set
  if (_.isNil(displaySet.measurements)) {
    displaySet.measurements = getMeasurements(ContentSequence)
    displaySet.isHyrated = false;

    const mappings = MeasurementService.getSourceMappings(Cornerstone.sr.name, Cornerstone.sr.version);
    displaySet.isRehydratable = isRehydratable(displaySet, mappings, Cornerstone.sr);
    displaySet.isLoaded = true;

    return displaySet;
  } else {
    console.log('[DICOM-SR:Cornerstone:initDisplaySetMeasurements] displaySet measurement instances previously initialized',
      displaySet.measurements);
  }

  return null;
}


export default initDisplaySetMeasurements;
export { initDisplaySetMeasurements };