import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import OHIF, { DICOMSR, MODULE_TYPES } from '@ohif/core';
import { useDialog, useSnackbarContext } from '@ohif/ui';

import { getDistortionCheck } from '../api/deviceList';
import { extensionManager, servicesManager, commandsManager } from '../App';
import Header from '../components/Header/Header';
import StudyLoadingMonitor from '../components/StudyLoadingMonitor';
import StudyPrefetcher from '../components/StudyPrefetcher/StudyPrefetcher';
import { WORK_LIST_VIEWER_PARAM } from '../constants/worklist';
import AppContext from '../context/AppContext';
import UserManagerContext from '../context/UserManagerContext';
// Contexts
import WhiteLabelingContext from '../context/WhiteLabelingContext';
import { useViewerSidePanels } from '../store/useViewerSidePanels';
import {
  disassociateStudy,
  mapStudiesToThumbnails,
  removeTimepoint,
  storeTimepoints,
  updateTimepoint,
} from '../utils/viewer';

import ErrorBoundaryDialog from './../components/ErrorBoundaryDialog';
import SidePanel from './../components/SidePanel/SidePanel';
import ViewerIssuesContent from './ViewerIssuesContent/ViewerIssuesContent';
import ConnectedStudyBrowser from './ConnectedStudyBrowser';
import ToolbarRow from './ToolbarRow';
import ViewerMain from './ViewerMain';

import './Viewer.css';

const { DicomMetadataStore } = OHIF;
const { TimepointApi, MeasurementApi } = OHIF.measurements;
const { DisplaySetApi } = OHIF.display;
const { setTimepoints, setMeasurements } = OHIF.redux.actions;
const currentTimepointId = 'TimepointId';


