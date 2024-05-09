import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';

import OHIF, { DICOMSR, MODULE_TYPES } from '@ohif/core';
import { useDialog } from '@ohif/ui';

import { extensionManager, servicesManager } from '../App';
import StudyLoadingMonitor from '../components/StudyLoadingMonitor';
import StudyPrefetcher from '../components/StudyPrefetcher/StudyPrefetcher';
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
import ConnectedHeader from './ConnectedHeader';
import ConnectedStudyBrowser from './ConnectedStudyBrowser';
import ToolbarRow from './ToolbarRow';
import ViewerMain from './ViewerMain';

import './Viewer.css';

const { TimepointApi, MeasurementApi } = OHIF.measurements;
const currentTimepointId = 'TimepointId';

export default function Viewer({
  activeServer,
  studies,
  studyInstanceUIDs,
  onTimepointsUpdated = () => {},
  onMeasurementsUpdated = () => {},
  isStudyLoaded,
  viewports,
  activeViewportIndex,
}) {
  const [thumbnails, setThumbnails] = useState([]);
  const {
    isIssuesContentRightSidePanel,
    isLeftSidePanelOpen,
    isRightSidePanelOpen,
    selectedLeftSidePanel,
    selectedRightSidePanel,
  } = useViewerSidePanels();

  const timepointApi = useMemo(() => new TimepointApi(currentTimepointId, { onTimepointsUpdated }), []);
  const measurementApi = useMemo(() => new MeasurementApi(timepointApi, { onMeasurementsUpdated }), []);

  const dialog = useDialog();

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
    if (studies) {
      const PatientID = studies[0] && studies[0].PatientID;

      timepointApi.retrieveTimepoints({ PatientID });
      if (isStudyLoaded) {
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

    document.addEventListener('segmentationLoadingError', updateThumbnailsCb, false);

    return () => {
      if (dialog) {
        dialog.dismissAll();
      }

      document.removeEventListener('segmentationLoadingError', updateThumbnailsCb);
    };
  }, []);

  useLayoutEffect(() => {
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
    const activeViewport = viewports[activeViewportIndex];
    const activeDisplaySetInstanceUID = activeViewport ? activeViewport.displaySetInstanceUID : undefined;

    setThumbnails(mapStudiesToThumbnails(studies, activeDisplaySetInstanceUID));
  }, [viewports, activeViewportIndex, studies]);

  useEffect(() => {
    if (isStudyLoaded) {
      const PatientID = studies[0] && studies[0].PatientID;

      timepointApi.retrieveTimepoints({ PatientID });
      measurementApi.retrieveMeasurements(PatientID, [currentTimepointId]).then(updateThumbnails);
    }
  }, [isStudyLoaded]);

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
      <WhiteLabelingContext.Consumer>
        {(whiteLabeling) => (
          <UserManagerContext.Consumer>
            {(userManager) => (
              <AppContext.Consumer>
                {(appContext) => (
                  <ConnectedHeader
                    linkText={appContext.appConfig.showStudyList ? 'Study List' : undefined}
                    linkPath={appContext.appConfig.showStudyList ? '/' : undefined}
                    userManager={userManager}
                  >
                    {whiteLabeling && whiteLabeling.createLogoComponentFn && whiteLabeling.createLogoComponentFn(React)}
                  </ConnectedHeader>
                )}
              </AppContext.Consumer>
            )}
          </UserManagerContext.Consumer>
        )}
      </WhiteLabelingContext.Consumer>
      {/* TOOLBAR */}
      <ErrorBoundaryDialog context="ToolbarRow">
        <ToolbarRow activeViewport={viewports[activeViewportIndex]} studies={studies} />
      </ErrorBoundaryDialog>
      <AppContext.Consumer>{() => <StudyLoadingMonitor studies={studies} />}</AppContext.Consumer>
      {/* VIEWPORTS + SIDEPANELS */}
      <div className="FlexboxLayout">
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
            <ViewerMain studies={studies} isStudyLoaded={isStudyLoaded} />
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
  activeServer: PropTypes.shape({
    type: PropTypes.string,
    wadoRoot: PropTypes.string,
  }),
  onTimepointsUpdated: PropTypes.func,
  onMeasurementsUpdated: PropTypes.func,
  // window.store.getState().viewports.viewportSpecificData
  viewports: PropTypes.object.isRequired,
  // window.store.getState().viewports.activeViewportIndex
  activeViewportIndex: PropTypes.number.isRequired,
  isStudyLoaded: PropTypes.bool,
};
