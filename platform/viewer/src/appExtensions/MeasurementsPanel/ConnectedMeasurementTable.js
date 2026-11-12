// Integration methods for Sonador Viewer, OHIF Measurement Service, and the measurements table.
// Provides methods to load / navigate to a specific measurement, trigger a "labelling" workflow
// which allows users to update the description / label of the annotation, and basic CRUD operations.
import _ from 'lodash';

import { connect } from 'react-redux';
import cornerstone from 'cornerstone-core';
import moment from 'moment';

import OHIF, { DICOMSR, DicomMetadataStore, displayAttributes } from '@ohif/core';
import { MeasurementTable } from '@ohif/ui';

import { commandsManager } from '../../App';
import jumpToRowItem from './jumpToRowItem.js';
import navigateToMeasurementInMpr, { isMprActive } from './mprMeasurementNavigation.js';
import { navigateToOutOfPlane, openOutOfPlaneInMpr, outOfPlaneRecordOf, outOfPlaneRows } from './outOfPlaneRows.js';
import { callConfirmDialog } from '@ohif/extension-cornerstone/src/utils/callConfirmDialog';
import { callColorPickerDialog } from '@ohif/extension-cornerstone/src/utils/colorPickerDialog';
import measurementDetailSource from './measurementDetailSource.js';

const { setViewportSpecificData } = OHIF.redux.actions;
const { MeasurementApi } = OHIF.measurements;
const { DisplaySetApi } = OHIF.display;


function groupBy(list, keyOf) {
  /**
  * Takes a list of objects and a key function and return the list grouped by the key
  *
  * @param {Array} list - The objects to be grouped by
  * @param {Function} keyOf - The key of an object
  * @returns {Object}
  */

  return list.reduce((a, b) => {
    const key = keyOf(b);
    (a[key] = a[key] || []).push(b);
    return a;
  }, {});
}

/** The row of a measurement representation: its _id, else (no _id) its measurement number */
const rowKeyOf = representation => (representation._id ? `id:${representation._id}` : `number:${representation.measurementNumber}`);

/** Whether a representation is the one a panel row shows: by its _id, else by its number */
export const isRowEntry = (entry, row) => (row.measurementId
  ? entry._id === row.measurementId : entry.measurementNumber === row.measurementNumber);


function getAllTools(toolGroups = []) {
  /**
  *  Takes a list of tools grouped and return all tools separately
  *
  * @param {Array} [toolGroups=[]] - The grouped tools
  * @returns {Array} - The list of all tools on all groups
  */

  let tools = [];
  toolGroups.forEach((toolGroup) => (tools = tools.concat(toolGroup.childTools)));

  return tools;
}


function getMeasurementText(measurement, location='', description='', options) {
  /**
  * Create the measurement display text to be used into the table
  *
  * @param (object) measurement: measurement or annotation from which the location, description, and
  *   other display parameters should be taken. This method supports parsing of OHIF v3, Cornerstone v4,
  *   and Sonador viewer schemas. If present, the OHIF v3 schema will take precedence followed by Cornerstone v4.
  *   - @attr measurementData (object): `measurementData`` or data attribute. Inspected for the description
  *       and location attributes.
  *   - @attr measurementMeta (object): `metadata` attribute. Inspected for the description and location attributes.
  * 
  * @param {string} location (default=''): override parameter for location. If provided, will take precedence
  *   over the attribute parsed from measurement.
  * @param {string} description (default=''): override paramter for description. If provided, will take precedence
  *   over the attribute parsed from measurement.
  * 
  * @param options (object): function options
  *   - defaultText (str, default='...'): default text to be used for the measurement if it is not possible to
  *       retrieve a location or description.
  * @returns {string}
  */
  options = options || {};
  _.defaults(options, {
    defaultText: '...',
  });

  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);  

  // Parse measurement text attributes
  location = location || measurementMeta.location || measurementData.location || '';
  description = description || measurement.description || measurementData.description || measurementMeta.description || '';

  const _result = [];
  if (location) _result.push(location);
  if (description) _result.push(description);

  // Combine location and description, return result or default
  const result = _result.length ? _result.join(' / ') : '';
  return result || options.defaultText;
}


