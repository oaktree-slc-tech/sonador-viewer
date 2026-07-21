// Initialize Legacy Cornerstone and Cornerstone Tools integration with Sonador Viewer.
// New features within Sonador should be built on top of the Cornerstone3D package
// and utilize the `vtk` extension for managing their interfaces.

import merge from 'lodash.merge';

import cornerstone from 'cornerstone-core';
import csTools from 'cornerstone-tools';

import OHIF from '@ohif/core';
import { InputDialog } from '@ohif/ui';

import srModuleId from './tools/id';
import dicomSRModule from './tools/modules/dicomSRModule';
import DICOMSRSeriesTagTool from './tools/DICOMSRSeriesTag';
import initCornerstoneTools from './initCornerstoneTools.js';
import { connectToolsToMeasurementService } from './initMeasurementService.js';
import { initDataServiceIntegration } from './initDataIntegrations.js';
import { registerSonadorLocalImageLoader } from './loaders/sonadorLocalImageLoader.js';


export default function init({ servicesManager, commandsManager, configuration }) {
  /**
  *
  * @param {Object} servicesManager
  * @param {Object} configuration
  * @param {Object|Array} configuration.csToolsConfig
  */

  const {
    UIDialogService,
    MeasurementService,
    displaySetService,
    customizationService,
    cornerstoneViewportService,
  } = servicesManager.services;

  console.warn('Cornerstone services: ', servicesManager.services);

  csTools.register('module', srModuleId, dicomSRModule);

  const callInputDialog = (data, event, callback) => {
    if (UIDialogService) {
      let dialogId = UIDialogService.create({
        centralize: true,
        isDraggable: false,
        content: InputDialog,
        useLastPosition: false,
        showOverlay: true,
        contentProps: {
          title: 'Enter your annotation',
          label: 'New label',
          measurementData: data ? { description: data.text } : {},
          onClose: () => UIDialogService.dismiss({ id: dialogId }),
          onSubmit: (value) => {
            callback(value);
            UIDialogService.dismiss({ id: dialogId });
          },
        },
      });
    }
  };

  const {
    csToolsConfig,
    stackPrefetch = {
      maxImagesToPrefetch: Infinity,
      preserveExistingPool: false,
      maxSimultaneousRequests: 20,
    },
  } = configuration;
  const metadataProvider = OHIF.cornerstone.metadataProvider;

  cornerstone.metaData.addProvider(metadataProvider.get.bind(metadataProvider), 9999);

  // ~~
  const defaultCsToolsConfig = csToolsConfig || {
    globalToolSyncEnabled: true,
    showSVGCursors: true,
    autoResizeViewports: false,
  };

  OHIF.utils.cornerstone3dUtils.initCornerstone3d();
  initCornerstoneTools({ ...defaultCsToolsConfig, ...stackPrefetch });

  // Register the local/offline cache image loader (ohif-viewers#125, AR-3). registerImageLoader only
  // writes to Cornerstone3D's scheme->loader map, so this can run immediately after init kicks off
  // (initCornerstone3d already called @cornerstonejs/dicom-image-loader's init(), §2.4/AR-3) and
  // before initDataServiceIntegration wires up the volume loaders / metadata providers.
  registerSonadorLocalImageLoader();

  const toolsGroupedByType = {
    touch: [csTools.PanMultiTouchTool, csTools.ZoomTouchPinchTool],
    annotations: [
      csTools.ArrowAnnotateTool,
      csTools.BidirectionalTool,
      csTools.LengthTool,
      csTools.AngleTool,
      csTools.FreehandRoiTool,
      csTools.EllipticalRoiTool,
      csTools.DragProbeTool,
      csTools.RectangleRoiTool,
      DICOMSRSeriesTagTool,
    ],
    other: [
      csTools.PanTool,
      csTools.ZoomTool,
      csTools.WwwcTool,
      csTools.WwwcRegionTool,
      csTools.MagnifyTool,
      csTools.StackScrollTool,
      csTools.StackScrollMouseWheelTool,
      csTools.OverlayTool,
    ],
  };

  let tools = [];
  Object.keys(toolsGroupedByType).forEach((toolsGroup) => tools.push(...toolsGroupedByType[toolsGroup]));

  /* Measurement Service */
  connectToolsToMeasurementService(MeasurementService, displaySetService, cornerstoneViewportService, customizationService);

  /* Dataservices Integration: sync data between OHIF v3 services, Cornerstone Legacy/Classic Providers, and Cornerstone 3D */
  initDataServiceIntegration({ servicesManager, commandsManager });

  /* Add extension tools configuration here. */
  const internalToolsConfig = {
    ArrowAnnotate: {
      configuration: {
        getTextCallback: (callback, eventDetails) => callInputDialog(null, eventDetails, callback),
        changeTextCallback: (data, eventDetails, callback) => callInputDialog(data, eventDetails, callback),
      },
    },
  };

  /* Abstract tools configuration using extension configuration. */
  const parseToolProps = (props, tool) => {
    const { annotations } = toolsGroupedByType;
    // An alternative approach would be to remove the `drawHandlesOnHover` config
    // from the supported configuration properties in `cornerstone-tools`
    const toolsWithHideableHandles = annotations.filter(
      (tool) => !['RectangleRoiTool', 'EllipticalRoiTool'].includes(tool.name)
    );

    let parsedProps = { ...props };

    /**
     * drawHandles - Never/Always show handles
     * drawHandlesOnHover - Only show handles on handle hover (pointNearHandle)
     *
     * Does not apply to tools where handles aren't placed in predictable
     * locations.
     */
    if (configuration.hideHandles !== false && toolsWithHideableHandles.includes(tool)) {
      if (props.configuration) {
        parsedProps.configuration.drawHandlesOnHover = true;
      } else {
        parsedProps.configuration = { drawHandlesOnHover: true };
      }
    }

    return parsedProps;
  };

  /* Add tools with its custom props through extension configuration. */
  tools.forEach((tool) => {
    console.log('[]')

    const toolName = tool.name.replace('Tool', '');
    const externalToolsConfig = configuration.tools || {};
    const externalToolProps = externalToolsConfig[toolName] || {};
    const internalToolProps = internalToolsConfig[toolName] || {};
    const props = merge(internalToolProps, parseToolProps(externalToolProps, tool));
    csTools.addTool(tool, props);
  });

  // TODO -> We need a better way to do this with maybe global tool state setting all tools passive.
  const BaseAnnotationTool = csTools.importInternal('base/BaseAnnotationTool');
  tools.forEach((tool) => {
    if (tool.prototype instanceof BaseAnnotationTool) {
      // BaseAnnotationTool would likely come from csTools lib exports
      const toolName = new tool().name;
      csTools.setToolPassive(toolName); // there may be a better place to determine name; may not be on uninstantiated class
    }
  });

  csTools.setToolActive('Pan', { mouseButtonMask: 4 });
  csTools.setToolActive('Zoom', { mouseButtonMask: 2 });
  csTools.setToolActive('Wwwc', { mouseButtonMask: 1 });
  csTools.setToolActive('StackScrollMouseWheel', {}); // TODO: Empty options should not be required
  csTools.setToolActive('PanMultiTouch', { pointers: 2 }); // TODO: Better error if no options
  csTools.setToolActive('ZoomTouchPinch', {});
  csTools.setToolEnabled('Overlay', {});
  csTools.setToolEnabled(OHIF.DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG, {});
}

