// Measurements interface for the Sonador viewer. Provides a uniform mechanism to 
// interface with the measurements and viewer annotations (measurement representations). This class is integrated
// with the OHIF v3 Measurements Service and provides a compatibility bridge
// for older Cornerstone Tools to work with the newer OHIF architecture. It can be used
// to actively manage three separate state stores.

// *  OHIF v3 Measurement Service: central store used by the Sonador viewer for tracking
//    measurement data. Measurements stored in the service can be persisted to DICOM-SR
//    and studies which have DICOM-SR compatible measurements will have that data "re-hydrated"
//    to the service for rendering by Cornerstone tools.
// *  Measurements API local state: state instance used by the API for temporarily persisting
//    data for tools not integrated with the measurement service. The local API data is referred
//    to as a "representation." Representation state can be added or updated directly by calling
//    addMeasurementRepresentation or updateMeasurementRepresentation.
// *  Cornerstone Tools v4 State: annotation rendering data used by Cornerstone Tools v4 (Classic/Legacy)
//    to display measurements within the service or API.

// This module is designed to provided a singleton Instance of the API which can be accessed
// via the MeasurementApi.Instance property. The API instance should be initialized in the
// the Viewer App.

// IMPORTANT: MeasurementService Source.

// Because the Sonador Viewer uses both Cornerstone3D and Cornerstone Tools Legacy/Classic, this 
// API both bridges the interface with Cornerstone Tools while also only interacting with data inside 
// of the MeasurementApi that is compatible Cornerstone Legacy/Classic. This allows for the MeasurementService 
// to be consumed by other components in the application and serve as a centralized store for 
// structured and semi-structured data. The API segregates measurements through a use of a MeasurementService
// source. (Refer to https://docs.ohif.org/platform/services/data/measurementservice/ for additional detail.)

// To effectively isolate measurements within the service, the API utilizes a "source filter."
// The API instance (available from OHIF.measurements.MeasurementApi.Instance) has a default source
// name and version specified which is used to filter measurement versions. By default,
// the provider for Cornerstone Tools Legacy/Classic is used, since the OHIF v2 Cornerstone viewport
// is most commonly used for visualization.

// Data for Cornerstone 3D measurements are also supported and be parsed
// using the Cornerstone3DTools-Sonador source for tools which integrate directly with MeasurementService.

// If a `toMeasurementVersion` method is specified on the source for a specific tool type, 
// it is possible to generate to convert from on version of the measurement data to another. This is used
// within the DICOM-SR module to load data using the Cornerstone3D DCM.js adapters (which better support
// the DICOM-SR standard), and then convert them to the Cornerstone Tools Classic schema.

// IMPORTANT: Data Flow

// To maintain compatbility with OHIF v3, all tool classes with MeasurementSerrvice
// bindings MUST coordinate their state via the service. This ensures
// that the data is updated correctly across the viewer and that transforms execute
// as expected.

// Data flow: measurements should be managed via the MeasurementService and respect
// the MeasurementService lifecycle.

// *  Adding measurement data via API

//    - Call `addMeasurement(toolType, measurement)` which triggers MeasurementService.addRawMeasurement.
//      This causes the measurement instance to be converted to the format compatible with the 
//      the MeasurementStore and persisted to the service.
//    - Internally, the `MeasurmeentApi` will call `addMeasurementRepresentation` which will add 
//      the measurement to Cornerstone Tools version and trigger associated events for rendering
//      and interaction.

// *  Updating measurements via API

//    - Call `updatemeasurement(toolType, measurement)` which triggers MeasurementService.update.
//      If the update is not being driven by Cornerstone Tools, then pass `{ notYetUpdatedAtSource: true }`
//      as an option so that the service will trigger `updateMeasurementRepresentation` and synchronize
//      the measurements data with the API local state.

// IMPORTANT: Unique identifiers

// Two unique identifiers are used for tracking data registered within the service. MeasurementService
// entries are assigned a `uid` identifier which is used for CRUD operations. Local state and Corernstone Tools
// entries are identified via a `_id` attribute. Note: an alias for `uid` (`_measurementServiceId`) 
// is used within annotation and by some tools. API methods such as `addMeasurement` and `updateMeasurement`
// will back-fill properties when they are called.

// API Data structures:

// *  toolGroups: linked groups of related tools that provide access to the associated measurements.
//    Tool groups are used in side panels and reports for linking related measurements across
//    multiple sources (such as SR documents).
// *  timepoints: groups of measurements which are linked in time

// IMPORTANT: API Events

// The API utilizes MeasurementService to broadcast events to integrated components.
// This helps to coordinate state and prevent un-necessary data re-renders.
// For components that only need to integration with service measurements, they may bind
// event handlers to the MeasurementService.EVENTS RAW_MEASUREMENT_ADDED, MEASUREMENT_REMOVED, 
// or MEASUREMENTS_CLEARED.

// For components, however, which need to have compatibility with all API measurements,
// it is possible to bind to MeasurementService.EVENTS MEASUREMENTS_DATASYNC. DATASYNC
// broadcasts all CRUD changes, including updates to OHIF v3 measurement instances AND 
// measurement representations. This allows for stateful components in other parts of the
// application to respond to changes within the API, regardless of the type of change.


import _ from 'lodash';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import log from '../../log';
import guid from '../../utils/guid';
import studyMetadataManager from '../../utils/studyMetadataManager';
import getDescription from '../lib/getDescription';
import getImageIdForImagePath from '../lib/getImageIdForImagePath';
import getLabel from '../lib/getLabel';
import refreshCornerstoneViewports from '../lib/refreshCornerstoneViewports';

import { measurementApiDefaultConfig } from './../configuration.js';
import utils from './../../utils';

import Enums from '../enums';

const configuration = {
  ...measurementApiDefaultConfig,
};


export default class MeasurementApi {
  // Sonador Viewer MeasurementApi. 
  static Instance;

  /**
   * Set configuration: It should merge default configuration with any new one
   *
   * @static
   * @param {Object} config
   * @param {Object} config.server
   * @param {string} config.server.type - The server type
   * @param {string} config.server.wadoRoot - The server wado URL root
   * @param {Array} config.measurementTools
   * @param {string} config.measurementTools[].id - The tool group id
   * @param {string} config.measurementTools[].name - The tool group name
   * @param {Array} config.measurementTools[].childTools - The child tool's configuration
   * @param {Object} config.dataExchange
   * @param {Function} config.dataExchange.store - Function that store measurement data
   * @param {Function} config.dataExchange.retrieve - Function that retrieves measurement data
   * 
   * @constructor
   *  - measurementService: OHIF MeasurementService Instance
   *  - timepointApi: OHIF TimepointApi Instance
   *  - options: options for the API instance
   *    + sourceName (str, default="Cornerstone"): name of the MeasurementService source which should be used by the
   *      API instance (str). By default the Cornerstone Legacy/Classic source is used.
   *    + sourceVersion (str, default="4"): semantic version number of the MeasurementService source. By default
   *      the most recent version of the Cornerstone Legacy/Classic tools are used.
   *    + serviceEventCheckSource (bool, default=true): when a true
   *
   * @memberof MeasurementApi
   */
  static setConfiguration(config) {
    Object.assign(configuration, config);
  }

  static getConfiguration() {
    return configuration;
  }

  static getToolsGroupsMap() {
    const toolsGroupsMap = {};
    configuration.measurementTools.forEach((toolGroup) => {
      toolGroup.childTools.forEach((tool) => (toolsGroupsMap[tool.id] = toolGroup.id));
    });

    return toolsGroupsMap;
  }

  static getToolGroupTools(toolsGroupsMap) {
    const result = {};
    Object.keys(toolsGroupsMap).forEach((toolType) => {
      const toolGroupId = toolsGroupsMap[toolType];
      if (!result[toolGroupId]) {
        result[toolGroupId] = [];
      }

      result[toolGroupId].push(toolType);
    });

    return result;
  }

  static getToolConfiguration(toolType) {
    // Retrieve tools configuration for the API

    const configuration = MeasurementApi.getConfiguration();
    const toolsGroupsMap = MeasurementApi.getToolsGroupsMap();

    const toolGroupId = toolsGroupsMap[toolType];
    const toolGroup = configuration.measurementTools.find((toolGroup) => toolGroup.id === toolGroupId);

    let tool;
    if (toolGroup) {
      tool = toolGroup.childTools.find((tool) => tool.id === toolType);
    }

    return { toolGroupId, toolGroup, tool, };
  }

  static purgeCornerstoneToolData(toolType, imageId, measurementRep) {
    // Remove the state of the measurement from Cornerstone Tools state.
    // IMPORTANT: Cornerstone tools state is used for rendering data within OHIF viewports.
    // it is separate from the MeasurementService and from the API managed representations.

    // @returns bool/undefined: true if the measurement was removed from state, false if the
    //  measurement was not registered with the tool. If no global state was defined or cloud be retrieved
    //  the method will return undefined.

    const { toolState: globalToolState } = cornerstoneTools.globalImageIdSpecificToolStateManager;
    const { uid, _id } = MeasurementApi._unpackMeasurementData(measurementRep);

    // Locate element to remove based on tool state
    const imageIdToolState = globalToolState[imageId];
    const { data: globalToolData } = imageIdToolState[toolType];

    if (!globalToolData || !globalToolData.length) {
      log.warn('[measurementAPI:purgeToolData] no tool data registered with global state for toolType='+toolType);
      return;
    }

    // Find tool data which matches the measurement
    const idx = globalToolData.findIndex((toolData) => {
      const { _id: toolId, uid: toolMeasurementServiceId } = MeasurementApi._unpackMeasurementData(toolData);
      return toolId == _id || toolMeasurementServiceId == uid;
    });

    if (idx > -1) {

      // Remove the global tool state
      globalToolData.splice(idx, 1);
      log.warn('[measurementAPI:purgeToolData] measurement toolType='+toolType+' _id='+_id+' uid='+uid
        +' removed from global state successfully');

      return true;

    } else {

      // Unable to locate the measurement
      log.warn('[measurementAPI:purgeToolData] unable to locate measurement for toolType='+toolType
        +' _id='+_id+' uid='+uid+'. Measurement not found in global tool state.');
    }

    return false;
  }