function getDataForEachMeasurementNumber(measurementNumberList, timepoints, displayFunction) {
  /**
  * Takes a list of measurements grouped by measurement numbers and return each measurement data by available timepoint
  *
  * @param {Array} measurementNumberList - The list of measurements
  * @param {Array} timepoints - The list of available timepoints
  * @param {Function} displayFunction - The function that builds the display text by each tool
  * @returns
  */  
  const data = [];
  
  // on each measurement number we should get each measurement data by available timepoint
  measurementNumberList.forEach((measurement) => {
    timepoints.forEach((timepoint) => {
      const eachData = {
        displayText: '...',
      };
      if (measurement.timepointId === timepoint.timepointId) {
        eachData.displayText = displayFunction(measurement);
      }
      data.push(eachData);
    });
  });

  return data;
}


function getWarningsForMeasurement(toolName, options) {
  /**
  * Take a measurement toolName and create the warning list
  *
  * @param {string} toolName - The tool name
  * @returns {string}
  */
  options = options || {};
  _.defaults(options, {
    warningList: [],
  });

  // Check if the tool is a DICOMSRDisplayTool instance
  let warningTitle;
  const dicomSrTool = _.values(DICOMSR.Enums.TOOL_NAMES).includes(toolName);

  const isToolSupported = DICOMSR.isToolSupported(toolName);
  if (!isToolSupported) {
    warningTitle = 'Tool not supported by Sonador Viewer';
    options.warningList.push('Tool not supported by Sonador viewer. Unable to display annotations and measurements.');
  }

  const { toolServiceManaged } = MeasurementApi.Instance._serviceManagedTool(toolName);
  if (!toolServiceManaged) {
    options.warningList.push(`Data from ${toolName} cannot be persisted to the server at this time.`);
  }

  if (!warningTitle && options.warningList.length) warningTitle = 'Tool partially supported by Sonador Viewer';

  return {
    hasWarnings: options.warningList.length > 0,
    warningTitle, warningList: options.warningList,
  };
}


export function seriesTagDisplay(toolType, measurement, measurementMeta, measurementData) {
  // Custom colors of a Series Tag finding for the measurements table: those that differ from the
  // default display profile. Value and Meaning color the text, Background marks the index cell;
  // otherwise the table's own colors are used.
  if (toolType !== DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG) {
    return undefined;
  }

  const carrier = measurement.displayAttributes || measurementData.displayAttributes || measurementMeta.displayAttributes;
  const stored = displayAttributes.getDisplayColor({ displayAttributes: carrier });
  const defaults = displayAttributes.resolveDisplayColor(toolType);
  const color = {};
  ['Background', 'Value', 'Meaning'].forEach(role => {
    if (stored[role] && stored[role] !== defaults[role]) {
      color[role] = stored[role];
    }
  });

  return {
    color,
    value: measurement.value || measurementData.value,
    meaning: measurementMeta.text || measurementData.text || measurement.text,
  };
}


