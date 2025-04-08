import React from 'react';

import OHIF from '@ohif/core';
import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

import dicomSegmentationPackage from '../package.json';

import SegmentationPanel from './components/SegmentationPanel/SegmentationPanel.js';
import commandsModule from './commandsModule.js';
import getSopClassHandlerModule from './getOHIFDicomSegSopClassHandler.js';
import init from './init.js';
import toolbarModule from './toolbarModule.js';
const { studyMetadataManager } = OHIF.utils;

const SegmentationPanelTabUpdatedEvent = 'segmentation-panel-tab-updated';

const eventTypes = {
  SegmentationPanelTabUpdatedEvent,
};

const segmentationExtension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'com.ohif.dicom-segmentation',
  version: dicomSegmentationPackage.version,

  /**
   *
   *
   * @param {object} [configuration={}]
   * @param {object|array} [configuration.csToolsConfig] - Passed directly to `initCornerstoneTools`
   */
  preRegistration({ servicesManager, configuration = {} }) {
    init({ servicesManager, configuration });
  },
  getToolbarModule({ servicesManager }) {
    return toolbarModule;
  },
  getPanelModule({ commandsManager, api, servicesManager }) {
    const { UINotificationService, LoggerService } = servicesManager.services;

    const ExtendedSegmentationPanel = (props) => {
      const { activeContexts } = api.hooks.useAppContext();
      const onDisplaySetLoadFailureHandler = (error) => {
        const message =
          error.message.includes('orthogonal') || error.message.includes('oblique')
            ? 'The segmentation has been detected as non coplanar,\
              If you really think it is coplanar,\
              please adjust the tolerance in the segmentation panel settings (at your own peril!)'
            : error.message;
        LoggerService.error({ error, message });

        const studyId = extractStudyIdFromURL();
        const errorTitle = 'DICOM Segmentation Loader';

        if (studyId) {
          // Will be called only on Viewer study page
          useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
        }

        UINotificationService.show({
          title: errorTitle,
          message,
          type: 'error',
          autoClose: false,
        });
      };

      const segmentItemClickHandler = (data) => {
        commandsManager.runCommand('jumpToImage', data);
        commandsManager.runCommand('jumpToSlice', data);
      };

      const onSegmentVisibilityChangeHandler = (segmentNumber, visible) => {
        commandsManager.runCommand('setSegmentConfiguration', {
          segmentNumber,
          visible,
        });
      };

      const onConfigurationChangeHandler = (configuration) => {
        commandsManager.runCommand('setSegmentationConfiguration', {
          globalOpacity: configuration.fillAlpha,
          outlineThickness: configuration.outlineWidth,
          renderOutline: configuration.renderOutline,
          visible: configuration.renderFill,
        });
      };

      const onSelectedSegmentationChangeHandler = () => {
        commandsManager.runCommand('requestNewSegmentation');
      };

      return (
        <SegmentationPanel
          {...props}
          activeContexts={activeContexts}
          contexts={api.contexts}
          onSegmentItemClick={segmentItemClickHandler}
          onSegmentVisibilityChange={onSegmentVisibilityChangeHandler}
          onConfigurationChange={onConfigurationChangeHandler}
          onSelectedSegmentationChange={onSelectedSegmentationChangeHandler}
          onDisplaySetLoadFailure={onDisplaySetLoadFailureHandler}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      );
    };

    /**
     * Trigger's an event to update the state of the panel's RoundedButtonGroup.
     *
     * This is required to avoid extension state
     * coupling with the viewer's ToolbarRow component.
     *
     * @param {object} data
     */
    const triggerSegmentationPanelTabUpdatedEvent = (data) => {
      const event = new CustomEvent(SegmentationPanelTabUpdatedEvent, {
        detail: data,
      });
      document.dispatchEvent(event);
    };

    const onSegmentationsLoaded = ({ detail }) => {
      const { segDisplaySet, segMetadata } = detail;
      const studyMetadata = studyMetadataManager.get(segDisplaySet.StudyInstanceUID);
      const referencedDisplaysets = studyMetadata.getDerivedDatasets({
        referencedSeriesInstanceUID: segMetadata.seriesInstanceUid,
        Modality: 'SEG',
      });
      triggerSegmentationPanelTabUpdatedEvent({
        badgeNumber: referencedDisplaysets.length,
        target: 'segmentation-panel',
      });
    };

    const onSegmentationsCompletelyLoaded = () => {
      commandsManager.runCommand('jumpToFirstSegment');
    };

    document.addEventListener('segseriesselected', onSegmentationsCompletelyLoaded);

    document.addEventListener('extensiondicomsegmentationsegloaded', onSegmentationsLoaded);

    return {
      menuOptions: [
        {
          icon: 'list',
          label: 'Segmentations',
          target: 'segmentation-panel',
          stateEvent: SegmentationPanelTabUpdatedEvent,
          isDisabled: (studies, activeViewport) => {
            if (!studies) {
              return true;
            }

            for (let i = 0; i < studies.length; i++) {
              const study = studies[i];

              if (study && study.series) {
                for (let j = 0; j < study.series.length; j++) {
                  const series = study.series[j];

                  if (series.Modality === 'SEG') {
                    if (activeViewport) {
                      const studyMetadata = studyMetadataManager.get(activeViewport.StudyInstanceUID);
                      if (!studyMetadata) {
                        return;
                      }
                      const referencedDS = studyMetadata.getDerivedDatasets({
                        referencedSeriesInstanceUID: activeViewport.SeriesInstanceUID,
                        Modality: 'SEG',
                      });
                      triggerSegmentationPanelTabUpdatedEvent({
                        badgeNumber: referencedDS.length,
                        target: 'segmentation-panel',
                      });
                    }
                    return false;
                  }
                }
              }
            }

            return true;
          },
        },
      ],
      components: [
        {
          id: 'segmentation-panel',
          component: ExtendedSegmentationPanel,
        },
      ],
      defaultContext: ['VIEWER'],
    };
  },
  getCommandsModule({ commandsManager, servicesManager }) {
    return commandsModule({ commandsManager, servicesManager });
  },
  getSopClassHandlerModule,
};

export default segmentationExtension;
export { eventTypes };