  static purgeCornerstoneMeasurementData(measurement) {
    // Remove the state of the measurement from Cornerstone Tools state.
    // IMPORTANT: Cornerstone tools state is used for rendering data within OHIF viewports.
    // it is separate from the MeasurementService and from the API managed representations.
    // This method unpacks tool attributes from measurement data and calls purgeCornerstoneToolData.
    // Refer to purgeCornerstoneToolData for return values.

    // Unpack measurement identifiers and retrieve tool type
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(measurement);
    
    const _tool = MeasurementApi._getToolType(measurement);
    if (!_tool) {
      log.warn('[measurementAPI:purgeToolData] invalid toolType='+_tool+' for measurement', measurement);
      return;
    }

    // Ensure that the measurement includes a reference to the element and viewport
    if (!measurement.element || !measurement.viewport) {

      log.warn('[measurementAPI:purgeToolData] Unable to modify global state for toolType='+_tool+'. Measurement '
        + 'does not include element or viewport', measurement);
      return;
    }

    const enabledElement = cornerstone.getEnabledElement(measurement.element);
    if (!enabledElement || !enabledElement.image) {
      log.warn('[measurementAPI:purgeToolData] no enable element or no image.', enabledElement, (enabledElement || {}).image);
      return;
    }

    return MeasurementApi.purgeCornerstoneToolData(_tool, enabledElement.image.imageId, measurement);
  }

  static syncMeasurementAndToolData(measurement) {
    // Sync data representation between the measurement and the Cornerstone tool associated with it.

    // Unpack measurement identifiers
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(measurement);
    const _tool = MeasurementApi._getToolType(measurement);

    // Retrieve measurement label
    const measurementLabel = getLabel(measurement);
    if (measurementLabel) {
      measurement.labels = [measurementLabel];
    }

    // Retrieve global tool state (annotation representations) from Cornerstone Tools
    const toolState = cornerstoneTools.globalImageIdSpecificToolStateManager.saveToolState();

    // Stop here if the metadata for the measurement's study is not loaded yet
    const StudyInstanceUID = measurement.referenceStudyUID || measurementMeta.StudyInstanceUID || measurement.StudyInstanceUID;
    const metadata = studyMetadataManager.get(StudyInstanceUID);
    if (!metadata){
      log.warn('[measurementAPI:syncMeasurementAndToolData] unable to locate metadata for study. StudyInstanceUID='+StudyInstanceUID);
      return;
    } 

    // Iterate each child tool if the current tool has children
    const { tool } = MeasurementApi.getToolConfiguration(_tool);
    
    if (Array.isArray(tool.childTools)) {

      tool.childTools.forEach((childToolKey) => {
        const childMeasurement = measurement[childToolKey];
        if (!childMeasurement) return;
        childMeasurement._id = _id;
        childMeasurement.measurementNumber = measurement.measurementNumber;
        
        MeasurementApi.syncMeasurementAndToolData(childMeasurement);
      });

      return;
    }

    let { imagePath, imageId } = MeasurementApi._getImageIdentifiers(measurement);
    if (!imageId) {

      // Log warning and skip update of tool state
      log.warn('[measurementAPI:syncMeasurementAndToolData] unable to update tool state for uid='+uid+' _id='+_id+'. ',
      'Unable to retrieve imageId or imagePath from measurement instance.', measurement);
      return;
    }

    // If no tool state exists for this imageId, create an empty object to store it
    if (!toolState[imageId]) {
      toolState[imageId] = {};
    }

    // Convert the measurement representation to the annotation state expected by the tool.
    const _annotation = measurement.source 
      ? measurement.source.getAnnotation(_tool, uid || _id) : measurement;

    // Retrieve the state for the current tool from the global state
    const currentToolState = toolState[imageId][_tool];
    const toolData = currentToolState && currentToolState.data;

    // Check if we already have toolData for this imageId and toolType
    if (toolData && toolData.length) {
      
      // If we have toolData, we should search it for any data related to the current Measurement
      const toolData = toolState[imageId][_tool].data;

      // Create a flag so we know if we've successfully updated the Measurement in the toolData
      let alreadyExists = false;

      // Loop through the toolData to search for the currently active measurement
      toolData.forEach((tool) => {
        
        // Break the loop if this isn't the Measurement we are looking for
        if (tool._id !== _id) {
          return;
        }

        // If we have found the Measurement, set the flag to True
        alreadyExists = true;

        // Update the toolData from the annotation data
        Object.assign(tool, _annotation);
        return false;
      });

      // If we have found the Measurement we intended to update, we can stop this function here
      if (alreadyExists === true) {
        log.debug('[measurementAPI:syncMeasurementAndToolData] tool state for imageId='+imageId
          +' measurement _id='+_id+' updated successfully');
        return;
      }

    } else {
      
      // If no toolData exists for this toolType, create an empty array to hold some
      toolState[imageId][_tool] = { data: [], };
      log.warn('[measurementAPI:syncMeasurementAndToolData] global tool state does not include annotation for imageId='+imageId
        +' measurement _id='+_id+'. Create placeholder array for toolType='+_tool);
    }

    // If we have reached this point, it means we haven't found the Measurement we are looking for
    // in the current toolData. This means we need to add it.
    log.warn('[measurementAPI:syncMeasurementAndToolData] push new tool state for imageId='+imageId
          +' measurement _id='+_id, _annotation);

    // Add the MeasurementData into the toolData for this imageId
    toolState[imageId][_tool].data.push(_annotation);
    cornerstoneTools.globalImageIdSpecificToolStateManager.restoreToolState(toolState);
  }

  static isToolIncluded(tool) {
    return tool.options && tool.options.caseProgress && tool.options.caseProgress.include;
  }

  static _getToolType(measurement) {
    // Retrieve the tool type from the provided measurement instance. Order of resolution:
    // m.metadata.toolName -> m.metadata.toolType -> m.toolName -> m.toolType

    return (measurement.metadata || {}).toolName || (measurement.metadata || {}).toolType 
      || measurement.toolName || measurement.toolType
  }

  static _getImageIdentifiers(measurement) {
    // Retrieve the imageId and imagePath from the provided measurement
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(measurement);

    const imagePath = measurementMeta.imagePath || measurementData.imagePath || measurement.imagePath;
    let imageId = measurement.referencedImageId || measurementMeta.referencedImageId || measurementMeta.imageId
      || measurementData.referencedImageId || measurementData.imageId || measurement.imageId;

    // Backfill imageId from imagePath (if imagePath is available)
    if (!imageId && imagePath) {
      imageId = getImageIdForImagePath(imagePath);
    }

    return { imagePath, imageId };
  }

  static _unpackMeasurementData(measurement) {
    // Unpack measurement sections and data with common fallbacks

    // @input measurement (object): measurement instance (OHIF v3 schema)
    
    // @returns object instance with measurementMeta, measurementData, _id, and uid defined
    //  distinct keys.

    if (!measurement) {
      return {};
    }

    const measurementMeta = measurement.metadata || measurement;
    const measurementData = measurement.data || measurement.measurementData || measurement;
    const _id = measurementMeta._id || measurementData._id || measurement._id;
    const uid = measurement.uid || measurementMeta.uid || measurementMeta._measurementServiceId
      || measurementData.uid || measurementData._measurementServiceId;

    return { uid, _id, measurementMeta, measurementData }
  }

  static _unpackMeasurementLifecycleAttrs(measurement) {
    // Unpack measurement state data (isReadOnly, isLocked, isDirty). Looks through all sections of the
    // measurement object to locate the data.

    // @input measurement (object): measurement instance (OHIF v3 schema)
    // -  isReadOnly (bool): specifies whether the measurement can be modified or persisted.
    //      Measurements where isReadOnly is true cannot be edited or saved to DICOM-SR.
    // -  isLocked (bool): specifies whether the measurement can be modified.
    //      Measurements where isLocked is true cannot be modified and the their tool instances
    //      behave as though they are in "enabled" mode only.
    // -  isDirty (bool): indicates whether the measurement has had a change to its state that
    //      has not yet been rendered.

    const { measurementMeta, measurementData } = MeasurementApi._unpackMeasurementData(measurement);

    const isReadOnly = utils.dataProc.firstDefinedValue(
      measurementMeta.isReadOnly, measurementData.isReadOnly, measurement.isReadOnly);
    const isLocked = utils.dataProc.firstDefinedValue(
      measurement.isLocked, measurementMeta.isLocked, measurementData.isLocked);
    const isDirty = utils.dataProc.firstDefinedValue(
      measurement.isDirty, measurementMeta.isDirty, measurementData.isDirty);
    const isVisible = utils.dataProc.firstDefinedValue(
      measurement.isVisible, measurementMeta.isVisible, measurementData.isVisible,
      measurement.visible, measurementMeta.visible, measurementData.visible);

    return { isReadOnly, isLocked, isDirty, isVisible }
  }


  static _unpackMeasurementLabellingAttrs(measurement) {
    // Unpack measurement "labelling" attributes (description, location). Looks through all sections of the
    // measurement object to locate the data and returns a flattened object with the attributes in
    // the top-level.

    // @input measurement (object): measurement instance (OHIF v3 schema)
    // - description (str): plain-text description of the measurement
    // - location (str): plain-text description of the "location" of the measurement

    // Unpack measurement meta and data sections
    const { measurementMeta, measurementData } = MeasurementApi._unpackMeasurementData(measurement);

    const description = measurement.description || measurementMeta.description || measurementData.description;
    const location = measurementMeta.location || measurementData.location || measurement.location;

    return { description, location };
  }