function measurement2tableitem(tool, timepoints, measurementNumberList, csMeasurementData) {
  // Convert the provided measurement to the meaurements table item schema

  // @input tool (Cornerstone Tool instance): tool instance associated with the measurement\
  // @input csMeasurementData (object): Cornerstone Tool measurement data.

  // Unpack unique identifiers for Cornerstone Tools (_id) and the MeasurementService (uid)
  const { _id, uid } = MeasurementApi._unpackMeasurementData(csMeasurementData);
  const toolType = MeasurementApi._getToolType(csMeasurementData);

  const { displayFunction } = tool.options.measurementTable;;

  // Retrieve measurement instance from the measurement service (with a fallback to using the csMeasurementData
  // instance if the record cannot be retrieved.
  const { toolServiceManaged } = MeasurementApi.Instance._serviceManagedTool(toolType);
  const measurement = toolServiceManaged ? MeasurementApi.Instance.getServiceMeasurementByCornerstoneId(_id) : csMeasurementData;

  if (measurement) {

    // Create separate reference to data and meta sections to help with unpacking.
    // Retrieve UID from the measurement to help with linking.
    const { measurementMeta, measurementData, uid } = MeasurementApi._unpackMeasurementData(measurement);
    const { isLocked, isReadOnly, isDirty, isVisible } = MeasurementApi._unpackMeasurementLifecycleAttrs(measurement);

    // Measurement table attributes
    const measurementNumber = csMeasurementData.measurementNumber || measurementData.measurementNumber || measurement.measurementNumber;
    const { hasWarnings, warningTitle, warningList } = getWarningsForMeasurement(toolType);

    // Check if all measurements with same measurementNumber will have same LABEL
    const tableMeasurement = {
      measurementNumber,
      itemNumber: measurementNumber,
      toolType,
      // The tool a report's measurement was drawn with ("cornerstoneTools@^4.0.0:Length"): the
      // row of a measurement read from a report has the display tool's type
      trackingIdentifier: MeasurementApi.trackingIdentifierOf(measurement),
      measurementId: _id,
      _measurementServiceId: uid,
      label: getMeasurementText(measurement),
      description: measurement.description || measurementData.description || measurementMeta.description,
      location: measurementMeta.location || measurementData.location,
      labels: measurementData.labels,
      isSRText: measurementData.isSRText,
      hasWarnings,
      isReadOnly: Boolean(isReadOnly),
      isLocked: Boolean(isLocked || isReadOnly),
      // Saved with the others and edited through its service record (a tool without a service
      // mapping, such as the rectangle, is neither)
      isPending: Boolean(toolServiceManaged && uid) && !isReadOnly,
      customColor: MeasurementApi.customLineTextColor(measurement),
      // The measurement and its image's calibration, from which the row builds the measurement's
      // detail (its value, the reference line's +N and the detail card)
      detailSource: measurementDetailSource(measurement),
      isDirty,
      isVisible: _.isNil(isVisible) ? true : isVisible,
      warningTitle,
      warningList,
      data: getDataForEachMeasurementNumber(measurementNumberList, timepoints, displayFunction),
      seriesTagDisplay: seriesTagDisplay(toolType, measurement, measurementMeta, measurementData),
      // Measurement-service records carry the reference UIDs as referenceStudyUID / referenceSeriesUID
      refStudyInstanceUID: MeasurementApi.studyInstanceUIDOf(measurement),
      refSeriesInstanceUID: MeasurementApi.seriesInstanceUIDOf(measurement),
      refSOPInstanceUID: measurement.SOPInstanceUID || measurementMeta.SOPInstanceUID,
    };

    return tableMeasurement;
  }
}


function initTableGroup(toolGroup, options) {
  // Initialize a table group structure which can be used for displaying related measurements.

  options = options || {};
  _.defaults(options, { groupNamePrefix: '', groupIdPrefix: '' });  

  return {
    groupName: options.groupNamePrefix + toolGroup.name,
    groupId: options.groupIdPrefix + toolGroup.id,
    toolGroupId: toolGroup.id,
    measurements: [],
  }
}


function toolgroups2tablegroups(toolGroups, toolCollections, tools, timepoints, filter, options) {
  // Create table group for the provided tool group.

  // @input toolGroups (object): tool group instance
  // @input filter (function): function to be used for testing whether a measurement instance
  //    should be added to the tool group.
  // @input options (object): function options

  // @returns returns toolGroups with the "measurements" array populated with the instances
  //    which match the provided condition.
  options = options || {};

  Object.keys(toolCollections).forEach((toolId) => {

    // Retrieve measurements for the tool collection
    const toolMeasurements = toolCollections[toolId];
    const tool = tools.find((tool) => tool.id === toolId);

    // One row per measurement, in the order of their numbers: two measurements that share a number
    // still have a row each
    const groupedMeasurements = _.sortBy(Object.values(groupBy(toolMeasurements, rowKeyOf)),
      list => Number(list[0].measurementNumber) || 0);

    groupedMeasurements.forEach((measurementNumberList) => {

      // Retrieve Cornerstone tools version of the data
      const csMeasurementData = measurementNumberList[0];

      // A measurement drawn in the viewports only (one of an application document) is not listed
      if (csMeasurementData && csMeasurementData.isListed === false) {
        return;
      }

      // Create table measurement instance and add to the collection
      if (filter(tool, csMeasurementData)) {

        // Create table measurement instance
        const tableMeasurement = measurement2tableitem(tool, timepoints, measurementNumberList, csMeasurementData);
        if (tableMeasurement) {

          // Find the group in the "toolGroups" collection which matches the current tool
          const toolGroupMeasurements = toolGroups.find((group) => {
            return group.toolGroupId === tool.toolGroup;
          });

          if (toolGroupMeasurements) {

            // Add the table measurement instance to the group which matches the tool 
            toolGroupMeasurements.measurements.push(tableMeasurement);
          }
        }
      }
    });
  });

  return toolGroups;
}


