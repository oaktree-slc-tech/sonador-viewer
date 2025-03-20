import { connect } from 'react-redux';

import OHIF from '@ohif/core';
import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';
import { StudyBrowser } from '@ohif/ui';
import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';

import { servicesManager, commandsManager } from '../App';

import findDisplaySetByUID from './findDisplaySetByUID';

const { setActiveViewportSpecificData, setLayout, setViewportActive } = OHIF.redux.actions;

const mapStateToProps = (state) => {
  return {
    currentLayout: state.viewports.layout,
    activeViewportIndex: state.viewports.activeViewportIndex,
  };
};

const mapDispatchToProps = (dispatch, ownProps) => {
  return {
    onThumbnailClick: (displaySetInstanceUID, currentLayout, activeViewportIndex) => {
      const { setIsDisplayedLayoutButton } = useLayoutButton.getState();

      let displaySet = findDisplaySetByUID(ownProps.studyMetadata, displaySetInstanceUID);

      const { LoggerService, UINotificationService, viewportGridService } = servicesManager.services;

      const viewports = [];

      // Restore Cornerstone layout
      if (currentLayout.viewports.length) {
        const viewport = currentLayout.viewports[0];
        let plugin = viewport && viewport.plugin;

        if (viewport && viewport.vtk) {
          plugin = 'cornerstone';
          viewports.push({ plugin });

          // Reset viewports to Cornerstone
          if (activeViewportIndex > 0) {
            dispatch(setViewportActive(0));
          }

          dispatch(setLayout({ numRows: 1, numCols: 1, viewports }));
        }
      }

      // Display the layout button
      setIsDisplayedLayoutButton(true);

      if (displaySet.isDerived) {
        // Apply special formatting to derived formats
        const { Modality } = displaySet;

        if (Modality === 'SEG' && servicesManager) {
          const onDisplaySetLoadFailureHandler = (error) => {
            // Display error messages for faillure to load segmentation
            const message =
              error.message.includes('orthogonal') || error.message.includes('oblique')
                ? 'The segmentation has been detected as non coplanar,\
                If you really think it is coplanar,\
                please adjust the tolerance in the segmentation panel settings (at your own peril!)'
                : error.message;
            const studyId = extractStudyIdFromURL();
            const errorTitle = 'DICOM Segmentation Loader';

            if (studyId) {
              useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
            }

            LoggerService.error({ error, message });
            UINotificationService.show({
              title: errorTitle,
              message,
              type: 'error',
              autoClose: false,
            });
          };

          const { referencedDisplaySet, activatedLabelmapPromise } = displaySet.getSourceDisplaySet(
            ownProps.studyMetadata,
            true,
            onDisplaySetLoadFailureHandler
          );
          displaySet = referencedDisplaySet;

          activatedLabelmapPromise.then((activatedLabelmapIndex) => {
            const selectionFired = new CustomEvent('extensiondicomsegmentationsegselected', {
              detail: { activatedLabelmapIndex: activatedLabelmapIndex },
            });
            const segThumbnailSelected = new CustomEvent('segseriesselected');
            document.dispatchEvent(selectionFired);
            document.dispatchEvent(segThumbnailSelected);
          });
        } else if (Modality !== 'SR') {
          displaySet = displaySet.getSourceDisplaySet(ownProps.studyMetadata);
        }

        if (!displaySet) {
          const error = new Error(`Referenced series for ${Modality} dataset not present.`);
          const message = `Referenced series for ${Modality} dataset not present.`;
          LoggerService.error({ error, message });

          const studyId = extractStudyIdFromURL();
          const errorTitle = 'Fail to load series';

          if (studyId) {
            useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
          }

          UINotificationService.show({
            autoClose: false,
            title: errorTitle,
            message,
            type: 'error',
          });
        }
      }

      if (!displaySet) {
        const error = new Error('Source data not present');
        const message = 'Source data not present';
        LoggerService.error({ error, message });

        const studyId = extractStudyIdFromURL();
        const errorTitle = 'Fail to load series';

        if (studyId) {
          useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
        }

        UINotificationService.show({
          autoClose: false,
          title: errorTitle,
          message,
          type: 'error',
        });
      }

      if (displaySet.isSOPClassUIDSupported === false) {
        const error = new Error('Modality not supported');
        const message = 'Modality not supported';
        LoggerService.error({ error, message });

        const studyId = extractStudyIdFromURL();
        const errorTitle = 'Fail to load series';

        if (studyId) {
          useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
        }

        UINotificationService.show({
          autoClose: false,
          title: errorTitle,
          message,
          type: 'error',
        });
      }

      dispatch(setActiveViewportSpecificData(displaySet));
    },
  };
};

const mergeProps = (propsFromState, propsFromDispatch, ownProps) => {
  const onThumbnailClickFromDispatch = propsFromDispatch.onThumbnailClick;
  const { currentLayout, activeViewportIndex } = propsFromState;

  return {
    ...ownProps,
    onThumbnailClick: (displaySetInstanceUID) =>
      onThumbnailClickFromDispatch(displaySetInstanceUID, currentLayout, activeViewportIndex),
  };
};

const ConnectedStudyBrowser = connect(mapStateToProps, mapDispatchToProps, mergeProps)(StudyBrowser);

export default ConnectedStudyBrowser;
