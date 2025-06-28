import _ from 'lodash';

import React, { useEffect, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams } from 'react-router-dom';
import values from 'lodash/values';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { eventTypes as uiEvents } from '@ohif/ui';

import { servicesManager } from '../App';

import ViewportGrid from './../components/ViewportGrid/ViewportGrid';

import './ViewerMain.css';

const { setViewportSpecificData, clearEntireViewportSpecificData, setLayout } = OHIF.redux.actions;
const { DisplaySetApi } = OHIF.display;


export default function ViewerMain({ studies, isStudyLoaded, selectedStudyId, commandsManager }) {
  // Provides the interface between the viewer grid, displaySet state, and metadata

  const dispatch = useDispatch();
  const { studyInstanceUIDs } = useParams();

  // Viewport layout
  const { layout, viewportSpecificData } = useSelector((state) => state.viewports);
  const layoutRef = useRef(layout);
  const viewportSpecificDataRef = useRef(viewportSpecificData);
  
  // Viewport loading and display state
  const [displaySets, setDisplaySets] = useState([]);
  const studiesRef = useRef(studies);
  const isStudyLoadedRef = useRef(isStudyLoaded);

  const { addError } = useViewerStudyErrors();

  const viewportData = values(viewportSpecificData);
  const studyId = selectedStudyId || studyInstanceUIDs;

  
  const getDisplaySets = (studies) => {
    // Retrieve displaySets registered with the viewer

    const newDisplaySets = [];
    studies.forEach((study) => {
      study.displaySets.forEach((dSet) => {
        if (!dSet.plugin) {
          dSet.plugin = 'cornerstone';
        }
        newDisplaySets.push(dSet);
      });
    });

    return newDisplaySets;
  };

  
  const findDisplaySet = (studies, StudyInstanceUID, displaySetInstanceUID) => {
    // Retrieve the display from the studies array which matches the provided StudyInstanceUID and displaySetInstanceUID
    
    const study = studies.find((study) => {
      return study.StudyInstanceUID === StudyInstanceUID;
    });

    if (!study) {
      console.warn('[viewer:main:findDisplaySet] no studies matching StudyInstanceUID='+StudyInstanceUID, 'studies', studies);
      return;
    }

    return study.displaySets.find((displaySet) => {
      return displaySet.displaySetInstanceUID === displaySetInstanceUID;
    });
  };

  
  const setViewportData = ({ viewportIndex, StudyInstanceUID, displaySetInstanceUID }) => {
    let displaySet = findDisplaySet(studiesRef.current, StudyInstanceUID, displaySetInstanceUID);

    const { LoggerService, UINotificationService } = servicesManager.services;

    if (displaySet?.isDerived) {
      const { Modality } = displaySet;
      if (Modality === 'SEG' && servicesManager) {
        const onDisplaySetLoadFailureHandler = (error) => {
          const message =
            error.message.includes('orthogonal') || error.message.includes('oblique')
              ? 'The segmentation has been detected as non coplanar,\
              If you really think it is coplanar,\
              please adjust the tolerance in the segmentation panel settings (at your own peril!)'
              : error.message;
          LoggerService.error({ error, message });

          const errorTitle = 'DICOM Segmentation Loader';

          if (studyId) {
            addError({ studyId, error: message, title: errorTitle });
          }

          UINotificationService.show({
            title: errorTitle,
            message,
            type: 'error',
            autoClose: false,
          });
        };

        const { referencedDisplaySet, activatedLabelmapPromise } = displaySet.getSourceDisplaySet(
          studies,
          true,
          onDisplaySetLoadFailureHandler
        );
        displaySet = referencedDisplaySet;

        activatedLabelmapPromise.then((activatedLabelmapIndex) => {
          const selectionFired = new CustomEvent('extensiondicomsegmentationsegselected', {
            detail: { activatedLabelmapIndex: activatedLabelmapIndex },
          });
          document.dispatchEvent(selectionFired);
        });
      } else if (Modality !== 'SR') {
        displaySet = displaySet.getSourceDisplaySet(studies);
      }

      if (!displaySet) {
        const error = new Error('Source data not present');
        const message = 'Source data not present';
        const errorTitle = 'Fail to load series';

        LoggerService.error({ error, message });

        if (studyId) {
          addError({ studyId, error: message, title: errorTitle });
        }

        UINotificationService.show({
          autoClose: false,
          title: errorTitle,
          message,
          type: 'error',
        });
      }
    }

    if (displaySet?.isSOPClassUIDSupported === false) {
      const error = new Error('Modality not supported');
      const message = 'Modality not supported';
      const errorTitle = 'Fail to load series';

      LoggerService.error({ error, message });

      if (studyId) {
        addError({ studyId, error: message, title: errorTitle });
      }

      UINotificationService.show({
        autoClose: false,
        title: errorTitle,
        message,
        type: 'error',
      });
    }

    if (displaySet) {
      dispatch(setViewportSpecificData(viewportIndex, displaySet));

      // Trigger viewport event
      const e = new CustomEvent(uiEvents.viewport.update, {
        viewportIndex,
        StudyInstanceUID,
        displaySet,
      });
      
      document.dispatchEvent(e);
    } else {
      console.warn('[viewer:main] unable to update data for viewportIndex='+viewportIndex
        +' StudyInstanceUID='+StudyInstanceUID+' displaySetInstanceUID='+displaySetInstanceUID);
    }
  };

  const fillEmptyViewportPanes = () => {
    const dirtyViewportPanes = [];

    if (!displaySets || !displaySets.length) {
      return;
    }

    for (let i = 0; i < layout.viewports.length; i++) {
      const viewportPane = viewportSpecificData[i];
      const isNonEmptyViewport = viewportPane && viewportPane.StudyInstanceUID && viewportPane.displaySetInstanceUID;

      if (isNonEmptyViewport) {
        dirtyViewportPanes.push({
          StudyInstanceUID: viewportPane.StudyInstanceUID,
          displaySetInstanceUID: viewportPane.displaySetInstanceUID,
        });

        continue;
      }

      const foundDisplaySet =
        displaySets.find(
          (ds) => !dirtyViewportPanes.some((v) => v.displaySetInstanceUID === ds.displaySetInstanceUID)
        ) || displaySets[displaySets.length - 1];

      dirtyViewportPanes.push(foundDisplaySet);
    }

    dirtyViewportPanes.forEach((vp, i) => {
      if (vp && vp.StudyInstanceUID) {
        setViewportData({
          viewportIndex: i,
          StudyInstanceUID: vp.StudyInstanceUID,
          displaySetInstanceUID: vp.displaySetInstanceUID,
        });
      }
    });
  };


  useEffect(() => {
    // Update layout, viewport specific data, and isStudyLoaded references for use in service callbacks
    
    layoutRef.current = layout;
    viewportSpecificDataRef.current = viewportSpecificData;
    isStudyLoadedRef.current = isStudyLoaded;
    studiesRef.current = studies;

  }, [layout, viewportSpecificData, isStudyLoaded, studies])


  useEffect(() => {
    // Respond to displaySet API events

    const displaysets_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC, ({ apiEvent, ...apiData }) => {
        
        // When a study is reloaded, reset the layout of the viewer to a single viewport
        // and clear the active viewport to prevent the display of errors while the study is reloading.
        if (apiEvent == OHIF.display.Enums.EVENTS.STUDY_RELOAD) {

          // Update state to reflect that a full study reload is pending
          dispatch(setLayout({ numRows: 1, numColumns: 1, viewports: [] }));
        }

        // After a study reload, set the active displaySet so that the viewport refreshes
        if (apiEvent == OHIF.display.Enums.EVENTS.STUDY_DATA_FETCH 
            && _.isArray(layoutRef.current.viewports) && !layoutRef.current.viewports.length
            && apiData.study && _.isArray(apiData.study.displaySets) && apiData.study.displaySets.length) {

          const _ds = apiData.study.displaySets[0];
          setTimeout(() => {            
            setViewportData({
              viewportIndex: 0,
              StudyInstanceUID: apiData.study.StudyInstanceUID,
              displaySetInstanceUID: _ds.displaySetInstanceUID
            });            
          }, 50);
        }
      });

    return () => {      

      // Clear service susbscriptions
      displaysets_apisync.unsubscribe();
    }
  }, []);

  
  useEffect(() => {
    if (studies) {
      setDisplaySets(getDisplaySets(studiesRef.current));
    }
  }, [studies]);

  
  useEffect(() => {
    const isVtk = layout.viewports.some((vp) => !!vp.vtk);

    if (!isVtk && studies) {
      setDisplaySets(getDisplaySets(studies));
    }
  }, [layout.viewports.length]);

  
  useEffect(() => {
    fillEmptyViewportPanes();
  }, [displaySets]);

  
  useEffect(() => {
    return () => {
      dispatch(clearEntireViewportSpecificData());
    };
  }, []);

  
  return (
    <div className="ViewerMain">
      {displaySets.length && (
        <ViewportGrid
          isStudyLoaded={isStudyLoaded}
          studies={studies}
          viewportData={viewportData}
          setViewportData={setViewportData}
        />
      )}
    </div>
  );
}

ViewerMain.propTypes = {
  studies: PropTypes.array,
  isStudyLoaded: PropTypes.bool,
  selectedStudyId: PropTypes.string,
  commandsManager: PropTypes.object,
};