export function convertMeasurementsToTableData(toolCollections, timepoints, options = {}) {
  /**
  * Take measurements from MeasurementAPI structure and convert into a measurementTable structure.
  *
  * @param {Object} toolCollections - The list of all measurement grouped by groupTool and toolName
  * @param {Array} timepoints - The list of available timepoints
  * @param {Object} options - { viewports }: the viewports state, for the rows of out-of-plane
  *   measurements (outOfPlaneRows.js), which the classic viewport does not draw
  * @returns
  */

  const { MeasurementApi } = OHIF.measurements;

  const config = MeasurementApi.getConfiguration();
  const toolGroups = config.measurementTools;
  const tools = getAllTools(toolGroups);

  // "Primary" measurements: those which cannot be persisted to DICOM-SR
  const tableMeasurements = toolGroups.map((toolGroup) => initTableGroup(toolGroup));

  // Create "primary" table groups for read-only measurements and measurements not managed
  // by the MeasurementService. A second group of measurements will be created which are "pending"
  // and can be persisted to DICOM-SR. The groups are separate to make it easier for users
  // to determine which measurements will be written to the web server on save.
  toolgroups2tablegroups(tableMeasurements, toolCollections, tools, timepoints, (tool, csMeasurementData) => {

    // Unpack measurement attributes, check if the tool is service managed
    const { toolServiceManaged } = MeasurementApi.Instance._serviceManagedTool(tool.id);
    const { isReadOnly } = MeasurementApi._unpackMeasurementLifecycleAttrs(csMeasurementData);

    // Primary measurement groups are those not managed by the MeasurementService or those which are marked as read only
    return !toolServiceManaged || Boolean(isReadOnly);
  });

  // "Pending" measurements: those which can be persisted
  const pendingMeasurements = toolGroups.map((toolGroup) => initTableGroup(toolGroup, { groupIdPrefix: 'pending', groupNamePrefix: 'Pending ' }));

  // Pending measurements are those managed by the service and not yet saved (read-only); a
  // measurement the user locks stays pending
  toolgroups2tablegroups(pendingMeasurements, toolCollections, tools, timepoints, (tool, csMeasurementData) => {

    // Unpack measurement attributes, check if the tool is service managed and unlocked
    const { toolServiceManaged } = MeasurementApi.Instance._serviceManagedTool(tool.id);
    const { isReadOnly } = MeasurementApi._unpackMeasurementLifecycleAttrs(csMeasurementData);

    return toolServiceManaged && !isReadOnly;
  });

  // Out-of-plane measurements: the saved ones with the saved measurements, the others pending
  const outOfPlane = outOfPlaneRows(tools, { labelOf: measurement => getMeasurementText(measurement), viewports: options.viewports });
  const addRows = (groups, rows) => rows.forEach(({ row, toolGroup }) => {
    const group = groups.find(candidate => candidate.toolGroupId === toolGroup);
    if (group) {
      group.measurements.push(row);
    }
  });
  addRows(tableMeasurements, outOfPlane.saved);
  addRows(pendingMeasurements, outOfPlane.pending);

  const groups = [
    ..._.filter(tableMeasurements, (g) => g.measurements.length > 0), 
    ..._.filter(pendingMeasurements,(g) => g.measurements.length > 0)
  ];

  // Rows are numbered in the order the panel lists them, saved then pending, whatever their source
  // (the measurement numbers of the classic records are not sequential across sources)
  let itemNumber = 0;
  groups.forEach(group => group.measurements.forEach((row) => {
    itemNumber += 1;
    row.itemNumber = itemNumber;
  }));
  return groups;
}