  static _backfillMeasurementRepresentationIdentifiers(measurementRepresentation) {
    // Parse representation identifiers (uid and _id) and ensure that they are included within the 
    // data, metadata, and root of the representation.
    // back-fills: representation._id, representation.metadata._id, representation.measurementData._id
    // representation.uid, representation.measurementData._measurementServiceId
    
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(measurementRepresentation);

    // Back-fill placeholder sections
    if (!measurementRepresentation.metadata) measurementRepresentation.metadata = {};
    if (!measurementRepresentation.measurementData) measurementRepresentation.measurementData = {};

    // Back-fill identifiers
    if (!measurementRepresentation.uid && uid) measurementRepresentation.uid = uid;
    if (!measurementRepresentation.measurementData._measurementServiceId && uid)
      measurementRepresentation.measurementData._measurementServiceId = uid;
    if (!measurementRepresentation._id && _id) measurementRepresentation._id = _id;
    if (!measurementRepresentation.metadata._id && _id) measurementRepresentation.metadata._id = _id;
    if (!measurementRepresentation.measurementData._id && _id)
      measurementRepresentation.measurementData._id = _id;

    return measurementRepresentation;
  }

  constructor(measurementService, timepointApi, options = {}) {
    options = options || {};

    if (MeasurementApi.Instance) {
      MeasurementApi.Instance.initialize(measurementService, timepointApi, options);
      return MeasurementApi.Instance;
    }

    this.initialize(measurementService, timepointApi, options);
    MeasurementApi.Instance = this;
  }

  initialize(measurementService, timepointApi, options = {}) {
    // Initialize MeasurementApi instance: create collections/groups to interface
    // with Cornerstone Tools Legacy, subscribe to measurement service events.

    _.defaults(options, {
      sourceName: Enums.CORNERSTONE_TOOLS_SOURCE_NAME,
      sourceVersion: Enums.CORNERSTONE_TOOLS_SOURCE_VERSION,
      serviceEventCheckSource: true,
    });

    // Timepoint API and Measurement Service
    this.measurementService = measurementService;
    this.timepointApi = timepointApi;
    this.options = options;

    // Ensure that a valid measurement service instance is provided for the API
    if (!this.measurementService) {
      throw new Error('Unable to initialize MeasurementApi, invalid MeasurementService instance');
    }

    this.toolGroups = {};
    this.tools = {};
    this.toolsGroupsMap = MeasurementApi.getToolsGroupsMap();
    this.toolGroupTools = MeasurementApi.getToolGroupTools(this.toolsGroupsMap);

    // Iterate over each tool group and create collection
    configuration.measurementTools.forEach((toolGroup) => {
      this.toolGroups[toolGroup.id] = [];

      // Iterate over each tool group child tools (e.g. bidirectional, targetCR, etc.) and create collection
      toolGroup.childTools.forEach((tool) => {
        this.tools[tool.id] = [];
      });
    });

    // Subscribe to changes in the MeasurementService
    this.subscription_add = this.measurementService.subscribe(
      this.measurementService.EVENTS.MEASUREMENT_ADDED,
      this.onServiceRawMeasurementAdded.bind(this));
    this.subscription_add_raw = this.measurementService.subscribe(
      this.measurementService.EVENTS.RAW_MEASUREMENT_ADDED,
      this.onServiceRawMeasurementAdded.bind(this)); 
    this.subscription_update = this.measurementService.subscribe(
      this.measurementService.EVENTS.MEASUREMENT_UPDATED, 
      this.onServiceMeasurementUpdate.bind(this));
    this.subscription_removed = this.measurementService.subscribe(
      this.measurementService.EVENTS.MEASUREMENT_REMOVED, 
      this.onServiceMeasurementRemoved.bind(this));
    this.subscription_cleared = this.measurementService.subscribe(
      this.measurementService.EVENTS.MEASUREMENTS_CLEARED, 
      this.onServiceMeasurementCleared.bind(this));
  }

  destroy() {
    // Measurement instance teardown

    // Clear measurement service
    this.clearMeasurements();
    this.measurementService.onModeExit();

    // Unsubscribe events
    _.each([this.subscription_add, this.subscription_add_raw, this.subscription_update, 
        this.subscription_removed, this.subscription_cleared],
      (s) => { s.unsubscribe(); });
  }

  _serviceSourceMappings(options) {
    // Retrieve OHIF v3 MeasurementService source and mappings
    options = options || {};
    _.defaults(options, _.pick(this.options, 'sourceName', 'sourceVersion'));

    // Retrieve source, mappings, and definitions for the service
    const source = this.measurementService.getSource(options.sourceName, options.sourceVersion);
    const mappings = this.measurementService.getSourceMappings(options.sourceName, options.sourceVersion);
    const mappingDefinitions = mappings && mappings.length ? mappings.map(m => m.annotationType) : undefined;

    return { source, mappings, mappingDefinitions };
  }

  _serviceManagedTool(toolType, options) {
    // Check to determine if the tool type is managed via the OHIF v3 MeasurementService.
    
    // @input toolType (str): tool to check for service integration
    // @input options (object): method options
    
    // @returns object
    // - mappings: source mappings for the MeasurementService instance
    // - mappingDefinitions: array of mapping definitions
    // - toolServiceManaged (bool): true if the tool is managed by the service, false otherwise

    // Retrieve MeasurementService source, mappings, and mapping definitions
    const { source, mappings, mappingDefinitions } = this._serviceSourceMappings(options);

    // Check mappings to determine if the tool is managed by the service or not
    let toolServiceManaged = false;
    if (mappingDefinitions) {
      toolServiceManaged = mappingDefinitions.includes(toolType);
    }

    let toolMapping;
    if (toolServiceManaged) {
      toolMapping = mappings.find(m => m.annotationType == toolType);
    }

    return { source, mappings, mappingDefinitions, toolServiceManaged, toolMapping };
  }

  _apiSourceServiceMeasurement(measurement, source) {
    // Check the provided measurement to see if it originated from the data source 
    // associated with the measurement API
    source = source || measurement.source;

    return source && source.name == this.options.sourceName && source.version == this.options.sourceVersion;
  }

  onServiceRawMeasurementAdded({ source, measurement, data}) {
    // Event handler for measurement service EVENTS.RAW_MEASUREMENT_ADDED

    // Initialize tool representation of the measurement
    if (measurement) {

      if (this.options.serviceEventCheckSource && !this._apiSourceServiceMeasurement(measurement, source)) {

        log.warn('[measurementApi:event:measurement-added] measurement source checking enabled. Received measurement '
            + 'which does not match the source for the API. Skip adding representation for measurement.', 
          'api.sourceName='+this.options.sourceName, 'api.sourceVersion='+this.options.sourceVersion,
          'measurement.sourceName='+source.name, 'measurement.sourceVersion='+source.version);
        return;
      }

      // Determine tooltype: order of resolution
      const toolType = MeasurementApi._getToolType(measurement);
      if (toolType) {

        if (measurement.source && _.isFunction(measurement.source.getAnnotation)) {

          // Add measurement representation to viewport
          const _annotation = measurement.source.getAnnotation(toolType, measurement.uid);
          const _mr = this.addMeasurementRepresentation(toolType, _annotation);

          if (_mr && _mr.timepointId && !measurement.metadata?.timepointId) {

            // Add timepointId to metadata
            if (!measurement.metadata) measurement.metadata = {};
            measurement.metadata.timepointId = _mr.timepointId;

            // Update measurement entry
            this.measurementService.update(measurement.uid, measurement, false);
          }
        }
      }
    }
  }

  onServiceMeasurementUpdate({ source, measurement, notYetUpdatedAtSource }) {
    // Event handler for measurement service EVENTS.MEASUREMENT_UPDATED

    if (measurement) {
      log.debug('[measurementApi:event:measurement-update] uid='+measurement.uid,
        'pending-render='+notYetUpdatedAtSource, 'measurement', measurement);

      if (this.options.serviceEventCheckSource && !this._apiSourceServiceMeasurement(measurement, source)) {

        log.warn('[measurementApi:event:measurement-update] measurement source checking enabled. Received measurement '
            + 'which does not match the source for the API. Skip update of measurement representation.', 
          'api.sourceName='+this.options.sourceName, 'api.sourceVersion='+this.options.sourceVersion,
          'measurement.sourceName='+source.name, 'measurement.sourceVersion='+source.version);
        return;
      }

      const toolType = MeasurementApi._getToolType(measurement);
      const { uid } = MeasurementApi._unpackMeasurementData(measurement);
      
      if (toolType && uid) {

        if (measurement.source && _.isFunction(measurement.source.getAnnotation) && notYetUpdatedAtSource) {
          
          // Update measurement representation and sync (render). The "annotation" (Cornerstone Tools Legacy)
          // representation of the measurement is passed to updatedMeasurementRepresentation.
          const _annotation = measurement.source.getAnnotation(toolType, uid);
          this.updateMeasurementRepresentation(toolType, _annotation);

          // Synchronize tool and measurement data on programatic update
          MeasurementApi.syncMeasurementAndToolData(measurement);
        }
      }
    }
  }

  onServiceMeasurementRemoved({ toolType, measurement }) {
    // Event handler for measurement service EVENTS.MEASUREMENT_REMOVED    
    this.syncMeasurementsAndToolData();
  }

  onServiceMeasurementCleared() {
    // Event handler for measurement service EVENTS.MEASUREMENTS_CLEARED

    console.debug('[measurementAPI:event:measurements-cleared] measurements cleared successfully', this.measurementsCount());

    // Clear measurement representations registered with the API
    this.syncMeasurementsAndToolData();
  }

