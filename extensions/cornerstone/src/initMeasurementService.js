// This module handles the connection of legacy (OHIF v2) tools and new (Cornerstone3D) tools
// to the OHIF v3 measurement service. Legacy tool types should be added to the initLegacyMeasurementService
// and new style mappings should be added to the initMeasurementService method.

import _ from 'lodash';

// Legacy Cornerstone Tools
import csTools from 'cornerstone-tools';

// Cornerstone 3D Components
import {
  eventTarget as c3dCoreEventTarget, 
  Types as c3dTypes,
} from '@cornerstonejs/core';
import { 
  Enums as c3dToolsEnums, 
  annotation as c3dAnnotations,
} from '@cornerstonejs/tools';

import OHIF from '@ohif/core';
const {
  CORNERSTONE_TOOLS_SOURCE_NAME,
  CORNERSTONE_TOOLS_SOURCE_VERSION,
  CORNERSTONE_3D_TOOLS_SOURCE_NAME,
  CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
} = OHIF.DICOMSR.Enums;
const {
  measurements, utils
} = OHIF;

import {
  cornerstoneMeasurementDataProc, cornerstone3dMeasurementDataProc,
} from './utils/measurementServiceMappings';


const initLegacyMeasurementServiceMappings = (measurementService) => {
  // Initialize legacy Cornerstone tool mappings

  // Initialize measurement service source and service mappings
  const measurementSource = measurementService.createSource(CORNERSTONE_TOOLS_SOURCE_NAME, CORNERSTONE_TOOLS_SOURCE_VERSION);
  const measurementMappings = cornerstoneMeasurementDataProc.measurementServiceMappingsFactory(measurementService, measurementSource);
  const { Length, ArrowAnnotateTool, DICOMSRSeriesTag } = measurementMappings;

  // Length Tool
  measurementService.addMapping(measurementSource, 
    Length.toolName, Length.matchingCriteria, 
    Length.toAnnotation, Length.toMeasurement, Length.cleanAnnotation, Length.toAltSourceMeasurementSchema);

  // Arrow Annotation Tool
  measurementService.addMapping(measurementSource, 
    ArrowAnnotateTool.toolName, ArrowAnnotateTool.matchingCriteria, 
    ArrowAnnotateTool.toAnnotation, ArrowAnnotateTool.toMeasurement, ArrowAnnotateTool.cleanAnnotation);

  // DICOM SR Series Tag Tool
  measurementService.addMapping(measurementSource,
    DICOMSRSeriesTag.toolName, DICOMSRSeriesTag.matchingCriteria,
    DICOMSRSeriesTag.toAnnotation, DICOMSRSeriesTag.toMeasurement, DICOMSRSeriesTag.cleanAnnotation,
    DICOMSRSeriesTag.toAltSourceMeasurementSchema);

  return {
    measurementSource, measurementMappings,
  }
}


const initCornerstone3dMeasurementServiceMappings = (measurementService, displaySetService, cornerstoneViewportService, customizationService) => {
  // Initialize Cornerstone 3D tool mappings

  // Initialize measurement service source and service mappings
  const measurementSource = measurementService.createSource(CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION);
  const measurementMappings = cornerstone3dMeasurementDataProc.measurementServiceMappingsFactory(
    measurementService, displaySetService, cornerstoneViewportService, customizationService);

  const { Length, ArrowAnnotate, DICOMSRSeriesTagTool } = measurementMappings;

  // Length Tool
  measurementService.addMapping(measurementSource,
    Length.toolName, Length.matchingCriteria, Length.toAnnotation, Length.toMeasurement);

  // Arrow Annotation Tool
  measurementService.addMapping(measurementSource, 
    ArrowAnnotate.toolName, ArrowAnnotate.matchingCriteria, ArrowAnnotate.toAnnotation, ArrowAnnotate.toMeasurement);

  // DICOM Series Tag Tool
  measurementService.addMapping(measurementSource,
    DICOMSRSeriesTagTool.toolName, DICOMSRSeriesTagTool.matchingCriteria, 
    DICOMSRSeriesTagTool.toAnnotation, DICOMSRSeriesTagTool.toMeasurement);

  return {
    measurementSource, measurementMappings,
  }
}


const connectLegacyToolsToMeasurementService = (measurementService) => {
  // Connect legacy Sonador Viewer tools to the measurement service. Handles initialization of the
  // mappings and tool methods, and the conversion of state back and forth between the legacy
  // tool mappings used in OHIF v2 tools and the OHIF v3 measurment service embedded inside
  // the Sonador viewer (which was designed to support Cornerstone 3D).

  // Initialize legacy measurement service
  const { measurementSource, measurementMappings } = initLegacyMeasurementServiceMappings(measurementService);

  /* Initialize measurement service events: creates bindings which drive interface data flow */
  cornerstone.events.addEventListener(cornerstone.EVENTS.ELEMENT_ENABLED, measurementMappings.onElementEnabled);

  return { measurementSource, measurementMappings };
}