function timepoint2tabledate(timepoint, options) {
  // Format the provided timepoint

  options = options || {};
  _.defaults(options, {
    key: 'StudyDate',
    label: 'Study Date',
  });

  // Determine which date should be used by the timepoint
  let _date = _.orderBy([timepoint.latestDate, timepoint.earliestDate], (d) => d, 'desc')[0];  
  let _mdate = moment(_date);

  // If the date is today's date, then retrieve the study date from the meta cache
  if (_mdate.isSame(moment(), 'day') && timepoint.studyInstanceUIDs && timepoint.studyInstanceUIDs.length) {

    // Retrieve study date from the study associated with the timepoint
    const _s_meta = DicomMetadataStore.getStudy(timepoint.studyInstanceUIDs[0]);
    if (_s_meta && _s_meta.series) {
      
      // Retrieve first series in study
      const _sx_meta = _s_meta.series[0]
      if (_sx_meta && _sx_meta.instances) {

        // Unpack StudyDate from first instance and create moment instance from the header
        const { StudyDate } = _sx_meta.instances[0];
        _date = StudyDate;
        _mdate = moment(_date);
      }
    }    
  }

  return {
    key: options.key,
    label: options.label,
    date: _mdate.format('MMMM DD, YYYY'),
  };
}


function convertTimepointsToTableData(timepoints) {
  /**
  * Take a list of available timepoints and return a list header information for each timepoint
  *
  * @param {Array} timepoints - The list of available timepoints
  * @param {string} timepoints[].latestDate - The date of the last study taken on the timepoint
  * @returns {{label: string, key: string, date: string}[]}
  */

  if (!timepoints || !timepoints.length) {
    return [];
  }  

  return timepoints.map(timepoint2tabledate);
}

  
function getSaveFunction(serverType) {
  /**
  *  Takes server type and return a function or undefined
  *
  * @param {string} serverType - The server type
  * @returns {undefined|Function}
  */
  if (serverType === 'dicomWeb') {
    return () => {

      // Calculate an appropriate "default" series number for the SR instance.
      const srSxMaxNum = _.max(
        [...DisplaySetApi.Instance.displaySetService.getDisplaySetCache().values()]
          .filter((_ds) => _ds.Modality && _ds.Modality == 'SR' && _ds.SeriesNumber )
          .map((_ds) => _.toNumber(_ds.SeriesNumber)));
      const srSxNum = srSxMaxNum ? srSxMaxNum + 1 : 42;

      return commandsManager.runCommand('saveMeasurements', { seriesNumber: srSxNum });
    };
  }
}


const mapStateToProps = (state, ownProps) => {
  // Map state attributes from Redux store to properties for child components. Taking ownProps
  // makes the rows be read again when the panel's data version changes (SonadorMeasurementsTable):
  // the measurement service changes records the store still holds by reference.

  const { timepointManager, servers } = state;
  const { timepoints, measurements } = timepointManager;
  const activeServer = servers.servers.find((a) => a.active === true);
  const saveFunction = getSaveFunction(activeServer.type);

  return {
    server: activeServer,
    timepoints: convertTimepointsToTableData(timepoints),
    measurementCollection: convertMeasurementsToTableData(measurements, timepoints, { viewports: state.viewports }),
    timepointManager: state.timepointManager,
    viewports: state.viewports,
    saveFunction,
  };
};


/** The measurement API record of a panel row, by its tool type and measurement id */
function measurementRecord(measurementData) {
  // An out-of-plane measurement is labelled on its measurement-service record
  if (measurementData.outOfPlane) {
    return outOfPlaneRecordOf(measurementData);
  }
  const toolType = MeasurementApi._getToolType(measurementData);
  const { measurementId } = measurementData;
  const tool = (MeasurementApi.Instance.tools[toolType] || []).find(measurement => measurement._id === measurementId);
  if (!tool) {
    OHIF.log.warn('[MeasurementsPanel] measurement not found for labelling', toolType, measurementId);
  }
  return tool;
}


