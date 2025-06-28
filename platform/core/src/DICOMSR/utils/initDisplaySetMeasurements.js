import _ from 'lodash';
import log from '../../log';
import Enums from '../../measurements/enums.js';

const { Cornerstone3D, Cornerstone } = Enums;

import {
  initDisplaySetMeasurements as initCornerstoneDisplaySetMeasurements
} from '../SCOORD3D';
import {
  initDisplaySetMeasurements as initCornerstone3dDisplaySetMeasurements
} from '../Cornerstone3d';


const initDisplaySetMeasurements = (displaySets, servicesManager, options) => {
  // Scan SR instances within the provided displaysets and initialize service properties 
  // needed by the MeasurementService to parse measurement instance data.

  // @input displaySets (array of displaySets): displaySets to initialize with
  //  measurement updates.
  // @input servicesmanager (ServicesManager)
  
  options = options || {};
  _.defaults(options, { module: Cornerstone.sr });

  // 1. Initialize SRLabels property on imageDisplaySet
  const _updated = [];

  const { displaySetService, MeasurementService } = servicesManager.services;

  // Filter for SR and image displaySets. Needed to initialize display properties
  // required for filtering via Cornerstone3D displayReport.
  const srDisplaySets = displaySets.filter((ds) => ds.Modality === 'SR');
  const imageDisplaySets = displaySets.filter(
    (ds) => ds.Modality !== 'SR' && ds.Modality !== 'SEG' && ds.Modality !== 'RTSTRUCT');

  // Add SR properties to imageDisplaySets
  imageDisplaySets.forEach((imageDisplaySet) => {
    if (imageDisplaySet.displaySetInstanceUID && _.isNil(imageDisplaySet.SRLabels)) {
      imageDisplaySet.SRLabels = [];

      _updated.push(imageDisplaySet);
    }
  });

  // Initialize display set attributes for measurement parsing on SR DisplaySets
  srDisplaySets.forEach((srDisplaySet) => {

    let _ds;
    if (options.module.name == Cornerstone.sr.name && options.module.version == Cornerstone.sr.version) {
      _ds = initCornerstoneDisplaySetMeasurements(srDisplaySet, servicesManager);
    } else if (options.module.name == Cornerstone3D.sr.name && options.module.version == Cornerstone3D.sr.version) {
      _ds = initCornerstone3dDisplaySetMeasurements(srDisplaySet, servicesManager);
    } else {
      throw new Error('[DICOM-SR:initDisplaySetMeasurements] unable to initialize displaySet measurements for '
        + 'displaySetInstanceUID='+srDisplaySet.displaySetInstanceUID+'. ' 
        + 'Unsupported module: sourceName='+options.module.name+' sourceVersion='+options.module.version);
    }

    // Initialize measurement properties for the display set
    if (_ds) {

      _updated.push(_ds);
    }
  }); 

  // Add updated displaySets to the displaySetService to trigger changes/updates within 
  // the application.
  if (displaySetService && _updated.length) {
    displaySetService.addDisplaySets(_updated);
  }

  return { imageDisplaySets, srDisplaySets }
}


export default initDisplaySetMeasurements;
export { initDisplaySetMeasurements };