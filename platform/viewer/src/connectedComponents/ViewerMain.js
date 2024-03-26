import React, { useEffect, useMemo, useState } from 'react';
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

const { setViewportSpecificData, clearViewportSpecificData } = OHIF.redux.actions;

export default function ViewerMain({ studies, isStudyLoaded }) {
  const dispatch = useDispatch();
  const { studyInstanceUIDs } = useParams();

  const { layout, viewportSpecificData } = useSelector((state) => state.viewports);

  const [displaySets, setDisplaySets] = useState([]);

  const { addError } = useViewerStudyErrors();

  const viewportData = useMemo(() => values(viewportSpecificData), [viewportSpecificData]);

  const getDisplaySets = (studies) => {
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
    const study = studies.find((study) => {
      return study.StudyInstanceUID === StudyInstanceUID;
    });

    if (!study) {
      return;
    }

    return study.displaySets.find((displaySet) => {
      return displaySet.displaySetInstanceUID === displaySetInstanceUID;
    });
  };

  const setViewportData = ({ viewportIndex, StudyInstanceUID, displaySetInstanceUID }) => {
    let displaySet = findDisplaySet(studies, StudyInstanceUID, displaySetInstanceUID);

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

          if (studyInstanceUIDs) {
            addError({ studyId: studyInstanceUIDs, error: message, title: errorTitle });
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

        if (studyInstanceUIDs) {
          addError({ studyId: studyInstanceUIDs, error: message, title: errorTitle });
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

      if (studyInstanceUIDs) {
        addError({ studyId: studyInstanceUIDs, error: message, title: errorTitle });
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
    if (studies) {
      setDisplaySets(getDisplaySets(studies));
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
      // Clear the entire viewport specific data
      Object.keys(viewportSpecificData).forEach((viewportIndex) => {
        dispatch(clearViewportSpecificData(viewportIndex));
      });
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
};
