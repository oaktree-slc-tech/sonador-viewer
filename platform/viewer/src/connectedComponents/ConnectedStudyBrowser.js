import { connect } from 'react-redux';

import OHIF from '@ohif/core';
import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';
import { StudyBrowser } from '@ohif/ui';

import { servicesManager } from '../App';

import findDisplaySetByUID from './findDisplaySetByUID';

const { setActiveViewportSpecificData } = OHIF.redux.actions;

const mapDispatchToProps = (dispatch, ownProps) => {
  return {
    onThumbnailClick: (displaySetInstanceUID) => {
      let displaySet = findDisplaySetByUID(ownProps.studyMetadata, displaySetInstanceUID);

      const { LoggerService, UINotificationService } = servicesManager.services;

      if (displaySet.isDerived) {
        const { Modality } = displaySet;
        if (Modality === 'SEG' && servicesManager) {
          const onDisplaySetLoadFailureHandler = (error) => {
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

const ConnectedStudyBrowser = connect(null, mapDispatchToProps)(StudyBrowser);

export default ConnectedStudyBrowser;
