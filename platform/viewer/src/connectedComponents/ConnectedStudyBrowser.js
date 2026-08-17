import { connect } from 'react-redux';

import OHIF from '@ohif/core';
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

      const { LoggerService, viewportGridService } = servicesManager.services;

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

          // numColumns (not numCols): the reducer prunes viewportSpecificData with
          // numRows * numColumns, so a misspelled key left the extra MPR viewport entries in
          // state after the layout had already collapsed back to a single viewport.
          dispatch(setLayout({ numRows: 1, numColumns: 1, viewports }));
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

            // One call: console, unified Issues list, and a sticky toast (ohif-viewers#84).
            LoggerService.error({
              error,
              title: errorTitle,
              message,
              notify: true,
              studyInstanceUID: studyId,
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
          LoggerService.error({
            error,
            title: 'Fail to load series',
            message,
            notify: true,
            studyInstanceUID: extractStudyIdFromURL(),
          });
        }
      }

      if (!displaySet) {
        const error = new Error('Source data not present');
        const message = 'Source data not present';
        LoggerService.error({
          error,
          title: 'Fail to load series',
          message,
          notify: true,
          studyInstanceUID: extractStudyIdFromURL(),
        });
      }

      if (displaySet.isSOPClassUIDSupported === false) {
        const error = new Error('Modality not supported');
        const message = 'Modality not supported';
        LoggerService.error({
          error,
          title: 'Fail to load series',
          message,
          notify: true,
          studyInstanceUID: extractStudyIdFromURL(),
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