export default function Viewer({ studies, studyInstanceUIDs, isStudyLoaded, selectedStudyId }) {
  // Sonador Viewer: provides side panels, viewport layouts, and toolbar

  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();

  const viewports = useSelector((state) => state.viewports.viewportSpecificData);
  const activeViewportIndex = useSelector((state) => state.viewports.activeViewportIndex);
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [thumbnails, setThumbnails] = useState([]);
  const {
    isIssuesContentRightSidePanel,
    isLeftSidePanelOpen,
    isRightSidePanelOpen,
    selectedLeftSidePanel,
    selectedRightSidePanel,
  } = useViewerSidePanels();

  
  const timepointApi = useMemo(() => new TimepointApi(currentTimepointId, {
    onTimepointsUpdated: (timepoints) => { dispatch(setTimepoints(timepoints)); },
  }),[]);

  const measurementApi = useMemo(() => {
    const { MeasurementService } = servicesManager.services;

    return new MeasurementApi(MeasurementService, timepointApi, {
      onMeasurementsUpdated: (measurements) => { dispatch(setMeasurements(measurements)); },
    });
  }, []);

  const displaySetApi = useMemo(() => {
    const { displaySetService } = servicesManager.services;

    return new DisplaySetApi(displaySetService, DicomMetadataStore);
  }, []);
 
  const dialog = useDialog();
  const snackbar = useSnackbarContext();

  const { data: distortionCheckResponse } = useQuery({
    queryKey: ['distortionCheck'],
    queryFn: () => getDistortionCheck(activeServer, studyInstanceUIDs),
    enabled: !!activeServer && !!studyInstanceUIDs,
  });

  const isWorkList = searchParams.get(WORK_LIST_VIEWER_PARAM) === 'true';

  const updateThumbnails = () => {
    const activeViewport = viewports[activeViewportIndex];
    const activeDisplaySetInstanceUID = activeViewport ? activeViewport.displaySetInstanceUID : undefined;

    setThumbnails(mapStudiesToThumbnails(studies, activeDisplaySetInstanceUID));
  };

  const retrieveTimepoints = (filter) => {
    // Get the earliest and latest study date
    let earliestDate = new Date().toISOString();
    let latestDate = new Date().toISOString();
    if (studies) {

      latestDate = new Date('1000-01-01').toISOString();
      studies.forEach((study) => {
        const StudyDate = moment(study.StudyDate, 'YYYYMMDD').toISOString();
        if (StudyDate < earliestDate) {
          earliestDate = StudyDate;
        }
        if (StudyDate > latestDate) {
          latestDate = StudyDate;
        }
      });
    }

    // Return a generic timepoint
    return Promise.resolve([
      {
        timepointType: 'baseline',
        timepointId: 'TimepointId',
        studyInstanceUIDs,
        PatientID: filter.PatientID,
        earliestDate,
        latestDate,
        isLocked: false,
      },
    ]);
  };

  
  useEffect(() => {
    // Viewer setup and teardown events

    if (studies) {
      const PatientID = studies[0] && studies[0].PatientID;

      timepointApi.retrieveTimepoints({ PatientID });
      if (isStudyLoaded) {
        console.warn('[viewer] study loaded, retrieve measurements from patient cache. '
          +'PatientID='+PatientID+' currentTimepointId='+currentTimepointId);
        measurementApi.retrieveMeasurements(PatientID, [currentTimepointId]);
      }

      const activeViewport = viewports[activeViewportIndex];
      const activeDisplaySetInstanceUID = activeViewport ? activeViewport.displaySetInstanceUID : undefined;

      setThumbnails(mapStudiesToThumbnails(studies, activeDisplaySetInstanceUID));
    }

    const updateThumbnailsCb = () => {
      const activeViewport = viewports[activeViewportIndex];
      const activeDisplaySetInstanceUID = activeViewport ? activeViewport.displaySetInstanceUID : undefined;

      setThumbnails(mapStudiesToThumbnails(studies, activeDisplaySetInstanceUID));
    };

    // Add DOM/document event listeners
    document.addEventListener('segmentationLoadingError', updateThumbnailsCb, false);

    return () => {

      // Dismiss any open dialogs
      if (dialog) {
        dialog.dismissAll();
      }

      // Remove segmentation load errors
      document.removeEventListener('segmentationLoadingError', updateThumbnailsCb);

      // Release MeasurementApi and DisplaySetApi event bindings
      measurementApi.destroy?.();
      displaySetApi.destroy?.();
    };
  }, []);

  useLayoutEffect(() => {
    // Set configuration and data transfer methods for measurements and timepoint APIs

    OHIF.measurements.MeasurementApi.setConfiguration({
      dataExchange: {
        retrieve: (server) => DICOMSR.retrieveMeasurements(server, { servicesManager }),
        store: DICOMSR.storeMeasurements,
      },
      server: activeServer,
    });

    OHIF.measurements.TimepointApi.setConfiguration({
      dataExchange: {
        retrieve: retrieveTimepoints,
        store: storeTimepoints,
        remove: removeTimepoint,
        update: updateTimepoint,
        disassociate: disassociateStudy,
      },
    });
  }, []);
  
  
  useEffect(() => {
    // Trigger display port events and update thumbnails

    // Retrieve reference to displaySet service
    const { displaySetService } = servicesManager.services;

    // Retrieve active viewport and displaySetInstanceUID
    const activeViewport = viewports[activeViewportIndex];
    const activeDisplaySetInstanceUID = activeViewport ? activeViewport.displaySetInstanceUID : undefined;

    setThumbnails(mapStudiesToThumbnails(studies, activeDisplaySetInstanceUID));

    if (displaySetService && activeDisplaySetInstanceUID) {

      // Trigger display set update via service
      displaySetService._broadcastEvent(displaySetService.EVENTS.DISPLAY_SET_ACTIVATED, {
        displaySetInstanceUID: activeDisplaySetInstanceUID, activeViewportIndex,
      });
    }
  }, [viewports, activeViewportIndex, studies]);

  
  useEffect(() => {
    if (isStudyLoaded) {
      const PatientID = studies[0] && studies[0].PatientID;

      console.warn('[viewer] load single study, retrieve measurements from patient cache. '
          +'PatientID='+PatientID+' currentTimepointId='+currentTimepointId);
      timepointApi.retrieveTimepoints({ PatientID });
      measurementApi.retrieveMeasurements(PatientID, [currentTimepointId]).then(updateThumbnails);
    }
  }, [isStudyLoaded]);

  
  useEffect(() => {
    if (distortionCheckResponse) {
      const devicesWithErrors = [];

      Object.values(distortionCheckResponse).forEach(({ results }) => {
        results?.forEach((device) => {
          if (device.error) {
            devicesWithErrors.push(device);
          }
        });
      });

      if (devicesWithErrors.length) {
        devicesWithErrors.forEach((device) => {
          snackbar.show({
            title: '',
            message: `Error for device id ${device.device_id} device name ${device['Device Model']} error - ${device.error}`,
            type: 'error',
            autoClose: false,
          });
        });
      }
    }
  }, [distortionCheckResponse]);

  
  const getActiveViewport = () => {
    return viewports[activeViewportIndex];
  };

  
  let VisiblePanelLeft, VisiblePanelRight;
  const panelExtensions = extensionManager.modules[MODULE_TYPES.PANEL];

  
  panelExtensions.forEach((panelExt) => {
    panelExt.module.components.forEach((comp) => {
      if (comp.id === selectedRightSidePanel) {
        VisiblePanelRight = comp.component;
      } else if (comp.id === selectedLeftSidePanel) {
        VisiblePanelLeft = comp.component;
      }
    });
  });

  
  return (
    <>
      {/* HEADER */}
      {!isWorkList && (
        <WhiteLabelingContext.Consumer>
          {(whiteLabeling) => (
            <UserManagerContext.Consumer>
              {(userManager) => (
                <AppContext.Consumer>
                  {(appContext) => (
                    <Header
                      linkText={appContext.appConfig.showStudyList ? 'Study List' : undefined}
                      linkPath={appContext.appConfig.showStudyList ? '/' : undefined}
                      userManager={userManager}
                    >
                      {whiteLabeling &&
                        whiteLabeling.createLogoComponentFn &&
                        whiteLabeling.createLogoComponentFn(React)}
                    </Header>
                  )}
                </AppContext.Consumer>
              )}
            </UserManagerContext.Consumer>
          )}
        </WhiteLabelingContext.Consumer>
      )}
      {/* TOOLBAR */}
      <ErrorBoundaryDialog context="ToolbarRow">
        <ToolbarRow activeViewport={viewports[activeViewportIndex]} studies={studies} />
      </ErrorBoundaryDialog>
      <AppContext.Consumer>{() => <StudyLoadingMonitor studies={studies} />}</AppContext.Consumer>
      {/* VIEWPORTS + SIDEPANELS */}
      <div
        className={classNames('FlexboxLayout', {
          worklist: isWorkList,
        })}
      >
        {/* LEFT */}
        <ErrorBoundaryDialog context="LeftSidePanel">
          <SidePanel from="left" isOpen={isLeftSidePanelOpen}>
            {VisiblePanelLeft ? (
              <VisiblePanelLeft viewports={viewports} studies={studies} activeIndex={activeViewportIndex} />
            ) : (
              <AppContext.Consumer>
                {(appContext) => {
                  const { appConfig } = appContext;
                  const { studyPrefetcher } = appConfig;

                  return (
                    <ConnectedStudyBrowser
                      studies={thumbnails}
                      studyMetadata={studies}
                      showThumbnailProgressBar={
                        studyPrefetcher && studyPrefetcher.enabled && studyPrefetcher.displayProgress
                      }
                    />
                  );
                }}
              </AppContext.Consumer>
            )}
          </SidePanel>
        </ErrorBoundaryDialog>

        {/* MAIN */}
        <div className="main-content">
          <ErrorBoundaryDialog context="ViewerMain">
            <StudyPrefetcher studies={studies} />
            <ViewerMain studies={studies} isStudyLoaded={isStudyLoaded} 
              selectedStudyId={selectedStudyId} commandsManager={commandsManager} />
          </ErrorBoundaryDialog>
        </div>

        {/* RIGHT */}
        <ErrorBoundaryDialog context="RightSidePanel">
          <SidePanel from="right" isOpen={isRightSidePanelOpen}>
            {VisiblePanelRight && !isIssuesContentRightSidePanel && (
              <VisiblePanelRight
                isOpen={isRightSidePanelOpen}
                viewports={viewports}
                studies={studies}
                activeIndex={activeViewportIndex}
                activeViewport={viewports[activeViewportIndex]}
                getActiveViewport={getActiveViewport}
              />
            )}
            {isIssuesContentRightSidePanel && <ViewerIssuesContent />}
          </SidePanel>
        </ErrorBoundaryDialog>
      </div>
    </>
  );
}

Viewer.propTypes = {
  studies: PropTypes.arrayOf(
    PropTypes.shape({
      StudyInstanceUID: PropTypes.string.isRequired,
      StudyDate: PropTypes.string,
      PatientID: PropTypes.string,
      displaySets: PropTypes.arrayOf(
        PropTypes.shape({
          displaySetInstanceUID: PropTypes.string.isRequired,
          SeriesDescription: PropTypes.string,
          SeriesNumber: PropTypes.number,
          InstanceNumber: PropTypes.number,
          numImageFrames: PropTypes.number,
          Modality: PropTypes.string.isRequired,
          images: PropTypes.arrayOf(
            PropTypes.shape({
              getImageId: PropTypes.func.isRequired,
            })
          ),
        })
      ),
    })
  ),
  studyInstanceUIDs: PropTypes.array,
  isStudyLoaded: PropTypes.bool,
  selectedStudyId: PropTypes.string,
};
