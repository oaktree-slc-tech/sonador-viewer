// Creates a version of the MeasurementReport class from the Cornerstone3D Adapaters package for generating
// and reading tool data from DICOM-SR documents. This class provides a hook for triggering callbakcs
// when an SR content item is parsed from an SR document. The hook allows for content sequence items
// to be parsed form the SR and added to the annotation instance.

import _ from 'lodash';

import { adaptersSR as c3dAdaptersSR, helpers as c3dSrHelpers } from '@cornerstonejs/adapters';

import { MeasurementApi } from '../../measurements/classes'
import { Enums as MeasurementEnums } from '../../measurements/enums';

import TID1500MeasurementReport from '../utils/TID1500';
const { MeasurementReport: c3dMeasurementReport } = c3dAdaptersSR.Cornerstone3D;


export default class SonadorCornerstone3dMeasurementReport extends c3dMeasurementReport {
  // Sonador wrapper around Cornerstone 3D Measurement Report. Provides patched methods for reading
  // extended attributes to the measurement report instances.

  static generateToolState(dataset, sopInstanceUIDToImageIdMap, imageToWorldCoords, metadata, hooks, options) {
    /**
    * Generate Cornerstone tool state from dataset
    */
    options = options || {};
    const measurementApi = MeasurementApi.Instance;
    const MeasurementService = measurementApi.measurementService;

    // For now, bail out if the dataset is not a TID1500 SR with length measurements
    if (dataset.ContentTemplateSequence.TemplateIdentifier !== "1500") {
      throw new Error("This package can currently only interpret DICOM SR TID 1500");
    }

    const REPORT = "Imaging Measurements";
    const GROUP = "Measurement Group";
    const TRACKING_IDENTIFIER = "Tracking Identifier";
    const TRACKING_UNIQUE_IDENTIFIER = "Tracking Unique Identifier";

    // Identify the Imaging Measurements
    const imagingMeasurementContent = c3dSrHelpers.toArray(dataset.ContentSequence)
      .find(c3dSrHelpers.codeMeaningEquals(REPORT));

    // Retrieve the Measurements themselves
    const measurementGroups = c3dSrHelpers.toArray(imagingMeasurementContent.ContentSequence)
      .filter(c3dSrHelpers.codeMeaningEquals(GROUP));

    // For each of the supported measurement types, compute the measurement data
    const measurementData = {};

    measurementGroups.forEach(measurementGroup => {
      try {
        const measurementGroupContentSequence = c3dSrHelpers.toArray(measurementGroup.ContentSequence);

        const trackingIdentifierGroup = measurementGroupContentSequence.find(
          contentItem => contentItem.ConceptNameCodeSequence.CodeMeaning === TRACKING_IDENTIFIER);

        const { TextValue: trackingIdentifierValue } = trackingIdentifierGroup;

        const trackingUniqueIdentifierGroup = measurementGroupContentSequence.find(
          contentItem => contentItem.ConceptNameCodeSequence.CodeMeaning === TRACKING_UNIQUE_IDENTIFIER);

        const trackingUniqueIdentifierValue = trackingUniqueIdentifierGroup?.UID;

        const toolAdapter = hooks?.getToolClass?.(measurementGroup, dataset, this.measurementAdapterByToolType) 
          || this.getAdapterForTrackingIdentifier(trackingIdentifierValue);

        if (toolAdapter) {
          const measurement = toolAdapter.getMeasurementData(
            measurementGroup,sopInstanceUIDToImageIdMap, imageToWorldCoords, metadata, trackingIdentifierValue);

          measurement.TrackingUniqueIdentifier = trackingUniqueIdentifierValue;

          // Trigger content parse callback
          if (measurement && _.isFunction(options.onContentItemParse)) {
            options.onContentItemParse(toolAdapter.toolType, measurement, measurementGroup);
          }

          // Broadcast parsed annotation/measurement via service
          MeasurementService._broadcastEvent(MeasurementEnums.SERVICE_EVENTS.MEASUREMENTS_DATASYNC, {
            apiEvent: MeasurementEnums.EVENTS.MEASUREMENT_DCMSR_PARSE_MEAUSREMENT, annotation: measurement,
          });

          console.log(`=== ${toolAdapter.toolType} ===`);
          console.log(measurement);
          measurementData[toolAdapter.toolType] ||= [];
          measurementData[toolAdapter.toolType].push(measurement);
        }
      } catch (e) {
        console.warn("Unable to generate tool state for", measurementGroup, e);
      }
    });

    // NOTE: There is no way of knowing the cornerstone imageIds as that could be anything.
    // That is up to the consumer to derive from the SOPInstanceUIDs.
    return measurementData;
  }
}


const MeasurementReport = SonadorCornerstone3dMeasurementReport;
export { MeasurementReport };