  onMeasurementsUpdated() {
    if (typeof this.options.onMeasurementsUpdated !== 'function') {
      log.warn('[Measurement API] Update callback is not defined');
      return;
    }

    this.options.onMeasurementsUpdated(Object.assign({}, this.tools));
  }

  retrieveMeasurements(options) {
    // Fetch measurement data and initialize measurement service
    const _api = this;
    options = options || {};

    const retrievalFn = configuration.dataExchange.retrieve;
    const { server } = configuration;
    if (typeof retrievalFn !== 'function') {
      console.error('[Measurement API] Retrieval/fetch function has not been configured.');
      return;
    }

    // Trigger start of measurement parse
    _api.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_DCMSR_PARSE_START);

    return new Promise((resolve, reject) => {
      retrievalFn(server).then((measurementData) => {
        if (measurementData) {          
          console.debug('[Measurement API] Initialize measurement data', measurementData);

          Object.keys(measurementData).forEach((measurementTypeId) => {
            const measurements = measurementData[measurementTypeId];

            measurements.forEach((measurement) => {

              // Retrieve tool type
              const toolType = MeasurementApi._getToolType(measurement)

              if (!toolType) {

                // Log error and throw exception
                const emsg = 'Unable to initialize measurement instance, invalid measurement type';
                console.error(emsg, toolType, measurement);
                throw new Error(emsg)
              }

              this.addMeasurement(toolType, measurement);
            });
          });
        }

        resolve();

        // Synchronize the new tool data
        this.syncMeasurementsAndToolData();

        // Update image viewports
        cornerstone.getEnabledElements().forEach((enabledElement) => {

          if (enabledElement.image) {
            cornerstone.updateImage(enabledElement.element);
          }
        });

        // Trigger callbacks
        if (_.isFunction(options.success)) {

          // Broadcast success via measurementService and trigger success callback
          _api.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_DCMSR_PARSE_SUCCESS);
          options.success();
        }

        // Notify other services that measurements have been updated.
        this.onMeasurementsUpdated();
      }, reject);
    });
  }

  storeMeasurements(timepointId, options) {
    // Persist the measurements specified by the provided timepoint to the server via DICOM-SR.

    // @input timepointId (str or null): timepointid for which measurements should be retrieved

    options = options || {};
    const _api = this;

    const { server } = configuration;
    const storeFn = configuration.dataExchange.store;
    if (typeof storeFn !== 'function') {
      log.warn('[measurementAPI:storeMeasurements] Measurement store function has not been configured.');
      return;
    }

    // Trigger start of measurement persistence
    this.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_PERSIST_START);

    // Retrieve current time point
    let timepoints, tp0;
    if (timepointId) {
      timepoints = this.timepointApi.all((tp) => tp.timepointId && tp.timepointId === timepointId);
    } else { timepoints = this.timepointApi.all(); }

    tp0 = timepoints.length > 0 ? timepoints[0] : undefined;
    if (!tp0) {
      log.warn('[measurementAPI:storeMeasurements] unable to retrieve timepoint, cancel export of measurements');
      return;
    }

    log.debug('[measurementAPI:storeMeasurements] timepoint for which to retrieve data timepointId='+tp0.timepointId, tp0);

    let measurementData = {};
    configuration.measurementTools.forEach((toolGroup) => {
      
      // Skip the tool groups excluded from case progress or those which are not managed by MeasurementService

      const toolGroupSupported = MeasurementApi.isToolIncluded(toolGroup);

      if (!toolGroupSupported) {
        log.debug('[measurementAPI:storeMeasurements] persistence of toolGroup='+toolGroup.id+' not supported by Sonador Viewer');
        return;
      }

      // Retrieve measurement instances for supported tool types
      toolGroup.childTools.forEach((tool) => {
        const toolSupported = MeasurementApi.isToolIncluded(tool);
        const { toolServiceManaged } = this._serviceManagedTool(tool.id);

        // Skip the tools excluded from case progress
        if (!toolSupported || !toolServiceManaged) {
          log.debug('[measurementAPI:storeMeasurements] persistence of toolType='+tool.id+' not supported by Sonador Viewer');
          return;
        }

        if (!measurementData[toolGroup.id]) {
          measurementData[toolGroup.id] = [];
        }

        // Retrieve measurement data from MeasurementService which match the current timepoint
        
        const _measurements = _api.serviceMeasurements((m) => {

            // Retrieve measurements matching the current tool, included in the study instance refernces of the timepoint,
            // and which are marked as isReadOnly=false and isLocked=false.
            const matchTool = m.toolName == tool.id;
            const { isReadOnly, isLocked } = MeasurementApi._unpackMeasurementLifecycleAttrs(m);            
            return matchTool && !Boolean(isReadOnly) && !Boolean(isLocked) && tp0.studyInstanceUIDs.includes(m.referenceStudyUID);
          }, options);

        // Add measurements to the 
        measurementData[toolGroup.id] = [...measurementData[toolGroup.id], ..._measurements];
      });
    });

    // Retrieve default DICOM headers (PatientID)
    options.headers = options.headers || {};
    _.defaults(options.headers, _.pick(tp0, 'PatientID'));

    return storeFn(measurementData, options.filter, server, _.pick(options, 'headers')).then((result) => {
      log.debug('[measurementAPI:storeMeasurements] measurement storage completed');

      // Trigger measurement persistence success and success callback
      _api.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_PERSIST_SUCCESS, { result });
      if (_.isFunction(options.success)) {
        options.success(result);
      }

      
      return result;
    });
  }

  calculateNamingNumber(measurements) {
    // Calculate the "naming number" (which is used for grouping) for the provided measurements

    const sortedMeasurements = measurements.sort((a, b) => {
      if (a.namingNumber > b.namingNumber) {
        return 1;
      } else if (a.namingNumber < b.namingNumber) {
        return -1;
      }

      return 0;
    });

    //  Calculate a naming number starting from 1 not to miss any measurement (as seen in MM)
    //      A measurement from beginning of the list might be deleted, so a new measurement should replace that
    let i;
    for (i = 1; i < sortedMeasurements.length + 1; i++) {
      if (i < sortedMeasurements[i - 1].namingNumber) {
        break;
      }
    }

    return i;
  }

  fetch(toolGroupId, filter) {
    // Fetch all measurements with the provided filter. If no filter is provided, 
    // measurementNumber will be used to group measurements.

    if (!this.toolGroups[toolGroupId]) {
      throw new Error(`MeasurementApi: No Collection with the id: ${toolGroupId}`);
    }

    let items;
    if (filter) {
      items = this.toolGroups[toolGroupId].filter(filter);
    } else {
      items = this.toolGroups[toolGroupId];
    }

    return items.map((item) => {
      if (item.toolId) {
        return this.tools[item.toolId].find((tool) => tool._id === item.toolItemId);
      }

      return { measurementNumber: item.measurementNumber };
    });
  }

  getServiceMeasurementByCornerstoneId(_id, options) {
    // Retrieve the a MeasurementService record using the Cornerstone ID (_id)

    // @returns service measurement instance, null, or undefined
    // - null values if the tool type is service managed but no matching record is available

    // Filter service managed measurements by ID
    const serviceMeasurements = this.serviceMeasurements((m) => {
      return _id && (m.metadata?._id == _id || m.data?._id == _id || m._id == _id);
    }, options);

    if (!serviceMeasurements || !serviceMeasurements.length) {
      log.warn('[measurementAPI:getServiceMeasurementByCornerstoneId] Unable to retrieve measurement _id='+_id);
      return null;
    }

    return serviceMeasurements[0];
  }

  getMeasurementByCornerstoneId(_id, options) {
    // Attempts to retrieve a local measurement instance matching the provided Cornerstone ID (_id).
      
    let measurement = this.getServiceMeasurementByCornerstoneId(_id, options);
    if (!measurement) {

      // Iterate through measurement representations
      _.find(this.tools, (measurementRepresentations) => {
        const found = _.find(measurementRepresentations, (mr) => {
          return _id && (mr.metadata?._id == _id 
              || mr.data?._id == _id
              || mr._id == _id);
        });

        if (found) {
          measurement = found;
        }
        
        return found;
      });
    }
    
    return measurement;
  }

  getMeasurementByTrackingUid(trackingUid, options) {
    // Attempt to retrieve a measurement (or measurement representation) from the API using the provided trackingUid.
    let measurement;

    // Attempt to retrieve instance from the measurement service
    const serviceMeasurements = this.serviceMeasurements((m) => {
      return trackingUid && (m.metadata?.TrackingUniqueIdentifier == trackingUid 
        || m.data?.TrackingUniqueIdentifier == trackingUid 
        || m.TrackingUniqueIdentifier == trackingUid);
    }, options);

    if (serviceMeasurements.length) {
      measurement = serviceMeasurements[0];
      return measurement;
    }

    // Iterate through measurement representations
    _.find(this.tools, (measurementRepresentations) => {
      const found = _.find(measurementRepresentations, (mr) => {
        return trackingUid && (mr.metadata?.TrackingUniqueIdentifier == trackingUid 
            || mr.data?.TrackingUniqueIdentifier == trackingUid
            || mr.TrackingUniqueIdentifier == trackingUid);
      });

      if (found) {
        measurement = found;
      }
      
      return found;
    });

    return measurement;
  }

  serviceMeasurements(filter, options) {
    // Retrieve measurements from the OHIF MeasurementService
    const _api = this;
    
    options = options || {};
    _.defaults(options, {
      serviceSourceCheck: true,
    });

    // Filter measurements by source
    if (options.serviceSourceCheck) {
      const _filter = filter;

      // Create new filter method which takes into account source being used by the API
      filter = (m) =>  {

        // Check measurement source against API source
        const sourceMatch = m.source && m.source.name == _api.options.sourceName && m.source.version == _api.options.sourceVersion;

        // Ensure that the measurement matches the provided filter.
        let filterMatch;
        
        if (_.isFunction(_filter)) {
          filterMatch = _filter(m);
        } else {
          filterMatch = true;
        }

        return sourceMatch && filterMatch;
      }
    }

    return this.measurementService.getMeasurements(filter);
  }

  toggleVisibilityMeasurement(_id, visibility) {
    // Toggle the visibility of the measurement

    // Attempt to toggle service measurement
    let measurement = this.getMeasurementByCornerstoneId(_id);
    if (measurement && measurement.uid) {
      return this.measurementService.toggleVisibilityMeasurement(measurement.uid, visibility);
    }

    // Toggle API managed measurement instance
    if (measurement) {
      measurement.visible = visibility;
      this.syncMeasurementsAndToolData(
        this.updateMeasurement(measurement.toolType, measurement));
    }
  }

  measurementsCount(filter, options) {
    // Retrieve a count of measurements registered with the API
    const count = {};

    // Retrieve count of each type of tool registered with the API
    _.each(this.tools, (tool, toolType) => {
      count[toolType] = tool.length;
    });

    // Retrieve the overall number of measurements registered with the measurements service
    count.service = this.serviceMeasurements(filter, options).length;

    return count;
  }

  getFirstMeasurement(timepointId) {
    // Get child tools from all included tool groups

    let childTools = [];
    configuration.measurementTools.forEach((toolGroup) => {
      // Skip the tool groups excluded from case progress
      if (!MeasurementApi.isToolIncluded(toolGroup)) {
        return false;
      }

      childTools = childTools.concat(toolGroup.childTools);
    });

    // Get all included child tools
    const includedChildTools = childTools.filter((tool) => MeasurementApi.isToolIncluded(tool));

    // Get the first measurement for the given timepoint
    let measurement = undefined;
    includedChildTools.every((tool) => {
      measurement = this.tools[tool.id].find((t) => t.timepointId === timepointId && t.measurementNumber === 1);

      return !measurement;
    });

    // Return the found measurement object or undefined if not found
    return measurement;
  }

  measurementExistsAtTimepoints(namingNumber, toolGroupId, timepointIds) {
    // Retrieve all the data for the given tool group (e.g. 'targets')
    const measurementsAtTimepoint = this.fetch(toolGroupId, (tool) => timepointIds.includes(tool.timepointId));

    // Return whether or not any measurement at this timepoint has the same namingNumber
    return !!measurementsAtTimepoint.find((m) => m.namingNumber === namingNumber);
  }

  isNewMeasurement(measurementData) {
    // Determine if the measurement has been registered with the API
    // @returns undefined (invalid measurement) or bool 

    if (!measurementData) {
      return;
    }

    // Unpack measurement metadata and attributes
    const { measurementMeta, _id } = MeasurementApi._unpackMeasurementData(measurementData);

    // Retrieve tool config and type
    const _tool = MeasurementApi._getToolType(measurementData);
    const toolConfig = MeasurementApi.getToolConfiguration(_tool);
    const toolType = toolConfig.tool.parentTool || _tool;
    
    const { timepointApi } = this;
    const currentMeasurement = this.tools[toolType].find((tool) => tool._id === _id) || {};
    const timepointId = currentMeasurement.timepointId || measurementData.timepointId;
    const namingNumber = currentMeasurement.namingNumber || measurementData.namingNumber;

    // Stop here if the needed information is not set
    if (!timepointApi || !timepointId || !toolConfig) {
      return;
    }

    const { toolGroupId } = toolConfig;
    const current = timepointApi.timepoints.find((tp) => tp.timepointId === timepointId);
    const initialTimepointIds = timepointApi.initialTimepointIds();

    // Stop here if there's no initial timepoint, or if the current is any initial
    if (!initialTimepointIds || initialTimepointIds.length < 1 || initialTimepointIds.some((initialtpid) => initialtpid === current.timepointId)) {
      return false;
    }

    return this.measurementExistsAtTimepoints(namingNumber, toolGroupId, initialTimepointIds) === false;
  }

  calculateMaxMeasurementNumber(groupId, filter) {
    // Calculate the measurement number for the provided groupId

    let measurements = [];
    if (groupId) {

      // Get the measurements of the group
      measurements = this.toolGroups[groupId] || [];
    } else {
      // Get all measurements of all groups
      measurements = Object.keys(this.toolGroups).reduce((acc, val) => {
        acc.push(...this.toolGroups[val]);
        return acc;
      }, []);
    }

    const sortedMeasurements = measurements.filter(filter).sort((tp1, tp2) => {
      return tp1.measurementNumber < tp2.measurementNumber ? 1 : -1;
    });

    for (let i = 0; i < sortedMeasurements.length; i++) {
      const toolGroupMeasurement = sortedMeasurements[i];
      const measurement = this.tools[toolGroupMeasurement.toolId].find(
        (tool) => tool._id === toolGroupMeasurement.toolItemId);

      const isNew = measurement && this.isNewMeasurement(measurement);
      if (measurement && !isNew) {
        return measurement.measurementNumber;
      }
    }

    return 0;
  }

  calculateNewMaxMeasurementNumber(groupId, filter) {
    // Determine what the maxiumum measurement number of a new measurement should be

    const sortedMeasurements = this.toolGroups[groupId].filter(filter).sort((tp1, tp2) => {
      return tp1.measurementNumber < tp2.measurementNumber ? 1 : -1;
    });

    for (let i = 0; i < sortedMeasurements.length; i++) {
      const toolGroupMeasurement = sortedMeasurements[i];
      const measurement = this.tools[toolGroupMeasurement.toolId].find(
        (tool) => tool._id === toolGroupMeasurement.toolItemId
      );
      const isNew = measurement && this.isNewMeasurement(measurement);
      if (isNew) {
        return measurement.measurementNumber;
      }
    }

    return 0;
  }

  calculateMeasurementNumber(measurement) {
    // Calculate the measurement number for the measurement

    // Unpack measurement attributes
    const { measurementMeta, measurementData, _id } = MeasurementApi._unpackMeasurementData(measurement);
    const measurementNumber = measurementData.measurementNumber;

    // Retrieve the tool group ID based on the tool type
    const _tool = MeasurementApi._getToolType(measurement);
    const toolGroupId = this.toolsGroupsMap[_tool];

    const filter = (tool) => tool._id !== _id;

    const isNew = this.isNewMeasurement(measurement);

    if (isNew) {
      
      const maxTargetMeasurementNumber = this.calculateMaxMeasurementNumber('targets', filter);
      const maxNonTargetMeasurementNumber = this.calculateMaxMeasurementNumber('nonTargets', filter);
      const maxNewTargetMeasurementNumber = this.calculateNewMaxMeasurementNumber('targets', filter);
      
      if (toolGroupId === 'targets') {

        return Math.max(maxTargetMeasurementNumber, maxNonTargetMeasurementNumber, maxNewTargetMeasurementNumber);
      } else if (toolGroupId === 'nonTargets') {

        const maxNewNonTargetMeasurementNumber = this.calculateNewMaxMeasurementNumber('nonTargets', filter);
        return Math.max(maxTargetMeasurementNumber, maxNonTargetMeasurementNumber, 
          maxNewTargetMeasurementNumber, maxNewNonTargetMeasurementNumber);
      }
    } else {

      const maxTargetMeasurementNumber = this.calculateMaxMeasurementNumber('targets', filter);

      if (toolGroupId === 'targets') {

        return maxTargetMeasurementNumber;

      } else if (toolGroupId === 'nonTargets') {
        const maxNonTargetMeasurementNumber = this.calculateMaxMeasurementNumber('nonTargets', filter);
        return Math.max(maxTargetMeasurementNumber, maxNonTargetMeasurementNumber);

      } else {
        return this.calculateMaxMeasurementNumber(null, filter);
      }
    }

    return 0;
  }

  getPreviousMeasurement(measurementData) {
    // Retrieve measurement that appears before the provided measurement data in the study sequence

    if (!measurementData) {
      return;
    }

    const { timepointId, namingNumber } = measurementData;
    const _tool = MeasurementApi._getToolType(measurementData);
    
    if (!timepointId || !_tool || !namingNumber) {
      return;
    }

    const toolGroupId = this.toolsGroupsMap[_tool];

    // TODO: Remove TrialPatientLocationUID from here and override it somehow
    // by dependant applications. Here we should use the location attribute instead of the uid
    let filter;
    const uid = measurementData.additionalData && measurementData.additionalData.TrialPatientLocationUID;
    if (uid) {
      filter = (tool) =>
        tool._id !== measurementData._id && tool.additionalData && tool.additionalData.TrialPatientLocationUID === uid;
    } else {
      filter = (tool) => tool._id !== measurementData._id && tool.namingNumber === namingNumber;
    }

    const childToolTypes = this.toolGroupTools[toolGroupId];
    for (let i = 0; i < childToolTypes.length; i++) {
      const childToolType = childToolTypes[i];
      const toolCollection = this.tools[childToolType];
      const item = toolCollection.find(filter);

      if (item) {
        return item;
      }
    }
  }

  hasDuplicateMeasurementNumber(measurementData) {
    if (!measurementData) {
      return;
    }

    const _tool = MeasurementApi._getToolType(measurementData);
    const { measurementNumber } = measurementData;
    if (!_tool || !measurementNumber) {
      return;
    }

    const filter = (tool) =>
      tool._id !== measurementData._id && tool.measurementNumber === measurementData.measurementNumber;

    return configuration.measurementTools
      .filter((toolGroup) => toolGroup.id !== 'temp')
      .some((toolGroup) => {
        if (this.toolGroups[toolGroup.id].find(filter)) {
          return true;
        }
        return toolGroup.childTools.some((tool) => {
          if (this.tools[tool.id].find(filter)) {
            return true;
          }
        });
      });
  }

  updateNumbering(collectionToUpdate, propertyFilter, propertyName, increment) {
    // Update the numbering of the provided collection

    collectionToUpdate.filter(propertyFilter).forEach((item) => {
      item[propertyName] += increment;
    });
  }

  updateMeasurementNumberForAllMeasurements(measurement, increment) {
    // Update measurement number for all measurements

    // Unpack measurement attributes
    const { measurementMeta, measurementData, _id } = MeasurementApi._unpackMeasurementData(measurement);
    const measurementNumber = measurementData.measurementNumber || measurementMeta.measurementNumber || measurement.measurementNumber;

    const filter = (tool) => tool._id !== _id && tool.measurementNumber >= measurementNumber;

    configuration.measurementTools
      .filter((toolGroup) => toolGroup.id !== 'temp')
      .forEach((toolGroup) => {
        this.updateNumbering(this.toolGroups[toolGroup.id], filter, 'measurementNumber', increment);

        toolGroup.childTools.forEach((tool) => {
          this.updateNumbering(this.tools[tool.id], filter, 'measurementNumber', increment);
        });
      });
  }

  _addOrUpdateServiceMeasurement(measurement, options) {
    // Add or update the provided measurement instance

    // @input measurement (object): measurement instance to be updated

    // @returns service measurement instance or undefined if the measurement could not be updated
    options = options || {};
    _.defaults(options, { notYetUpdatedAtSource: false, });

    // Retrieve source, tool type, and mappings
    const toolType = MeasurementApi._getToolType(measurement);
    const { source, toolServiceManaged, toolMapping } = this._serviceManagedTool(toolType);

    if (!toolServiceManaged) {
      throw new Error('Unable to process provided measurement, toolType='+toolType+' is not managed by the measurement service.');
    }

    // Unpack measurement meta/data
    const { uid } = MeasurementApi._unpackMeasurementData(measurement);

    if (uid) {
      const _measurement0 = this.measurementService.getMeasurement(uid);

      // Update existing MeasurementService instance
      if (_measurement0) {

        let measurement_uid;
        if (measurement.annotation) {

          // Parse and update measurement via annotation representation
          const measurement_uid = source.annotationToMeasurement(toolType, measurement, true);

        } else {

        // Directly update measurement instance
          measurement_uid = this.measurementService.update(uid, measurement, options.notYetUpdatedAtSource);
        }
          
        return measurement_uid ? this.measurementService.getMeasurement(measurement_uid) : undefined;
      }
    }

    // Add measurement to MeasurementService
    const measurement_uid = this.measurementService.addRawMeasurement(
      source, toolType, measurement, (toolMapping || {}).toMeasurementSchema);

    return measurement_uid ? this.measurementService.getMeasurement(measurement_uid) : undefined;
  }

  addMeasurement(toolType, measurement, options) {
    // Add measurement to the measurement service and viewer. This method performs duplicate
    // testing to check for 

    // @input toolType (str): label/name of the tool to which the measurement should be added
    // @input measurement (JavaScript object following the MeasurementService schema):
    //   measurement to be added to the service.
    // @input options (object): options to be used when adding the measurement to the API.

    // @returns measurement instance from service. For tools not managed by the measurement service,
    //   this method passes through to addMeasurementRepresentation and returns the representation object.

    const _measurement = measurement;
    measurement = _.cloneDeep(measurement);

    options = options || {};

    // Retrieve mappings, mapping definitions, and check if the tool is managed by the MeasurementService
    const { mappings, toolServiceManaged, toolMapping } = this._serviceManagedTool(toolType);

    // Use MeasurementService for measurement if a mapping is defined.
    if (toolServiceManaged) {

      if (!mappings || !mappings.length) {
        throw new Error('Attempting to initialize measurements service when no mappings are present. Invalid configuration.');
      }
   
      // Apply data transforms to input data
      if (toolMapping && _.isFunction(toolMapping.cleanAnnotation)) {
        measurement = toolMapping.cleanAnnotation(measurement);
      }

      // Check measurement for duplicates (via _measurementServiceId attributes)
      const { measurementMeta, measurementData, uid: _uid } = MeasurementApi._unpackMeasurementData(measurement);

      if (_uid) {

        // Ensure that the root of the measurement instance is tagged with the UID, since the UID
        // may be attached at multiple points in the measurement structure.
        if (!measurement.uid) { measurement.uid = _uid }
      }

      return this._addOrUpdateServiceMeasurement(measurement, options);
    }

    // No mapping defined, pass through to addMeasurementRepresentation
    return this.addMeasurementRepresentation(toolType, measurement);
  }

  addMeasurementRepresentation(toolType, measurementRepresentation) {
    // Add the provided measurement representation to the Sonador Viewer / Cornerstone 3D tools state
    // to trigger rendering of the measurement data. Can be called directly for legacy tool classes not 
    // integrated with MeasurementService. When passing measurement representations for tools
    // managed by the MeasurementService, the "annotation" version of the measurement should
    // be used as the measurement representation. Representations are passed directly to their tool instances.

    // @input toolType (str): tool type to which the measurement representation should be added
    // @input measurementRepresentation (object): measurement representation to be added to the
    //  Cornerstone Tools state. Measurement representations have a distinct layout than the
    //  OHIF v3 measurement schema and are identified via the `_id` attribute.

    // @returns measurementRepresentation

    // Create a copy of the measurement representation so that data processing does not
    // corrupt the source input.
    const _measurement = measurementRepresentation;
    let measurement = _.cloneDeep(_measurement);

    // Unpack measurement attributes
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(_measurement);
    const measurementNumber = measurement.measurementNumber || measurementMeta.measurementNumber || measurementData.measurementNumber;
    
    // Tool group, group collection, and collection
    const toolGroup = this.toolsGroupsMap[toolType];
    const groupCollection = this.toolGroups[toolGroup];
    const collection = this.tools[toolType];

    // Get the related measurement by the measurement number and use its location if defined
    const relatedMeasurement = collection.find(
      (t) => t.measurementNumber === measurementNumber && t.toolType ===  MeasurementApi._getToolType(measurement));

    // Use the related measurement location if found and defined
    if (relatedMeasurement && relatedMeasurement.location) {
      measurement.location = relatedMeasurement.location;
    }

    // Use the related measurement description if found and defined
    if (relatedMeasurement && relatedMeasurement.description) {
      measurement.description = relatedMeasurement.description;
    }

    // Generate a UID if one is not specified on the measurement already
    if (!measurement._id) {
      measurement._id = guid();

      // Generate a measurement _id and attach it to the main body
      measurement._id = guid();
      log.warn('[measurementAPI:addMeasurementRepresentation] GUID assigned to measurement. GUID='+measurement._id);

      // Attach the measurement _id to the metadata section
      if (!measurement.metadata) measurement.metadata = {};
      measurement.metadata._id = measurement._id;
    }

    // Retrieve the timepoint for the measurement: resolution order of properties.
    // * m.referenceStudyUID (OHIF v3 schema)
    // * m.StudyInstanceUID (Cornerstone v4 Legacy schema)
    // * m.metadata.StudyInstanceUID (Cornerstone v4 Legacy Schema, alt1)
    // * measurement.measurementData.StudyInstanceUID (Cornerstone v4 Legacy Schema, alt2)
    let timepoint;
    const StudyInstanceUID = measurement.referenceStudyUID || measurement.StudyInstanceUID
      ||  measurementMeta.StudyInstanceUID  || measurementData.StudyInstanceUID;
    
    if (StudyInstanceUID) {

      // Use default timepoint for the study
      timepoint = this.timepointApi.study(StudyInstanceUID)[0];
    } else {

      // Retrieve timepoint specified by the measurement
      const timepointId = measurementMeta.timepointId || measurementData.timepointId || measurement.timepointId;
      timepoint = this.timepointApi.timepoints.find((t) => t.timepointId === timepointId);
    }

    // Preventing errors thrown when non-associated (standalone) study is opened...
    // @TODO: Make sure this logic is correct.
    if (!timepoint) {

      log.warn('[measurementAPI:addMeasurementRepresentation:timepoint] Unable to retrieve timepoint '
        + 'for measurement. Skip render. timepoint', timepoint, 'measurement', measurement);
      return;
    } 

    // Empty Item just added in cornerstoneTools, but does not have measurement data yet
    const emptyItem = groupCollection.find((groupTool) => !groupTool.toolId && groupTool.timepointId === timepoint.timepointId);

    // Set the timepointId attribute to measurement to make it easier to filter measurements by timepoint
    measurement.timepointId = timepoint.timepointId;

    // Check if the measurement data is just added by a Cornerstone tool and is still empty
    if (emptyItem) {
      
      // Set relevant initial data and measurement number to the measurement
      measurement.measurementNumber = emptyItem.measurementNumber;

      groupCollection.filter((groupTool) => groupTool.timepointId === timepoint.timepointId)
        .forEach((groupTool) => {
          groupTool.toolId = tool.id;
          groupTool.toolItemId = _id;
          groupTool.createdAt = measurement.createdAt;
          groupTool.measurementNumber = measurement.measurementNumber;
        });
    
    } else {
      
      // Handle measurements not added by cornerstone tools and update its number
      const measurementsInTimepoint = groupCollection.filter(
        (groupTool) => groupTool.timepointId === timepoint.timepointId);
      measurement.measurementNumber = measurementNumber || this.calculateMeasurementNumber(measurement) + 1;
    }

    // Define an update object to reflect the changes in the collection
    const updateObject = {
      timepointId: timepoint.timepointId,
      measurementNumber: measurement.measurementNumber || measurementNumber,
    };

    // Find the matched measurement from other timepoints
    const found = this.getPreviousMeasurement(measurement);

    // Check if a previous related meausurement was found on other timepoints
    if (found) {
      
      // Use the same number as the previous measurement
      measurement.measurementNumber = found.measurementNumber;

      // TODO: Remove TrialPatientLocationUID from here and override it somehow
      // by dependant applications

      // Change the update object to set the same number, additionalData,
      // location, label and description to the current measurement
      updateObject.measurementNumber = found.measurementNumber;
      updateObject.additionalData = measurement.additionalData || {};
      updateObject.additionalData.TrialPatientLocationUID =
        found.additionalData && found.additionalData.TrialPatientLocationUID;
      updateObject.location = found.location;
      updateObject.label = found.label;
      updateObject.description = found.description;
      updateObject.isNodal = found.isNodal;

      const description = getDescription(found, measurement);
      if (description) {
        updateObject.description = description;
      }
    } else if (this.hasDuplicateMeasurementNumber(measurement)) {

      // Update measurementNumber for the measurements with masurementNumber greater or equal than
      // measurementNumber of the added measurement (except the added one)
      // only if there is another measurement with the same measurementNumber
      this.updateMeasurementNumberForAllMeasurements(measurement, 1);
    }

    // Package measurement representation to be added to the Cornerstone Tool state.
    // Important schema attributes for representations:
    // * _id (unique identifier): uniquely identifies the schema and allows for it to be updated.
    // * measurementNumber (int): display number of the measurement. Used for grouping measurements in the
    //   the image viewport.
    // * metadata.isLocked (bool): toggles whether the measurement can be updated or changed.
    // * metadata.isReadOnly (bool): toggles whether the measurement can be tagged, have a description added,
    //   or persisted to a DICOM-SR document.

    let addedMeasurement;

    // Upsert the measurement in collection: search existing collection for a tool state
    // entry which matches the _id of the measurement.
    const toolIndex = collection.findIndex((tool) => tool._id === _id);

    if (toolIndex > -1) {

      // Existing measurement instance, update attributes and re-insert to 
      // the tool collection. Ensure _id is defined and matches the _id of
      // the input measurement instance.
      addedMeasurement = Object.assign({}, collection[toolIndex], updateObject);
      if (!addedMeasurement._id) addedMeasurement._id = _id;
      collection[toolIndex] = addedMeasurement;

    } else {

      // New measurement instance, update attributes and append to the
      // end of the tool collection. Also ensure that _id is defined
      // and matches _id of the input measurement instance.
      addedMeasurement = Object.assign({}, measurement, updateObject);
      if (!addedMeasurement._id) addedMeasurement._id = _id;
      collection.push(addedMeasurement);
    }

    // Ensure that the added measurement includes a metadata section
    if (!addedMeasurement.metadata) addedMeasurement.metadata = {};

    // Unpack lifecycle attributes
    const { isReadOnly, isLocked } = MeasurementApi._unpackMeasurementLifecycleAttrs(measurement);

    if (isReadOnly) {
      addedMeasurement.metadata.isReadOnly = isReadOnly;
    }
    if (isLocked) {
      addedMeasurement.isLocked = isLocked;
    }

    if (!emptyItem) {

      // Create pointer record in the group collection for the measurement.
      groupCollection.push({
        toolId: toolType,
        toolItemId: addedMeasurement._id,
        timepointId: timepoint.timepointId,
        StudyInstanceUID: addedMeasurement.StudyInstanceUID || measurementMeta.StudyInstanceUID || _measurement.referenceStudyUID,
        createdAt: addedMeasurement.createdAt,
        measurementNumber: addedMeasurement.measurementNumber,
      });

    } else {
      log.warn('[measurementAPI:addMeasurementRepresentation] empty item, no entry added to group collection', emptyItem);
    }

    // Let others know that the measurements are updated
    this.onMeasurementsUpdated();

    // Notify (via measurement service) integrated components that a new measurement was added
    this.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_REPRESENTATION_ADDED, {
      measurementRepresentation: addedMeasurement,
    });

    return addedMeasurement;
  }

  updateMeasurement(toolType, measurement, options) {
    //  Update measurement with new data

    //  @input toolType (str): tool type
    //  @input measurement (JSON object): new measurement data to add to the service
    //  @input options (object): options for the update
    //   - annotationData (bool, default=false): if true, the measurement is processed via the annotationToMeasurement
    //      callable of the measurement service source. 

    options = options || {};
    _.defaults(options, {
      annotationData: false,
      notYetUpdatedAtSource: false,
    });

    toolType = toolType || MeasurementApi._getToolType(measurement);
    log.debug('[measurementAPI:updateMeasurement] measurement data for toolType='+toolType+' updatedAtSource='+!options.notYetUpdatedAtSource, measurement);

    const _measurement = measurement;
    measurement = _.cloneDeep(measurement);

    // Unpack measurement and service attriburtes
    const { measurementMeta, measurementData, _id, uid } = MeasurementApi._unpackMeasurementData(measurement);
    const { source, toolServiceManaged, toolMapping } = this._serviceManagedTool(toolType);

    if (toolServiceManaged) {

      // Parse to measurement schema
      if (options.annotationData) {

        // Ensure that the measurement includes both UID and _id annotations and convert to measurement schema
        measurement = MeasurementApi._backfillMeasurementRepresentationIdentifiers(measurement);
        measurement = toolMapping.toMeasurementSchema(measurement);
      }

      // Ensure that the measurement is registered with the service
      const measurement0 = this.measurementService.getMeasurement(uid);
      if (!measurement0) {

        // Process measurement update via "addMeasurement", which assess to determine if it's a new instance
        // and whether it is a "raw" measurement / annotation or whether it uses the OHIF v3 schema.
        return this.addMeasurement(toolType, measurement, options);
      }

      // Process measurement update
      const measurement_uid = this.measurementService.update(uid, measurement, options.notYetUpdatedAtSource);
      return measurement_uid ? this.measurementService.getMeasurement(measurement_uid) : undefined;
    }

    return this.updateMeasurementRepresentation(toolType, measurement);
  }

  updateMeasurementRepresentation(toolType, measurementRepresentation, options) {
    // Update Cornerstone Tools Representation with new data

    // @input toolType (str): tool type to be updated
    // @input measurement (JSON object): new measurement representation data

    // @returns measurement representation or undefined if the masurement representation
    //  could not be found.
    options = options || {};
    _.defaults(options, { replace: false, });

    const _measurement = measurementRepresentation;
    let measurement = _.cloneDeep(measurementRepresentation);

    // Unpack measurement data structure
    const { uid, _id } = MeasurementApi._unpackMeasurementData(measurement);

    // Retrieve tools collection
    const collection = this.tools[toolType];
    if (collection) {

      const toolIndex = collection.findIndex((tool) => tool._id === _id);
      if (toolIndex < 0) {
        log.warn('[measurementAPI:updateMeasurement] unable to locate measurement _id='+_id+'. Cancel update.');
        return;
      }

      // Update tool data within the collection
      const measurement0 = collection[toolIndex];
      const updatedMeasurement = Object.assign(options.replace ? {} : measurement0, measurement);
      collection[toolIndex] = updatedMeasurement;

      // Notify (via measurement service) integrated components that a measurement representation was updated
      this.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_REPRESENTATION_UPDATED, {
        measurementRepresentation: updatedMeasurement,
      });

      // Trigger callbacks associated with the API and return updatedMeasurement instance
      this.onMeasurementsUpdated();
      return updatedMeasurement;
    }
  }

  rebuildMeasurementRepresentations(toolType, options) {
    // Re-populate the measurement API collection from the measurement service for the provided toolType
    const _api = this;

    const { source, toolServiceManaged } = this._serviceManagedTool(toolType)
    if (!toolServiceManaged) {
      log.warn('[measurementAPI:rebuildMeasurementRepresentations] measurement representations can only be '
        + 'populated for tools which are integrated with MeasurementService. toolType='+toolType
        + ' not registered with MeasurementService instance.');
      return;
    }

    // Ensure that the collection for the toolType is defined
    if (_.isUndefined(this.tools[toolType])) {
      this.tools[toolType]  = [];
    }

    // Iterate over measurements in the service and re-register their representations
    _.each(this.serviceMeasurements((m) => m.toolName && m.toolName == toolType, options), (m) => {

      // Retrieve annotation from measurement service
      const { uid: sUid } = MeasurementApi._unpackMeasurementData(m);
      if (sUid) {
        const a = source.getAnnotation(toolType, sUid);
        if (a) {

          // Update measurement representation
          _api.addMeasurementRepresentation(a);
        }
      }
    });

    _api.syncMeasurementsAndToolData();
    log.debug('[measurementAPI:rebuildMeasurementRepresentations] rebuild of toolType='+toolType+' complete',
      _api.tools[toolType]);
  }

  onMeasurementRemoved(toolType, measurement) {
    // Synchronize tool state across integrated components
    const { measurementNumber } = measurement;

    // Remove measurement from MeasurementService
    const _measurement = this.measurementService.getMeasurement(measurement.uid || measurement._id);
    if (_measurement) {
      this.measurementService.remove(_measurement.uid);
    }

    const toolGroupId = this.toolsGroupsMap[toolType];
    const groupCollection = this.toolGroups[toolGroupId];

    const groupIndex = groupCollection.findIndex((group) => group.toolItemId === measurement._id);
    if (groupIndex < 0) {
      return;
    }

    //  Remove the deleted measurement only in its timepoint from the collection
    groupCollection.splice(groupIndex, 1);

    //  Check which timepoints have the deleted measurement
    const timepointsWithDeletedMeasurement = groupCollection
      .filter((tool) => tool.measurementNumber === measurementNumber)
      .map((tool) => tool.timepointId);

    //  Update measurementNumber only if there is no timepoint with that measurement
    if (timepointsWithDeletedMeasurement.length < 1) {

      const toolGroup = configuration.measurementTools.find((tGroup) => tGroup.id === toolGroupId);
      if (toolGroup && toolGroup.childTools) {
        toolGroup.childTools.forEach((childTool) => {
          const collection = this.tools[childTool.id];
        });
      }

      //  Decrease measurementNumber of all measurements with measurementNumber greater than measurementNumber of the deleted measurement by 1
      this.updateMeasurementNumberForAllMeasurements(measurement, -1);
    }

    // Synchronize the new tool data
    this.syncMeasurementsAndToolData();

    // Let others know that the measurements are updated
    this.onMeasurementsUpdated();

    // TODO: Enable reactivity
    // this.timepointChanged.set(timepoint.timepointId);
  }

  syncMeasurementsAndToolData() {
    // Sync all measurements with their Cornerstone tool data representation

    configuration.measurementTools.forEach((toolGroup) => {
      // Skip the tool groups excluded from case progress
      if (!MeasurementApi.isToolIncluded(toolGroup)) {
        return;
      }
      toolGroup.childTools.forEach((tool) => {
        // Skip the tools excluded from case progress
        if (!MeasurementApi.isToolIncluded(tool)) {
          return;
        }
        const measurements = this.tools[tool.id];
        measurements.forEach((measurement) => {
          MeasurementApi.syncMeasurementAndToolData(measurement);
        });
      });
    });
  }

  deleteMeasurements(toolType, measurementTypeId, filter, options) {
    // Delete measurements from the API. This method can be used to clear 
    // entire groups of entries as well as to target specific instances for deletion.
    // To target specific measurements (as a precaution against removing data incorrectly),
    // a list of measurement serivce IDs (uid) attributes or Cornerstone tools ID (_id) can be included.
    // When uids or _ids are included, an entry only needs to match one of the lists to be
    // queued for removal.    

    // @input toolType (str): tool type for which the measurements should be removed
    // @input measurementTypeId (str): ID for the measurement types to remove
    // @input filter (object): filter function used to match Cornerstone groups
    // @input options (object): options for the method
    //  - uids (array): white-list of measurement UIDs for removal. Instances which
    //      match the filter and are included in the list will be queued.
    //  - _ids (array): white-list of measurement _ids for removal. Instance which 
    //      match the filter and are included in the list will be queued.

    const _api = this;
    options = options || {};
    _.defaults(options, { triggerService: false });

    log.warn('[measurementAPI:deleteMeasurements] delete measurement from API='+toolType, measurementTypeId, options);
    
    // Collect measurement filter components
    const filterKeys = Object.keys(filter);
    const groupCollection = this.toolGroups[measurementTypeId];    

    // Stop here if it is a temporary toolGroups
    if (!groupCollection) {
      log.warn('[measurementAPI:deleteMeasurements] unable to locate group collection, measurementTypeId='+measurementTypeId);
      return;
    }

    // Retrieve measurement entries
    const groupItems = groupCollection.filter((toolGroup) => {
      return filterKeys.every((filterKey) => toolGroup[filterKey] === filter[filterKey]);
    });

    // Aggregate entries to be removed. First pass scan happens via group items.
    // After entries are identified, a second pass scan proceeds via the tool entries
    // to identify and remove child measurement instances. If a white list is included
    // with options, the groupItem must include either the _id (Cornerstone Tools) 
    // or uid (MeasurementService) before the measurement will be queued for removal.
    const entries = [];
    
    groupItems.forEach((groupItem) => {
      if (!groupItem.toolId) {
        return;
      }

      const collection = this.tools[groupItem.toolId];
      const toolIndex = collection.findIndex((tool) => {
        const _toolMeta = tool.metadata || tool;
        const _tool_id = _toolMeta._id || tool._id;
        
        // Check that the tool ID matches the group item to be removed.
        const _group_match = _tool_id === groupItem.toolItemId;
        return _group_match;
      });

      if (toolIndex > -1) {

        // If whitelist of _ids or uids is provided, ensure that the groupItem is included.
        let _rm_groupItem = true;
        if (options._ids || options.uids) {

          // Explicitly prevent measurement from being removed unless the _id or uid is included in the
          // the whitelist. This solves an issue with this method being "over eager" to remove
          // an entire group of measurements.
          _rm_groupItem = groupItem.toolItemId && (options._ids || []).includes(collection[toolIndex]._id)
            || (options.uids || []).includes(collection[toolIndex].uid || collection[toolIndex]._measurementServiceId);
        }
        
        if (_rm_groupItem) {

          // Queue measurement for removal and splice from the collection
          entries.push(collection[toolIndex]);
          collection.splice(toolIndex, 1);
        }
      }
    });

    // Stop here if no entries were found
    if (!entries.length) {
      log.warn('[measurementAPI:deleteMeasurements] no entries matching deletion criteria found');
      return;
    }

    // Create a local copy of the Cornerstone Tool State to remove tool instances
    const toolState = cornerstoneTools.globalImageIdSpecificToolStateManager.saveToolState();

    // Iterate through entries and determine which need to be removed from global state
    entries.forEach((entry) => {
      
      const measurementsData = [];

      // Retrieve tool configuration
      const { tool } = MeasurementApi.getToolConfiguration(toolType);
      
      if (Array.isArray(tool.childTools)) {

        tool.childTools.forEach((key) => {
          const childMeasurement = entry[key];
          if (!childMeasurement) return;
          measurementsData.push(childMeasurement);
        });
      } else {

        // If _ids or uid whitelist included, only remove entries specified in the list
        if (options._ids || options.uids) {
          if ((options._ids || []).includes(entry._id) 
              || (options.uids || []).includes(entry.uid || entry._measurementServiceId)) {
            measurementsData.push(entry);
          }
        } else {
          measurementsData.push(entry);    
        }
      }

      measurementsData.forEach((measurementData) => {
        // Remove measurements from the collection

        // Unpack measurement ID attrs
        const _tool = MeasurementApi._getToolType(measurementData);
        const { imageId, imagePath } = MeasurementApi._getImageIdentifiers(measurementData);

        // Retrieve Image ID from imagePath
        if (imageId && toolState[imageId]) {
          const toolData = toolState[imageId][_tool];

          // Retrieve Cornerstone Tools measurement representation
          const measurementEntries = toolData && toolData.data;
          const measurementEntry = measurementEntries.find((mEntry) => mEntry._id === entry._id);
          if (measurementEntry) {
            const index = measurementEntries.indexOf(measurementEntry);
            measurementEntries.splice(index, 1);
          }
        }
      });

      this.onMeasurementRemoved(toolType, entry);
    });

    // Update display state
    cornerstoneTools.globalImageIdSpecificToolStateManager.restoreToolState(toolState);

    // Synchronize the updated measuremen attributes (such as measurmeent number)
    // to ensure that measurements display attributes such as 'Target X' correctly
    
    const syncFilter = Object.assign({}, filter);
    delete syncFilter.timepointId;

    const syncFilterKeys = Object.keys(syncFilter);
    const toolTypes = [...new Set(entries.map((entry) => MeasurementApi._getToolType(entry)))];

    toolTypes.forEach((toolType) => {
      const collection = this.tools[toolType];
      
      collection.filter((tool) => {
          return syncFilterKeys.every((syncFilterKey) => tool[syncFilterKey] === filter[syncFilterKey]);
        })
        .forEach((measurement) => { MeasurementApi.syncMeasurementAndToolData(measurement); });
    });

    // Clear measurements from service
    if (options.triggerService) {
      this.measurementService.clearMeasurements(options.serviceFilter);
    }
  }

  clearMeasurements() {
    // Clear all measurements, measurement representations, and tool state from API
    const _api = this;

    this.measurementService.triggerApiEvent(Enums.EVENTS.MEAUSREMENT_CLEAR_START, {
      api: this, measurementRepresentations: this.tools,
    });

    // Clear annotations service
    let _count = this.measurementsCount(null, { serviceSourceCheck: false });
    if (_count && _count.service > 0) {
      this.measurementService.clearMeasurements();
    }

    // Clear all measurement representations
    _.each(this.tools, (toolCollection, toolType) => {

      // Purge any measurement representations left in the local API state from Cornerstone cache
      while (toolCollection.length > 0) {

        // Utilize pop to ensure that the tool collection array processes the removal.
        // This is necessary since changes to the measurement state needs to be reflected
        // in the timepoints manager and other state objects spread throughout the viewer codebase
        // and there can be delay in processing and garbage collection which cause references
        // to persist which cause ghost records.
        const _m = toolCollection.pop();
        if (_m.imagePath) {
          const imageId = getImageIdForImagePath(_m.imagePath);
          MeasurementApi.purgeCornerstoneToolData(toolType, imageId, _m);
        }
      }
    });

    // Synchronize tool state
    this.syncMeasurementsAndToolData();
    refreshCornerstoneViewports();

    // Iterate through all tools state annotations and remove those entries which
    // may have been accidentally missed when deleting the local representations
    // and the annotations managed by the measurements service. Cornerstone is VERY
    // aggressive about caching annotation data so that state is not lost.
    const { toolState: globalToolState } = cornerstoneTools.globalImageIdSpecificToolStateManager;
    _.each(globalToolState, (toolData, imageId) => {

      // Iterate through each tool array and truncate all tool data
      _.each(toolData, (toolArray, toolType) => {
        cornerstoneTools.globalImageIdSpecificToolStateManager.setImageIdToolState(imageId, toolType, { data: [] });
      });
    });

    // Refresh tool state from empty structure    
    refreshCornerstoneViewports();
    
    this.measurementService.triggerApiEvent(Enums.EVENTS.MEASUREMENT_CLEAR_SUCCESS, {
      api: this, measurementRepresentations: this.tools,
    });
  }
}
