// Lifecycle component used by OHIF to manage retrieving, initializing study data,
// and creating local data representations for display. Data loading is integrated with the 
// DicomMetadataStore, displaySetService and MeasurementService. 

// IMPORTANT: Logic which affects integration between displaySets, measurements,
// metadata, or the dataflow of a study when loaded within the viewer (for example,
// adding locally created DICOM data) should be added to this file.


import _ from 'lodash';

import React, { useCallback, useContext, useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';

import OHIF, {
  log, 
  metadata, 
  studies,
  utils,
} from '@ohif/core';
import { useSnackbarContext } from '@ohif/ui';

import { extensionManager } from '../App';

// Contexts
import AppContext from '../context/AppContext';
import usePrevious from '../hooks/usePrevious';
import NotFound from '../pages/NotFound/NotFound';

import Viewer from './Viewer';

import { servicesManager, commandsManager } from '../App';

const { DicomMetadataStore, measurements, io } = OHIF;
const { displaySetService, customizationService } = servicesManager.services;

const { OHIFStudyMetadata, OHIFSeriesMetadata } = metadata;
const { retrieveStudiesMetadata, deleteStudyMetadataPromise } = studies;
const { studyMetadataManager, makeCancelable, cornerstoneUtils } = utils;


const _promoteToFront = (list, values, searchMethod) => {
  let listCopy = [...list];
  let response = [];
  let promotedCount = 0;

  const arrayValues = values.split(',');
  arrayValues.forEach((value) => {
    const index = listCopy.findIndex(searchMethod.bind(undefined, value));

    if (index >= 0) {
      const [itemToPromote] = listCopy.splice(index, 1);
      response[promotedCount] = itemToPromote;
      promotedCount++;
    }
  });

  return {
    promoted: promotedCount === arrayValues.length,
    data: [...response, ...listCopy],
  };
};


const _promoteList = (study, studyMetadata, filters, isFilterStrategy) => {
  /**
  * Promote series to front if find found equivalent on filters object
  * @param {Object} study - study reference to promote series against
  * @param {Object} [filters] - Object containing filters to be applied
  * @param {string} [filter.seriesInstanceUID] - series instance uid to filter results against
  * @param {boolean} isFilterStrategy - if filtering by query param strategy ON
  */
  let promoted = false;
  // Promote only if no filter should be applied
  if (!isFilterStrategy) {
    promoted = _promoteStudyDisplaySet(study, studyMetadata, filters);
  }

  return promoted;
};


const _promoteStudyDisplaySet = (study, studyMetadata, filters) => {
  let promoted = false;
  const queryParamsLength = Object.keys(filters).length;
  const shouldPromoteToFront = queryParamsLength > 0;

  if (shouldPromoteToFront) {
    const { seriesInstanceUID } = filters;

    const _seriesLookup = (valueToCompare, displaySet) => {
      return displaySet.SeriesInstanceUID === valueToCompare;
    };
    const promotedResponse = _promoteToFront(studyMetadata.getDisplaySets(), seriesInstanceUID, _seriesLookup);

    study.displaySets = promotedResponse.data;
    promoted = promotedResponse.promoted;
  }

  return promoted;
};


const _isQueryParamApplied = (study, filters = {}, isFilterStrategy) => {
  /**
  * Method to identify if query param (from url) was applied to given list
  * @param {Object} study - study reference to promote series against
  * @param {Object} [filters] - Object containing filters to be applied
  * @param {string} [filter.seriesInstanceUID] - series instance uid to filter results against
  * @param {boolean} isFilterStrategy - if filtering by query param strategy ON
  */

  const { seriesInstanceUID } = filters;
  let applied = true;
  // skip in case no filter or no toast manager

  if (!seriesInstanceUID) {
    return applied;
  }
  const seriesInstanceUIDs = seriesInstanceUID.split(',');

  let validateFilterApplied = () => {
    const sameSize = arrayToInspect.length === seriesInstanceUIDs.length;
    if (!sameSize) {
      return;
    }

    return arrayToInspect.every((item) =>
      seriesInstanceUIDs.some((seriesInstanceUIDStr) => seriesInstanceUIDStr === item.SeriesInstanceUID)
    );
  };

  let validatePromoteApplied = () => {
    let isValid = true;
    for (let index = 0; index < seriesInstanceUIDs.length; index++) {
      const seriesInstanceUIDStr = seriesInstanceUIDs[index];
      const resultSeries = arrayToInspect[index];

      if (!resultSeries || resultSeries.SeriesInstanceUID !== seriesInstanceUIDStr) {
        isValid = false;
        break;
      }
    }
    return isValid;
  };

  const { series = [], displaySets = [] } = study;
  const arrayToInspect = isFilterStrategy ? series : displaySets;
  const validateMethod = isFilterStrategy ? validateFilterApplied : validatePromoteApplied;

  if (!arrayToInspect) {
    applied = false;
  } else {
    applied = validateMethod();
  }

  return applied;
};
const _showUserMessage = (queryParamApplied, message, dialog = {}) => {
  if (queryParamApplied) {
    return;
  }

  const { show: showUserMessage = () => {} } = dialog;
  showUserMessage({
    message,
  });
};


const _addSeriesToStudy = (studyMetadata, series) => {
  // Add series to the current study  

  // Retrieve SOP class handler module to determine how the data should be represented
  const sopClassHandlerModules = extensionManager.modules['sopClassHandlerModule'];

  // Retrieve study data from the study metadata instance, initialize series metadata instance
  const study = studyMetadata.getData();
  const seriesMetadata = new OHIFSeriesMetadata(series, study);

  // Add series to study (or update if it already exists)
  const existingSeries = studyMetadata.getSeriesByUID(series.SeriesInstanceUID);
  if (existingSeries) {
    studyMetadata.updateSeries(series.SeriesInstanceUID, seriesMetadata);
  } else {
    studyMetadata.addSeries(seriesMetadata);
  }

  studyMetadata.createAndAddDisplaySetsForSeries(sopClassHandlerModules, seriesMetadata);

  study.displaySets = studyMetadata.getDisplaySets();
  study.derivedDisplaySets = studyMetadata.getDerivedDatasets({
    Modality: series.Modality,
  });

  _updateStudyMetadataManager(study, studyMetadata);

  return seriesMetadata;
};


const _updateStudyMetadataManager = (study, studyMetadata) => {
  const { StudyInstanceUID } = study;

  if (!studyMetadataManager.get(StudyInstanceUID)) {
    studyMetadataManager.add(studyMetadata);
  }
};


const _updateStudyDisplaySets = (study, studyMetadata) => {
  // Update the display sets for the provided study
  
  // @input study
  // @input studyMetadata
  console.log('[viewer:fetch-data] update study displaysets', study);

  const sopClassHandlerModules = extensionManager.modules['sopClassHandlerModule'];

  if (!study.displaySets) {
    study.displaySets = studyMetadata.createDisplaySets(sopClassHandlerModules);
  }

  if (study.derivedDisplaySets) {
    studyMetadata._addDerivedDisplaySets(study.derivedDisplaySets);
  }
  
  displaySetService.addDisplaySets(_.flatten(studyMetadata.getDisplaySets()));
};


const _thinStudyData = (study) => {
  return {
    StudyInstanceUID: study.StudyInstanceUID,
    series: study.series.map((item) => ({
      SeriesInstanceUID: item.SeriesInstanceUID,
    })),
  };
};




function ViewerRetrieveStudyData({
  // Lifecycle component used within OHIF for retrieving and loading metadata within
  // the study browser interface.
  server,
  studyInstanceUIDs,
  seriesInstanceUIDs,
  clearViewportSpecificData,
  setStudyData,
  display
}) {
  
  // Lifecylce state properties
  const [error, setError] = useState(false);
  const [studies, setStudies] = useState([]);
  const [isStudyLoaded, setIsStudyLoaded] = useState(false);

  // Property references for service callbacks
  const serverRef = useRef(server);
  const studiesRef = useRef(studies);

  // Context and configuration
  const snackbarContext = useSnackbarContext();
  const { appConfig = {} } = useContext(AppContext);
  const { filterQueryParam: isFilterStrategy = false, maxConcurrentMetadataRequests } = appConfig;

  
  let cancelableSeriesPromises;
  let cancelableStudiesPromises;
  
  
  const studyDidLoad = (study, studyMetadata, filters) => {
    /**
    * Callback method when study is totally loaded
    * @param {object} study study loaded
    * @param {object} studyMetadata studyMetadata for given study
    * @param {Object} [filters] - Object containing filters to be applied
    * @param {string} [filter.seriesInstanceUID] - series instance uid to filter results against
    */
    
    // User message
    const promoted = _promoteList(study, studyMetadata, filters, isFilterStrategy);

    // Clear viewport to allow new promoted one to be displayed
    if (promoted) {
      clearViewportSpecificData(0);
    }

    const isQueryParamApplied = _isQueryParamApplied(study, filters, isFilterStrategy);
    // Show message in case not promoted neither filtered but should to
    _showUserMessage(
      isQueryParamApplied,
      'Query parameters were not totally applied. It might be using original series list for given study.',
      snackbarContext
    );

    setStudies([...studies, study]);
  };

  
  const processStudies = (studiesData, filters) => {
    /**
    * Method to process studies. It will update displaySet, studyMetadata, load remaining series, ...
    * 
    * @param {Array} studiesData Array of studies retrieved from server
    * @param {Object} [filters] - Object containing filters to be applied
    * @param {string} [filters.seriesInstanceUID] - series instance uid to filter results against
    */

    console.log('[viewer:fetch-data] studies data', studiesData);

    if (Array.isArray(studiesData) && studiesData.length > 0) {
      
      // Map studies to new format, update metadata manager?
      const studies = studiesData.map((study) => {

        // Remove cached properties to ensure that all metadata and viewer computed properties display correctly
        study = _.omit(study, 'displaySets');

        setStudyData(study.StudyInstanceUID, _thinStudyData(study));
        const studyMetadata = new OHIFStudyMetadata(study, study.StudyInstanceUID);

        _updateStudyDisplaySets(study, studyMetadata);
        _updateStudyMetadataManager(study, studyMetadata);

        // Attempt to load remaning series if any
        cancelableSeriesPromises[study.StudyInstanceUID] = makeCancelable(loadRemainingSeries(studyMetadata))
          .then((result) => {
            if (result && !result.isCanceled) {
              studyDidLoad(study, studyMetadata, filters);
              displaySetService.triggerApiEvent(OHIF.display.Enums.EVENTS.STUDY_DATA_FETCH, {
                study, studyMetadata,
              });
            }
          }).catch((error) => {
            if (error && !error.isCanceled) {
              setError(error);
              log.error(error);
            }
          }).finally(() => {
            setIsStudyLoaded(true);
          });

        return study;
      });

      setStudies(studies);
    }
  };


  const forceRerender = () =>  {
    // Reset internal state of the viewer and force a re-render of the study data

    setStudies((studies) => [...studies]);
  };

  
  const loadRemainingSeries = async (studyMetadata) => {
    // Load series metadata

    const _studyData = studyMetadata.getData();
    const { seriesLoader } = _studyData;
    console.log('[viewer:fetch-data] study data', _studyData);

    if (!seriesLoader) return;

    const loadNextSeries = async () => {
      // Iterator function which steps through the series of the study, 
      // creates displaySets for them, and updates the UI

      if (!seriesLoader.hasNext()) return;

      // Retrieve next series in the sequence
      const series = await seriesLoader.next();
      _addSeriesToStudy(studyMetadata, series);
      forceRerender();
      
      return loadNextSeries();
    };

    const concurrentRequestsAllowed = maxConcurrentMetadataRequests || studyMetadata.getSeriesCount();
    const promises = Array(concurrentRequestsAllowed).fill(null).map(loadNextSeries);
    const remainingPromises = await Promise.all(promises);
    setIsStudyLoaded(true);
    
    return remainingPromises;
  };

  
  const loadStudies = async (options) => {
    // Load study data: gateway method for loading study data for the viewer

    // @input options
    // - force_fetch (bool, default=false): force a reload of study/series metadata from the server.
    //   when true, all state data will be reloaded and re-rendered.

    options = options || {};
    displaySetService.triggerApiEvent(OHIF.display.Enums.EVENTS.STUDY_FETCH_START);

    try {
      const filters = {};
      
      // Use the first, discard others
      const seriesInstanceUID = seriesInstanceUIDs && seriesInstanceUIDs[0];
      const retrieveParams = [server, studyInstanceUIDs];

      if (seriesInstanceUID) {
        filters.seriesInstanceUID = seriesInstanceUID;
        
        // Query param filtering controlled by appConfig property
        if (isFilterStrategy) {
          retrieveParams.push(filters);
        } else { retrieveParams.push({}); }
      }

      if (appConfig.splitQueryParameterCalls || appConfig.enableGoogleCloudAdapter) {
        
        // Seperate SeriesInstanceUID filter calls.
        retrieveParams.push(true); 
      } else { retrieveParams.push({}); }

      cancelableStudiesPromises[studyInstanceUIDs] = makeCancelable(
          retrieveStudiesMetadata(...retrieveParams, options))
        .then((result) => {
          if (result && !result.isCanceled) {
            processStudies(result, filters);
            displaySetService.triggerApiEvent(OHIF.display.Enums.EVENTS.STUDY_DATA_FETCH_RAW, { result, });
          }
        })
        .catch((error) => {
          if (error && !error.isCanceled) {
            setError(error);
            displaySetService.triggerApiEvent(OHIF.display.Enums.EVENTS.STUDY_DATA_FETCH_ERR, { err: error });
            log.error(error);
          }
        });
    } catch (error) {
      if (error) {
        setError(error);
        log.error(error);
      }
    }
  };

  
  const reloadStudyData = () => {
    // Reset viewer state and reload all data from the server

    // Remove all study instances from the metadata manager
    _.each(studyMetadataManager.all(), (s) => {
      studyMetadataManager.remove(s.studyInstanceUID || s._studyInstanceUID);
    });

    // Cancel all loading data, reset state of viewer, and clear the study list
    setStudies([]);
    setIsStudyLoaded(false);
    purgeCancellablePromises();
    forceRerender();

    // Re-load studies
    setTimeout(() => {      
      loadStudies({ force_fetch:  true });
    }, 50);
  }


  const addLocalDcmSeries = async ({ dcm }) => {
    // Add a locally cached DICOM series (which may not have a remote representation) to the viewer.

    // Add locally created DICOM file locate currently loaded study instance
    const _dcmMeta = await io.fileLoader.Local.fileToStudy(dcm);        
    const _s0 = studiesRef.current.find((_s) => _s.StudyInstanceUID == _dcmMeta.StudyInstanceUID);
    const _s0Meta = studyMetadataManager.get(_s0.StudyInstanceUID);

    // Initialize metadata instance from Dicom MetadataStore
    const _sx = DicomMetadataStore.getSeries(_dcmMeta.StudyInstanceUID, _dcmMeta.SeriesInstanceUID);
    const _sxMeta = _addSeriesToStudy(_s0Meta, _sx);

    // Update displaySetService with new displaySet instances
    displaySetService.addDisplaySets(_.flatten(_s0Meta.getDisplaySets()));

    // Prepare SR displaySet to be parsed by MeasurementApi
    _.each(displaySetService.getDisplaySetsForSeries(_sx.SeriesInstanceUID), (displaySet) => {

      // Cache a copy of the SR DCM instance so that it can be reloaded
      displaySet.cachePart10SRArrayBuffer = dcm;              

      // Add updated displaySet with cached file to service, trigger update of viewer
      displaySetService.addDisplaySets([displaySet]);
      setStudies([
        ...studiesRef.current.filter((_s) => _s.StudyInstanceUID != _dcmMeta.StudyInstanceUID),
        _s0Meta.getData(),
      ]);
    });

    return _sxMeta;
  }

  
  const purgeCancellablePromises = useCallback(() => {
    // Cancel all pending fetch study operations.

    for (let studyInstanceUIDs in cancelableStudiesPromises) {
      if ('cancel' in cancelableStudiesPromises[studyInstanceUIDs]) {
        cancelableStudiesPromises[studyInstanceUIDs].cancel();
      }
    }

    for (let studyInstanceUIDs in cancelableSeriesPromises) {
      if ('cancel' in cancelableSeriesPromises[studyInstanceUIDs]) {
        cancelableSeriesPromises[studyInstanceUIDs].cancel();
        deleteStudyMetadataPromise(studyInstanceUIDs);
        studyMetadataManager.remove(studyInstanceUIDs);
      }
    }
  });

  
  const prevStudyInstanceUIDs = usePrevious(studyInstanceUIDs);

  
  useEffect(() => {
    const hasStudyInstanceUIDsChanged = !(
      prevStudyInstanceUIDs && prevStudyInstanceUIDs.every((e) => studyInstanceUIDs.includes(e))
    );

    if (hasStudyInstanceUIDsChanged) {
      studyMetadataManager.purge();
      purgeCancellablePromises();
    }
  }, [prevStudyInstanceUIDs, purgeCancellablePromises, studyInstanceUIDs]);

  
  useEffect(() => {
    // Load study data

    cancelableSeriesPromises = {};
    cancelableStudiesPromises = {};
    loadStudies();

    return () => {
      purgeCancellablePromises();
    };
  }, []);


  useEffect(() => {
    // Update lifecycle property attributes

    serverRef.current = server;
    studiesRef.current = studies;

  }, [server, studies]);


  useEffect(() => {
    // Handle lifecycle methods required by display set and measurement services.
    // Add event handlers for study study data loading.

    console.log('[viewer:fetch-data] component mounted');
    const measurementApi = measurements.MeasurementApi.Instance;
    const { measurementService } = measurementApi;

    const displayset_added = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_ADDED, ({ displaySetInstanceUID, displaySet }) => {
        
        // Check displayset to ensure that the server property is attached and update the display service
        if (displaySetInstanceUID && displaySet && !displaySet.server) {

          // Add server to displaySet and set the ACL permissions
          displaySet.server = serverRef.current;
          setTimeout(() => displaySetService.addDisplaySets([displaySet]), 25);
        }
      });

    const triggerLoad = async ({ displaySetInstanceUID, displaySet }) => {
      // Trigger the displaySet load method (if one is defined)
        
      // Trigger load method for the displaySet
      if (displaySet && displaySet.load && _.isFunction(displaySet.load)) {
        await displaySet.load();
      }
    }

    const displayset_triggerload_added = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_ADDED, triggerLoad)
    const displayset_triggerload_updated = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_CHANGED, triggerLoad);

    const displayset_datasync = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_DATASYNC, async ({ apiEvent, ...apiData }) => {
        
        // Manage API lifecycle events triggered by the displaySetService. The displaySetService
        // is used to coordinate data loading, metadata creation prior to visualization/rendering,
        // and the management of local DICOM data.
        console.log('[viewer:fetch-data:displayset-event] apiEvent='+apiEvent, apiData);

        if (apiEvent && apiEvent == OHIF.display.Enums.EVENTS.STUDY_RELOAD) {
          
          // Clear measurements/annotations and force-reload study data
          commandsManager.runCommand('clearAnnotations')
            && measurementApi.clearMeasurements()
            && measurementApi.measurementService.clearMeasurements();
          reloadStudyData();
          
        } else if (apiEvent && apiEvent == OHIF.display.Enums.EVENTS.VIEWER_RENDER) {

          // Force render of study viewer
          forceRerender();
          
        } else if (apiEvent && apiEvent == OHIF.display.Enums.EVENTS.DCM_LOCAL_CREATE) {

          // Reload measurements after local DICOM-SR file created
          if (apiData.dcm) {

            // Clear annotations
            commandsManager.runCommand('clearAnnotations')
              && measurementApi.clearMeasurements() 
              && measurementApi.measurementService.clearMeasurements();
            
            setTimeout(async () => {

              // Add local DICOM series
              await addLocalDcmSeries(apiData);

              // Reload annotations and re-rerender viewports
              measurementApi.retrieveMeasurements({
                success: () => {

                  // Synchronize state and update viewports
                  measurementApi.syncMeasurementsAndToolData();
                  cornerstoneUtils.refreshCornerstoneViewports();
                  commandsManager.runCommand('reloadAnnotations');
                },
              });
            }, 50);
          }
        }
      });

    return () => {

      // Unsubscribe from event handlers
      displayset_added.unsubscribe();
      displayset_triggerload_added.unsubscribe();
      displayset_triggerload_updated.unsubscribe();
      displayset_datasync.unsubscribe();

      // Clear displaySets and measurements on exit
      displaySetService.onModeExit();
      measurementService.onModeExit();
      customizationService.onModeExit();

      console.log('[viewer:fetch-data] component unmounted');
    }
  }, [])

  
  if (error) {
    const content = JSON.stringify(error);
    if (content.includes('404') || content.includes('NOT_FOUND')) {
      return <NotFound />;
    }

    return <NotFound message="Failed to retrieve study data" />;
  }

  return <Viewer studies={studies} isStudyLoaded={isStudyLoaded} studyInstanceUIDs={studyInstanceUIDs} />;
}


ViewerRetrieveStudyData.propTypes = {
  studyInstanceUIDs: PropTypes.array.isRequired,
  seriesInstanceUIDs: PropTypes.array,
  server: PropTypes.object,
  clearViewportSpecificData: PropTypes.func.isRequired,
  setStudyData: PropTypes.func.isRequired,
};


export default ViewerRetrieveStudyData;
