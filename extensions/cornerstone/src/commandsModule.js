// The Cornerstone Tools extension provides the core components of the OHIF viewer
// including the primary toolbar, core overlays, and interaction for the viewer.
import _ from 'lodash';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import OHIF from '@ohif/core';
import { workflow, SaveDicomSeriesDialog } from '@ohif/ui';

import setCornerstoneLayout from './utils/setCornerstoneLayout';
import CornerstoneViewportDownloadForm from './CornerstoneViewportDownloadForm';
import { getEnabledElement } from './state';
import cornerstoneToolEnums from './tools/constants/toolNames.js';

const scroll = cornerstoneTools.import('util/scroll');

const {
  sonador,
  log,
  measurements,
  display,
  LocalCacheService,
  DownloadManagerService,
  ArchiveDownloadService,
  notifyStudiesQueued,
  notifyArchivesQueued,
} = OHIF;
const { studyMetadataManager, cornerstoneUtils } = OHIF.utils;
const { setViewportSpecificData } = OHIF.redux.actions;


const commandsModule = ({ commandsManager, servicesManager }) => {

  const actions = {

    getCornerstoneEnabledElement({ viewports }) {
      // Retrieve active/active Cornerstone element for the currently active viewport.
      // Verifies that the element is enabled/active and includes an image annotation.

      // Retrieve currently active element
      const element = getEnabledElement(viewports.activeViewportIndex);
      if (!element) {
        log.warn('[cornerstone:commandsManager:getCornerstoneEnabledElement] no element available for the active viewport.',
          'activeViewportIndex='+viewports.activeViewportIndex);
        return;
      }

      // Determine if the active element is enabled and includes an active image reference
      const enabledElement = cornerstone.getEnabledElement(element);
      if (!enabledElement || !enabledElement.image) {
        log.warn('[cornerstone:commandsManager:getCornerstoneEnabledElement] no enabled element or no image.',
          enabledElement, (enabledElement || {}).image);
        return;
      }

      return { element, enabledElement };
    },

    rotateViewport: ({ viewports, rotation }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        let viewport = cornerstone.getViewport(enabledElement);
        viewport.rotation += rotation;
        cornerstone.setViewport(enabledElement, viewport);
      }
    },

    flipViewportHorizontal: ({ viewports }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        let viewport = cornerstone.getViewport(enabledElement);
        viewport.hflip = !viewport.hflip;
        cornerstone.setViewport(enabledElement, viewport);
      }
    },

    flipViewportVertical: ({ viewports }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        let viewport = cornerstone.getViewport(enabledElement);
        viewport.vflip = !viewport.vflip;
        cornerstone.setViewport(enabledElement, viewport);
      }
    },

    scaleViewport: ({ direction, viewports }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);
      const step = direction * 0.15;

      if (enabledElement) {
        if (step) {
          let viewport = cornerstone.getViewport(enabledElement);
          viewport.scale += step;
          cornerstone.setViewport(enabledElement, viewport);
        } else {
          cornerstone.fitToWindow(enabledElement);
        }
      }
    },

    labellingDialog: ({ viewports, measurementData, dialogProps }) => {
      // Open the labelling dialog to allow for annotation of the provided measurement data
      
      dialogProps = dialogProps || {};

      const { UINotificationService, UIDialogService } = servicesManager.services;
      if (!UIDialogService) {
        console.warn('Unable to show dialog; no UI Dialog Service available.');
        return;
      }      

      // Unpack labelling attributes to back-fill data from dialog. _unpackMeasurementLabellingAttrs
      // looks within all sections of the measurement data for attributes and flattens.
      const labellingAttrs0 = OHIF.measurements.MeasurementApi._unpackMeasurementLabellingAttrs(measurementData);

      UIDialogService.dismiss({ id: 'labelling' });
      UIDialogService.create({
        id: 'labelling',
        centralize: true,
        isDraggable: false,
        showOverlay: true,
        content: workflow.LabellingFlow,
        contentProps: {
          measurementData: labellingAttrs0,
          labellingDoneCallback: () => UIDialogService.dismiss({ id: 'labelling' }),
          updateLabelling: ({ location, description, response }) => {

            measurementData.location = location || labellingAttrs0.location || '';
            measurementData.description = description || labellingAttrs0.description || '';
            measurementData.response = response || measurementData.response;

            commandsManager.runCommand('updateTableWithNewMeasurementData', measurementData);
          },
          ...dialogProps,
        },
      });
    },

    seriesTagDialog: ({ viewports, servers, measurementData, dialogProps }) => {
      // Add a series tag to the currently selected viewport. The series tag tool type
      // allows for a "tag" (coded concept) to be attached to a series instance.

      dialogProps = dialogProps || {};

      const { UINotificationService, UIDialogService } = servicesManager.services;
      
      if (!UIDialogService) {
        console.warn('Unable to show dialog; no UI Dialog Service available.');
        return;
      }

      // Initialize series tag measurement data, add measurement type and toolType to structure
      measurementData = measurementData || {};
      if (!measurementData.toolType || !measurement.type) {

        _.extend(measurementData, {
          toolType: cornerstoneToolEnums.DICOM_SR_SERIES_TAG,
          type: OHIF.measurements.ValueTypes.CODED_CONCEPT,
        });
      }

      // Retrieve currently active server
      const activeServer = sonador.getActiveServer(servers.servers);

      if (UIDialogService && activeServer && activeServer.rootUrl) {

        // Retrieve list of groups with active tags
        sonador.searchImageServerGroups(activeServer, '', { tag: true })
          .then((res) => res.json())
          .then((res) => {

            if (res.results) {

              // Dismiss labelling service dialog
              UIDialogService.dismiss({ id: 'labelling' });
              UIDialogService.create({
                id: 'labelling',
                centralize: true,
                isDraggable: false,
                showOverlay: true,
                content: workflow.SeriesTagLabellingFlow,
                contentProps: {
                  server: activeServer,
                  groups: res.results,
                  measurementData: OHIF.measurements.MeasurementApi._unpackMeasurementLabellingAttrs(measurementData),
                  labellingDoneCallback: () => UIDialogService.dismiss({ id: 'labelling' }),
                  labellingCanceledCallback: ({ tags, group }) => {
                    // Close dialog instance and display notification error
                    
                    UIDialogService.dismiss({ id: 'labelling' });

                    // Group does not have any tags associated with it
                    if (!tags || !tags.length) {

                      UINotificationService.show({
                        title: 'Unable to apply tag to series',
                        message: `Group "${group.name}" does not have any tags associated with it`,
                        type: 'warning',
                        autoClose: true,
                      });
                    }
                  },
                  updateLabelling: ({ value, text, description, scheme, schemeVersion, group }) => {
                    // Update measurement service with tag value

                    // Add tag to measurement API
                    const { _id, uid } = OHIF.measurements.MeasurementApi._unpackMeasurementData(measurementData);
                    if (!_id && !uid) {
                      
                      const { element, enabledElement } = actions.getCornerstoneEnabledElement({ viewports });
                      if (!enabledElement) {
                        console.warn('[cornerstone:commands:seriesTagDialog] unable to retrieve enabled element');
                        return;
                      }

                      cornerstoneTools.setToolEnabled(
                        OHIF.DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG, {}, element);

                      //  Add measurements to Cornerstone Tool State
                      cornerstoneTools.addToolState(
                        element, OHIF.DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG, measurementData);
                    }

                    // Add location, description, and response attributes from the tag workflow
                    measurementData.value = value || measurementData.value;
                    measurementData.description = description || measurementData.description || '';
                    measurementData.text = text || measurementData.text || '';
                    measurementData.scheme = scheme || measurementData.metadata?.scheme || measurementData.scheme;
                    measurementData.schemeVersion = schemeVersion || measurementData.metadata?.scheme || measurementData.schemeVersion

                    // Update measurements table
                    commandsManager.runCommand('updateTableWithNewMeasurementData', measurementData);
                  },
                  skipAddLabelButton: true,
                },
                ...dialogProps,
              });
            }
          });
      }
    },

    saveMeasurements: ({ viewports, servers, seriesNumber, dialogProps }) => {
      // Persist measurement data to the currently active server

      dialogProps = dialogProps || {};

      const { UINotificationService, UIDialogService } = servicesManager.services;

      // Retrieve currently active server
      const activeServer = sonador.getActiveServer(servers.servers);

      // Clear any active save dialogs
      UIDialogService.dismiss({ id: 'saveDicomSeries' });

      // Propmpt user to provide a series number and description
      const promise = new Promise((resolve, reject) => {
      
        UIDialogService.create({
          id: 'saveDicomSeries',
          centralize: true,
          isDraggable: false,
          showOverlay: true,
          content: SaveDicomSeriesDialog,
          contentProps: {            
            seriesNumber,
            onUpdate: ({ SeriesNumber, SeriesDescription }) => {

              const measurementApi = OHIF.measurements.MeasurementApi.Instance;
              const promise = measurementApi.storeMeasurements(undefined, {
                headers: { SeriesNumber, SeriesDescription },
                success: () => {

                  // Resolve save measurements successfully
                  UIDialogService.dismiss({ id: 'saveDicomSeries' });
                  resolve({ title: 'Measurements saved successfully', message: 'Data persisted to '+activeServer.name, });
                }
              });
            },
            onCancel: () => {
              UIDialogService.dismiss({ id: 'saveDicomSeries' });
              reject({ title: 'Save cancelled', cancelled: true, message: 'Persistence of measurement data cancelled' });
            },
            btnTextConfirm: 'Save Measurements',
            ...dialogProps,
          }
        });
      });

      return promise;
    },

    checkDistortionFilterDialog: ({ viewports, servers, dialogProps }) => {
      // Check current series to ensure that it passes all distortion filter tests
      
      dialogProps = dialogProps || {};
      const { UINotificationService, UIDialogService } = servicesManager.services;

      // Retrieve currently active server
      const activeServer = sonador.getActiveServer(servers.servers);
      const { StudyInstanceUID } = viewports.viewportSpecificData?.[0];
      if (!StudyInstanceUID) {
        throw new Error('Unable to check distortion filter, invalid StudyInstanceUID');
      }      

      if (UIDialogService && activeServer && activeServer.rootUrl) {

        // Clear any active distortion filter dialogs
        UIDialogService.dismiss({ id: 'checkDistortionFilter' });

        // Retrieve list of groups with active tags
        sonador.searchImageServerGroups(activeServer, '', { devices_list: true })
          .then((res) => res.json())
          .then((res) => {

            if (res.results) {

              // Dismiss labelling service dialog
              UIDialogService.dismiss({ id: 'labelling' });
              UIDialogService.create({
                id: 'checkDistortionFilter',
                centralize: true,
                isDraggable: false,
                showOverlay: true,
                content: workflow.DistortionFilterFlow,
                contentProps: {                  
                  server: activeServer,
                  groups: res.results,
                  StudyInstanceUID,
                  UINotificationService,
                  distortionFilterDoneCallback: () => UIDialogService.dismiss({ id: 'checkDistortionFilter' }),
                },
                ...dialogProps,
              });
            }
          });
      }
    },

    resetViewport: ({ viewports }) => {
      // Reset viewport to the state of the images when first loaded

      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        cornerstone.reset(enabledElement);
      }
    },
    invertViewport: ({ viewports }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        let viewport = cornerstone.getViewport(enabledElement);
        viewport.invert = !viewport.invert;
        cornerstone.setViewport(enabledElement, viewport);
      }
    },
    
    setToolActive: ({ toolName }) => {
      // Sets the state of a tool to active

      if (!toolName) {
        log.warn('No toolname provided to setToolActive command');
      }
      cornerstoneTools.setToolActive(toolName, { mouseButtonMask: 1 });
    },

    clearAnnotations: ({ viewports }) => {
      // Clear annotations and measurements from the active viewport
      log.debug('[cornerstone:commandsManager:clearAnnotations] annotation count (pre-clear)',
        OHIF.measurements.MeasurementApi.Instance.measurementsCount());

      // Retrieve currently active element
      const { element, enabledElement } = actions.getCornerstoneEnabledElement({ viewports });
      if (!enabledElement || !enabledElement.image) {
        log.warn('[cornerstone:commandsManager:clearAnnotations] no enabled element or no image.');
        return;
      }

      const { toolState } = cornerstoneTools.globalImageIdSpecificToolStateManager;
      if (!toolState || toolState.hasOwnProperty(enabledElement.image.imageId) === false) {

        log.warn('[cornerstone:commandsManager:clearAnnotations] unable to locate tool state for the enabled element. '
          + 'Clear service measurements and return.');
        OHIF.measurements.MeasurementApi.Instance.clearMeasurements();
        return;
      }

      // Aggregate measurements to remove based on tool state
      const imageIdToolState = toolState[enabledElement.image.imageId];
      const measurementsToRemove = [];

      Object.keys(imageIdToolState).forEach((toolType) => {
        const { data } = imageIdToolState[toolType];

        data.forEach((measurementData) => {

          // Unpack measurement data: meta, data, uid, _id
          const { measurementMeta, measurementData: _measurementData, uid, _id } = OHIF.measurements.MeasurementApi._unpackMeasurementData(measurementData);
          const measurementNumber = measurementMeta.measurementNumber || _measurementData.measurementNumber
          
          log.debug('[cornerstone:commands:clearAnnotations] queue measurement for removal', toolType, measurementData);
          
          if (!_id) {
            log.warn('[cornerstone:commands:clearAnnotations] measurement does not have _id attribute, skip', toolType, measurementData);
            return;
          }

          // Add measurement to queue for removal
          measurementsToRemove.push({ toolType, _id, uid, measurementNumber, });
        });
      });

      // Queue measurements for removal
      measurementsToRemove.forEach((measurementData) => {

        // Trigger OHIF measurement handlers
        OHIF.measurements.MeasurementHandlers.onRemoved({ detail: { toolType: measurementData.toolType, measurementData, element, }, });
      });

      // Clear all remaining measurements from the API and update viewports
      OHIF.measurements.MeasurementApi.Instance.clearMeasurements();
      cornerstoneUtils.refreshCornerstoneViewports();
    },

    reloadAnnotations: ({ viewports }) => {
      // Re-load annotations and measurements
      log.info('[cornerstone:command-module:reloadAnnotations] Reload annotations');
      
      // Re-load
      OHIF.measurements.MeasurementApi.Instance.retrieveMeasurements({
        success: () => {

          // Ensure that annotations were correctly removed from the API
          let _count = OHIF.measurements.MeasurementApi.Instance.measurementsCount();
          log.info('[cornerstone:commands:reloadAnnotations] annotation count', _count);
        }
      });
    },

    reloadStudy: ({ viewports }) => {
      // Re-load study, segmentations, and annotations
      log.info('[cornerstone:command-module:reloadStudy] Reload Study');

      // Re-load study
      display.DisplaySetApi.Instance.reloadStudy();
    },

    nextImage: ({ viewports }) => {
      // Progress to the next image in a stack

      const enabledElement = getEnabledElement(viewports.activeViewportIndex);
      scroll(enabledElement, 1);
    },

    previousImage: ({ viewports }) => {
      // Return to the previous image in a stack

      const enabledElement = getEnabledElement(viewports.activeViewportIndex);
      scroll(enabledElement, -1);
    },

    getActiveViewportEnabledElement: ({ viewports }) => {
      return getEnabledElement(viewports.activeViewportIndex);
    },

    showDownloadViewportModal: ({ title, viewports }) => {
      // Show modal dialog for downloading a high resolution capture of an image

      const activeViewportIndex = viewports.activeViewportIndex;
      const { UIModalService } = servicesManager.services;
      if (UIModalService) {
        UIModalService.show({
          content: CornerstoneViewportDownloadForm,
          title,
          contentProps: {
            activeViewportIndex,
            onClose: UIModalService.hide,
          },
        });
      }
    },

    updateTableWithNewMeasurementData(measurementData) {
      // Update the specified measurements with location and description information

      const measurementApi = OHIF.measurements.MeasurementApi.Instance;

      // Unpack measurement data
      const toolType = OHIF.measurements.MeasurementApi._getToolType(measurementData);
      const { _id, uid } = OHIF.measurements.MeasurementApi._unpackMeasurementData(measurementData);
      const { measurementNumber } = measurementData;

      if (!_id && !uid) {
        console.warn('[cornerstone:commands:updateTableWithNewMeasurementData] unable to update measurement, '
          + 'invalid identifiers. uid="'+(uid || '(null)')+'" _id="'+(_id || '(null)')+'"');
        return;
      }
      
      if (measurementApi.tools[toolType]) {
        
        // Update all state annotations which match the measurement number and tooltype        
        const measurements = measurementApi.tools[toolType]
          .filter((m) => {
            const { _id: mId, uid: mUid, measurementData: mData } = OHIF.measurements.MeasurementApi._unpackMeasurementData(m);
            return (_id && mId && mId == _id) || (uid && mUid && mUid == uid);
          })
          .forEach((m) => {

            // Update measurement data
            _.extend(m,  _.omit(_.pickBy(measurementData, v => !_.isNil(v)), 'measurementNumber'));

            // Trigger update via measurement API
            measurementApi.updateMeasurement(toolType, m, {
              annotationData: true, notYetUpdatedAtSource: true,
            });
          });

        measurementApi.syncMeasurementsAndToolData();
      } else {
        console.warn('[cornerstone:commands:updateTableWithNewMeasurementData] unable to update '
          +' description/location for toolType='+toolType, measurementData);
      }

      // Refresh Cornerstone viewport renderings
      cornerstoneUtils.refreshCornerstoneViewports();
    },

    getNearbyToolData({ element, canvasCoordinates, availableToolTypes }) {
      const nearbyTool = {};
      let pointNearTool = false;

      availableToolTypes.forEach((toolType) => {
        const elementToolData = cornerstoneTools.getToolState(element, toolType);

        if (!elementToolData) {
          return;
        }

        elementToolData.data.forEach((toolData, index) => {
          let elementToolInstance = cornerstoneTools.getToolForElement(element, toolType);

          if (!elementToolInstance) {
            elementToolInstance = cornerstoneTools.getToolForElement(element, `${toolType}Tool`);
          }

          if (!elementToolInstance) {
            console.warn('Tool not found.');
            return undefined;
          }

          if (elementToolInstance.pointNearTool(element, toolData, canvasCoordinates)) {
            pointNearTool = true;
            nearbyTool.tool = toolData;
            nearbyTool.index = index;
            nearbyTool.toolType = toolType;
          }
        });

        if (pointNearTool) {
          return false;
        }
      });

      return pointNearTool ? nearbyTool : undefined;
    },

    removeToolState: ({ element, toolType, tool }) => {
      cornerstoneTools.removeToolState(element, toolType, tool);
      cornerstone.updateImage(element);
    },

    setCornerstoneLayout: () => {
      setCornerstoneLayout();
    },

    goOffline: ({ viewports, servers }) => {
      // Queue the open study for offline caching (ohif-viewers#125, FR-9). Distinct command from the
      // 'download' (zip export) and 'Download' (screenshot) features (AR-6).
      const activeServer = sonador.getActiveServer(servers.servers);
      // ACTIVE viewport, not viewport 0 — the More-menu button's label/state derives from the
      // active viewport (LocalCacheToolbarButton), so the command must act on the same study.
      const vsd = viewports.viewportSpecificData?.[viewports.activeViewportIndex] || {};
      const { StudyInstanceUID } = vsd;

      if (!StudyInstanceUID || !activeServer) {
        log.warn('[cornerstone:commands:goOffline] missing StudyInstanceUID or active server.');
        return;
      }

      const job = DownloadManagerService.enqueueStudy({
        server: activeServer,
        StudyInstanceUID,
        descriptor: {
          PatientName: vsd.PatientName,
          PatientID: vsd.PatientID,
          StudyDescription: vsd.StudyDescription,
          AccessionNumber: vsd.AccessionNumber,
          ServiceEpisodeID: vsd.ServiceEpisodeID,
        },
      });

      // One shared queue notice across the study list and the viewer, so the wording and the
      // identifiers match wherever the study was queued from. Completion and failure are announced
      // by the DownloadManagerService subscription (platform/core downloadNotifications).
      notifyStudiesQueued({ queued: [job] });
    },

    removeOffline: async ({ viewports }) => {
      // Remove the open study's locally cached copy. Any in-flight download is cancelled first so the
      // job and the stored data are torn down together (AC-4).
      const { UINotificationService } = servicesManager.services;
      const { StudyInstanceUID } =
        viewports.viewportSpecificData?.[viewports.activeViewportIndex] || {};

      if (!StudyInstanceUID) {
        log.warn('[cornerstone:commands:removeOffline] missing StudyInstanceUID.');
        return;
      }

      DownloadManagerService.cancelStudy(StudyInstanceUID);
      await LocalCacheService.removeStudy(StudyInstanceUID);

      UINotificationService?.show({
        title: 'Offline copy removed',
        message: 'The locally cached copy of this study has been deleted.',
        type: 'info',
        autoClose: true,
      });
    },

    downloadStudyArchive: ({ viewports, servers }) => {
      // Export the open study as a .zip through the tracked archive queue (ohif-viewers#127).
      //
      // The study-list row menu's 'download' action, reachable from the viewer. Distinct from
      // 'CaptureImage' in the same More menu (a single rendered image off the canvas) and from
      // 'goOffline' below (caches instances into THIS BROWSER rather than writing a file out).
      //
      // Goes through ArchiveDownloadService exactly as the study list does, so the job appears in
      // the Downloads menu with progress and cancellation and raises the same queued/completed
      // notifications -- there is deliberately no second export path.
      const activeServer = sonador.getActiveServer(servers.servers);
      const vsd = viewports.viewportSpecificData?.[viewports.activeViewportIndex] || {};
      const { StudyInstanceUID } = vsd;

      if (!StudyInstanceUID || !activeServer) {
        log.warn('[cornerstone:commands:downloadStudyArchive] missing StudyInstanceUID or active server.');
        return;
      }

      // Asked twice for the same study? The service hands back the job already in flight and the
      // notice says so, rather than re-announcing a queue that did not happen.
      const duplicate = !!ArchiveDownloadService.getActiveJobForResource(StudyInstanceUID);

      const job = ArchiveDownloadService.enqueueStudy({
        server: activeServer,
        StudyInstanceUID,
        descriptor: {
          PatientName: vsd.PatientName,
          PatientID: vsd.PatientID,
          StudyDescription: vsd.StudyDescription,
          StudyDate: vsd.StudyDate,
          AccessionNumber: vsd.AccessionNumber,
          ServiceEpisodeID: vsd.ServiceEpisodeID,
        },
      });

      notifyArchivesQueued(duplicate ? { alreadyQueued: 1 } : { queued: [job] });
    },

    cancelStudyDownload: ({ viewports }) => {
      // Cancel an in-flight offline download for the open study (leaves already-cached data, AC-3).
      const { StudyInstanceUID } =
        viewports.viewportSpecificData?.[viewports.activeViewportIndex] || {};
      if (StudyInstanceUID) {
        DownloadManagerService.cancelStudy(StudyInstanceUID);
      }
    },

    setWindowLevel: ({ viewports, window, level }) => {
      const enabledElement = getEnabledElement(viewports.activeViewportIndex);

      if (enabledElement) {
        let viewport = cornerstone.getViewport(enabledElement);

        viewport.voi = {
          windowWidth: Number(window),
          windowCenter: Number(level),
        };
        cornerstone.setViewport(enabledElement, viewport);
      }
    },
    
    jumpToImage: ({ StudyInstanceUID, SOPInstanceUID, frameIndex, activeViewportIndex, refreshViewports = true }) => {
      
      // Jump to a specific study/DICOM instance UID
      const study = studyMetadataManager.get(StudyInstanceUID);
      const displaySet = study?.findDisplaySet((ds) => {
        return ds.images && ds.images.find((i) => i.getSOPInstanceUID() === SOPInstanceUID);
      });

      if (!displaySet) {
        return;
      }

      displaySet.SOPInstanceUID = SOPInstanceUID;
      displaySet.frameIndex = frameIndex;
      window.store.dispatch(setViewportSpecificData(activeViewportIndex, displaySet));

      if (refreshViewports) {
        cornerstoneUtils.refreshCornerstoneViewports();
      }
    },
  };

  const definitions = {
    jumpToImage: {
      commandFn: actions.jumpToImage,
      storeContexts: [],
      options: {},
    },
    getNearbyToolData: {
      commandFn: actions.getNearbyToolData,
      storeContexts: [],
      options: {},
    },
    removeToolState: {
      commandFn: actions.removeToolState,
      storeContexts: [],
      options: {},
    },
    updateTableWithNewMeasurementData: {
      commandFn: actions.updateTableWithNewMeasurementData,
      storeContexts: [],
      options: {},
    },
    showDownloadViewportModal: {
      commandFn: actions.showDownloadViewportModal,
      storeContexts: ['viewports'],
      options: {},
    },
    getActiveViewportEnabledElement: {
      commandFn: actions.getActiveViewportEnabledElement,
      storeContexts: ['viewports'],
      options: {},
    },
    rotateViewportCW: {
      commandFn: actions.rotateViewport,
      storeContexts: ['viewports'],
      options: { rotation: 90 },
    },
    rotateViewportCCW: {
      commandFn: actions.rotateViewport,
      storeContexts: ['viewports'],
      options: { rotation: -90 },
    },
    invertViewport: {
      commandFn: actions.invertViewport,
      storeContexts: ['viewports'],
      options: {},
    },
    flipViewportVertical: {
      commandFn: actions.flipViewportVertical,
      storeContexts: ['viewports'],
      options: {},
    },
    flipViewportHorizontal: {
      commandFn: actions.flipViewportHorizontal,
      storeContexts: ['viewports'],
      options: {},
    },
    scaleUpViewport: {
      commandFn: actions.scaleViewport,
      storeContexts: ['viewports'],
      options: { direction: 1 },
    },
    scaleDownViewport: {
      commandFn: actions.scaleViewport,
      storeContexts: ['viewports'],
      options: { direction: -1 },
    },
    fitViewportToWindow: {
      commandFn: actions.scaleViewport,
      storeContexts: ['viewports'],
      options: { direction: 0 },
    },
    resetViewport: {
      commandFn: actions.resetViewport,
      storeContexts: ['viewports'],
      options: {},
    },
    seriesTagDialog: {
      commandFn: actions.seriesTagDialog,
      storeContexts: ['viewports', 'servers'],
      options: {},
    },
    labellingDialog: {
      commandFn: actions.labellingDialog,
      storeContexts: ['viewports'],
      options: {},
    },
    checkDistortionFilterDialog: {
      commandFn: actions.checkDistortionFilterDialog,
      storeContexts:  ['viewports', 'servers'],
      options: {},
    },
    clearAnnotations: {
      commandFn: actions.clearAnnotations,
      storeContexts: ['viewports'],
      options: {},
    },
    reloadAnnotations: {
      commandFn: actions.reloadAnnotations,
      storeContexts: ['viewports', 'servers'],
      options: {},
    },
    saveMeasurements: {
      commandFn: actions.saveMeasurements,
      storeContexts: ['viewports', 'servers'],
      options: { seriesNumber: 42 },
    },
    reloadStudy: {
      commandFn: actions.reloadStudy,
      storeContexts: ['viewports', 'servers'],
      options: {},
    },
    nextImage: {
      commandFn: actions.nextImage,
      storeContexts: ['viewports'],
      options: {},
    },
    previousImage: {
      commandFn: actions.previousImage,
      storeContexts: ['viewports'],
      options: {},
    },
    
    // TOOLS
    setToolActive: {
      commandFn: actions.setToolActive,
      storeContexts: [],
      options: {},
    },
    setZoomTool: {
      commandFn: actions.setToolActive,
      storeContexts: [],
      options: { toolName: 'Zoom' },
    },
    setCornerstoneLayout: {
      commandFn: actions.setCornerstoneLayout,
      storeContexts: [],
      options: {},
      context: 'VIEWER',
    },
    setWindowLevel: {
      commandFn: actions.setWindowLevel,
      storeContexts: ['viewports'],
      options: {},
    },
    downloadStudyArchive: {
      commandFn: actions.downloadStudyArchive,
      storeContexts: ['viewports', 'servers'],
      options: {},
    },
    goOffline: {
      commandFn: actions.goOffline,
      storeContexts: ['viewports', 'servers'],
      options: {},
    },
    removeOffline: {
      commandFn: actions.removeOffline,
      storeContexts: ['viewports'],
      options: {},
    },
    cancelStudyDownload: {
      commandFn: actions.cancelStudyDownload,
      storeContexts: ['viewports'],
      options: {},
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',
  };
};

export default commandsModule;
