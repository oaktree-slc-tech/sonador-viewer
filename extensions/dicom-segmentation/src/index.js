import React from 'react';

import OHIF from '@ohif/core';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

import { Enums as vtkEnums } from '@ohif/extension-vtk';

import dicomSegmentationPackage from '../package.json';

import SegmentationPanel from './components/SegmentationPanel/SegmentationPanel.js';
import commandsModule from './commandsModule.js';
import getSopClassHandlerModule from './getOHIFDicomSegSopClassHandler.js';
import init from './init.js';
import { isSegmentationPanelDisabled } from './segmentationPanelGate.js';
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
    const { LoggerService } = servicesManager.services;

    const ExtendedSegmentationPanel = (props) => {
      const { activeContexts } = api.hooks.useAppContext();
      const onDisplaySetLoadFailureHandler = (error) => {
        const message =
          error.message.includes('orthogonal') || error.message.includes('oblique')
            ? 'The segmentation has been detected as non coplanar,\
              If you really think it is coplanar,\
              please adjust the tolerance in the segmentation panel settings (at your own peril!)'
            : error.message;
        LoggerService.error({
          error,
          title: 'DICOM Segmentation Loader',
          message,
          notify: true,
          studyInstanceUID: extractStudyIdFromURL(),
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
        }, vtkEnums.VIEWPORT);
      };

      const onConfigurationChangeHandler = (configuration) => {
        commandsManager.runCommand('setSegmentationConfiguration', {
          globalOpacity: configuration.fillAlpha,
          outlineThickness: configuration.outlineWidth,
          renderOutline: configuration.renderOutline,
          visible: configuration.renderFill,
        }, vtkEnums.VIEWPORT);
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
      const { segDisplaySet, segMetadata } = detail || {};

      // This is a document-level event, so anything can dispatch it. Only a real SEG load carries
      // the payload below; a dispatch without it is not one, and must not take the panel tab down.
      if (!segDisplaySet || !segMetadata) {
        return;
      }

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
          // The tab is offered for SEG studies, STL model studies and while the Segmentation
          // Editor is open (segmentationPanelGate)
          isDisabled: (studies, activeViewport) => isSegmentationPanelDisabled(studies, activeViewport, {
            onSegBadge: triggerSegmentationPanelTabUpdatedEvent,
          }),
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