const createRenderVersion = (measurementApi, source, measurement, data) => {
  // Check the source of the measurement against the measurement API data source and create a version
  // which can be rendered by the Cornerstone viewport.

  // Create blank objects for measurement data to prevent data accessor errors
  measurement = measurement || {}
  data = data || {};

  if (measurementApi.options.serviceEventCheckSource && !measurementApi._apiSourceServiceMeasurement(measurement, source)
      && (measurement?.metadata?.createRenderVersion || data?.metadata?.createRenderVersion)) {

    // Retrieve API MeasurementService source, determine if the tool is managed by the service, and retrieve the tool mapping
    // which will do the schema conversion.
    const { source: dstSrc, toolServiceManaged, toolMapping: dstToolMapping } = measurementApi._serviceManagedTool(measurement.toolName);

    if (toolServiceManaged && _.isFunction(dstToolMapping.toAltSourceMeasurementSchema)) {

      // Convert measurement schema to destination mapping
      const newRawMeasurement = dstToolMapping.toAltSourceMeasurementSchema(dstSrc, measurement, source);
      if (newRawMeasurement) {

        // Import the measurement instance into the service. Since there is no way to directly add
        // add a new measurement instance to the service, the destination annotation to measurement
        // and dstToolMapping.toAnnotationSchema methods are used.
        const annotation = dstToolMapping.toAnnotationSchema(newRawMeasurement, measurement.toolName);        
        const measurement_uid = dstSrc.annotationToMeasurement(
          measurement.toolName, dstToolMapping.toAnnotationSchema(newRawMeasurement, measurement.toolName));

        // Retrieve newly created service measurement, broadcast update, remove source measurement
        const svcMeasurement = measurementApi.measurementService.getMeasurement(measurement_uid);
        if (svcMeasurement) {
          
          // Notify connected component that measurement was created
          measurementApi.measurementService._broadcastEvent(measurementApi.measurementService.EVENTS.MEASUREMENT_ADDED, {
            source: dstSrc, measurement: svcMeasurement, data: annotation,
          });

          // Remove source measurement to prevent data duplication
          measurementApi.measurementService.remove(measurement.uid);
        }
      }
    }
  }
}


const connectToolsToMeasurementService = (measurementService, displaySetService, cornerstoneViewportService, customizationService) => {
  // Connect Cornerstone tools to OHIF measurement service

  // Connect legacy Cornerstone v2 tools to OHIF measurement service.
  const {
    measurementSource: csToolsLegacyVer4MeasurementSource,
    measurementMappings: csToolsLegacyVer4ServiceMappings,
  } = connectLegacyToolsToMeasurementService(measurementService);

  // Connect Cornerstone 3D tools to OHIF measurement service. Cornerstone 3D measurement tools
  // definitions and mapping sources are primarily used for parsing and persisting data.
  const {
    measurementSource: c3dToolsMeasurementSource,
    measurementMappings: c3dToolsServiceMappings,
  } = initCornerstone3dMeasurementServiceMappings(measurementService, displaySetService, cornerstoneViewportService, customizationService);

  // Watch for measurements initialized by Cornerstone 3D to allow for Cornerstone Legacy/Class versions
  // to be created for rendering.
  measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, ({ source, measurement, data }) =>  {

    createRenderVersion(OHIF.measurements.MeasurementApi.Instance, source, measurement, data);
  });

  measurementService.subscribe(measurementService.EVENTS.RAW_MEASUREMENT_ADDED, ({ source, measurement, data }) => {

    createRenderVersion(OHIF.measurements.MeasurementApi.Instance, source, measurement, data);
  });

  measurementService.subscribe(measurementService.EVENTS.MEASUREMENTS_DATASYNC, ({ apiEvent, measurementRepresentation }) => {
    if (apiEvent == measurements.Enums.EVENTS.MEASUREMENT_REPRESENTATION_ADDED 
        || apiEvent == measurements.Enums.EVENTS.MEASUREMENT_REPRESENTATION_UPDATED) {
      console.log('[cornerstone:measurementApi:event:measurementRepresentation] apiEvent='+apiEvent, measurementRepresentation);
    }
  });

  return { csToolsLegacyVer4MeasurementSource, csToolsLegacyVer4ServiceMappings, c3dToolsMeasurementSource, }
}


export {
  connectToolsToMeasurementService,
}