const mapDispatchToProps = (dispatch, ownProps) => {
  // Map Redux dispatch state to properties for child components

  return {

    
    dispatchRelabel: (event, measurementData) => {
      // Dispatch a "relabel" event, which allows the user to change the label and description
      // of the measurement. Labelling needs no viewport element, so it works whichever viewport
      // is active (the MPR view has no classic element).

      event.persist();

      const tool = measurementRecord(measurementData);
      if (!tool) {
        return;
      }

      // Clone the tool not to set empty location initially
      const toolForLocation = Object.assign({}, tool, { location: null });

      if (ownProps.onRelabel) {
        ownProps.onRelabel(toolForLocation);
      }
    },

    
    dispatchEditDescription: (event, measurementData) => {
      // Edit the measurement's description, whichever viewport is active
      event.persist();

      const tool = measurementRecord(measurementData);
      if (!tool) {
        return;
      }

      if (ownProps.onEditDescription) {
        ownProps.onEditDescription(tool);
      }
    },

    
    dispatchJumpToRowItem: (measurementData, viewportsState, timepointManagerState, options) => {
      // Dispath a "jump to row item" event. Navigating to a row item loads the image the measurement
      // is associated with and renders (or re-loads) annotations active measurements. While the MPR
      // view is open, a measurement of its series is shown in the MPR panes; one of another series
      // is shown in the stack viewport once the user agrees to close the MPR view
      // (mprMeasurementNavigation.js).

      const activateMeasurement = () => {
        const toolType = MeasurementApi._getToolType(measurementData);
        const measurementApi = MeasurementApi.Instance;

        Object.keys(measurementApi.tools).forEach((toolType) => {
          const measurements = measurementApi.tools[toolType];

          measurements.forEach((measurement) => {
            measurement.active = false;
          });
        });

        const measurementsToActive = measurementApi.tools[toolType].filter(measurement => isRowEntry(measurement, measurementData));

        measurementsToActive.forEach((measurementToActive) => {
          measurementToActive.active = true;
        });

        measurementApi.syncMeasurementsAndToolData();

        cornerstone.getEnabledElements().forEach((enabledElement) => {
          if (enabledElement.image) {
            cornerstone.updateImage(enabledElement.element);
          }
        });
      };

      // An out-of-plane measurement is shown in the MPR view only; from the classic viewport its row
      // offers to open it
      if (measurementData.outOfPlane) {
        navigateToOutOfPlane({ measurementData, viewportsState, commandsManager });
        return;
      }

      const jumpInStack = (viewports, timepointManager) => {
        const actionData = jumpToRowItem(measurementData, viewports, timepointManager, dispatch, options);

        actionData.viewportSpecificData.forEach((viewportSpecificData) => {
          const { viewportIndex, displaySet } = viewportSpecificData;
          dispatch(setViewportSpecificData(viewportIndex, displaySet));
        });
        activateMeasurement();
      };

      if (isMprActive(viewportsState)) {
        const uiDialogService = ownProps.servicesManager && ownProps.servicesManager.services.UIDialogService;
        navigateToMeasurementInMpr({
          measurementData,
          viewportsState,
          commandsManager,
          confirm: dialog => callConfirmDialog({ uiDialogService, ...dialog }),
          navigateOutsideMpr: () => {
            const state = window.store.getState();
            jumpInStack(state.viewports, state.timepointManager);
          },
        }).then((outcome) => {
          if (outcome === 'shown') {
            activateMeasurement();
          }
        }).catch(error => OHIF.log.error('[viewer:measurementTable] unable to navigate to the measurement in MPR', error));
        return;
      }

      jumpInStack(viewportsState, timepointManagerState);

      // Needs to update viewports.layout state to set layout
      //const layout = actionData.layout;
      //dispatch(setLayout(layout))

      // Needs to update viewports.activeViewportIndex to the first updated viewport
      //const viewportIndex = actionData.viewportIndex;
      //dispatch(setViewportActive(viewportIndex));

      // Needs to update timepointsManager.measurements state to set active measurementId
      // TODO: Not yet implemented
      //dispatch(setActiveMeasurement(measurementData.measurementId))

      // (later): Needs to set some property on state.extensions.cornerstone to synchronize viewport scrolling
    },
  };
};


const mergeProps = (propsFromState, propsFromDispatch, ownProps) => {
  // Merge Properties from state, dispatch, and component into a single set of attributes
  
  const { timepoints, saveFunction, measurementCollection } = propsFromState;
  const { onSaveComplete, servicesManager, isOpen } = ownProps;

  return {
    server: propsFromState.server,
    servicesManager,
    isOpen,
    timepoints,
    saveFunction,
    measurementCollection,
    onSaveComplete,
    viewports: propsFromState.viewports,
    ...propsFromDispatch,
    
    onItemClick: (event, measurementData) => {
      // TODO: Add timepointId to .data for measurementData?
      // TODO: Tooltype should be on the level below? This should
      // provide the entire row item?

      const viewportsState = propsFromState.viewports;
      const timepointManagerState = propsFromState.timepointManager;

      // TODO: invertViewportTimepointsOrder should be stored in / read from user preferences
      // TODO: childToolKey should come from the measurement table when it supports child tools
      const options = {
        invertViewportTimepointsOrder: false,
        childToolKey: null,
      };

      propsFromDispatch.dispatchJumpToRowItem(measurementData, viewportsState, timepointManagerState, options);
    },

    onRelabelClick: (event, measurementData) => {
      // Retag the measurement

      const viewportsState = propsFromState.viewports;
      propsFromDispatch.dispatchRelabel(event, measurementData, viewportsState);
    },
    
    onEditDescriptionClick: (event, measurementData) => {
      // Modify the measurement description

      const viewportsState = propsFromState.viewports;
      propsFromDispatch.dispatchEditDescription(event, measurementData, viewportsState);
    },
    
    onOpenInMprClick: (event, measurementData) => {
      // Open the MPR view at an out-of-plane measurement
      openOutOfPlaneInMpr({ measurementData, commandsManager, studyMetadataManager: OHIF.utils.studyMetadataManager })
        .catch(error => OHIF.log.error('[viewer:measurementTable] unable to open the MPR view at the measurement', error));
    },

    onToggleLockClick: (event, measurementData) => {
      // Lock or unlock a pending measurement
      MeasurementApi.Instance.toggleLockMeasurement(measurementData._measurementServiceId);
    },

    onViewportValuesChangeClick: (measurementData, keys) => {
      // The values a pending measurement's viewport label shows, chosen from its detail card
      MeasurementApi.Instance.setMeasurementViewportValues(measurementData._measurementServiceId, keys);
    },

    onLineTextColorClick: async (event, measurementData, part) => {
      // Choose the line or text color of a pending measurement from the annotation palette or the
      // picker, starting from the color it is drawn in; Default clears it
      const uid = measurementData._measurementServiceId;
      const uiDialogService = servicesManager && servicesManager.services.UIDialogService;
      if (!uid || !uiDialogService) {
        return;
      }
      const value = MeasurementApi.Instance.measurementLineTextColor(uid, { drawn: true })[part];
      const picked = await callColorPickerDialog({
        uiDialogService,
        value,
        title: part === 'line' ? 'Line Color' : 'Text Color',
        palette: displayAttributes.ANNOTATION_PALETTE,
        allowReset: true,
      });
      if (picked === null) {
        MeasurementApi.Instance.setMeasurementLineTextColor(uid, part, null);
      } else if (picked) {
        MeasurementApi.Instance.setMeasurementLineTextColor(uid, part, OHIF.utils.color.rgb2hex(picked.r, picked.g, picked.b));
      }
    },

    onDeleteClick: (event, measurementData) => {
      // Remove the measurement
      const { MeasurementHandlers } = OHIF.measurements;

      // An out-of-plane measurement is its measurement-service record (its annotation follows)
      if (measurementData.outOfPlane) {
        MeasurementApi.Instance.measurementService.remove(measurementData._measurementServiceId);
        return;
      }

      // Retrieve measurement tool type, tool ID (_id), and 
      const toolType = MeasurementApi._getToolType(measurementData);
      MeasurementHandlers.onRemoved({
        detail: {
          toolType,
          measurementData: {
            _id: measurementData._id || measurementData.measurementId,
            _measurementServiceId: measurementData.uid || measurementData._measurementServiceId,
            measurementNumber: measurementData.measurementNumber,
          },
        },
      });
    },
  };
};


const ConnectedMeasurementTable = connect(mapStateToProps, mapDispatchToProps, mergeProps)(MeasurementTable);


export default ConnectedMeasurementTable;
export { mapDispatchToProps };
