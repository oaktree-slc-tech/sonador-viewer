// Initialize OHIF v2, OHIF v3, and Cornerstone 3D state services including volume loader,
// Cornerstone 3D metadata management, and Cornerstone 3D image/volume loaders.

import _ from 'lodash';

import {
  metaData as c3dCoreMetaData,
  volumeLoader as c3dVolumeLoader,
  eventTarget as c3dCoreEventTarget,
  EVENTS as c3dCoreEvents,
  utilities as c3dCoreUtils,
} from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader as c3dStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader as c3dStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import { decimatedVolumeLoader as c3dDecimatedVolumeLoader } from '@cornerstonejs/core';

import OHIF from '@ohif/core';
const { DicomMetadataStore } = OHIF;
const { Cornerstone3dMetadataProvider } = OHIF.classes;
const { display } = OHIF;


function initMetaDataStore({ servicesManager }) {
  // Initialize metadata store and loader plugins

  console.log('[cornerstone:data:initialize-integrations] Initialize metadata store integrations');
  const metadataProvider = Cornerstone3dMetadataProvider;

  // Register Cornerstone 3D Volume Loaders
  c3dVolumeLoader.registerVolumeLoader('cornerstoneStreamingImageVolume', c3dStreamingImageVolumeLoader);
  c3dVolumeLoader.registerVolumeLoader('cornerstoneStreamingDynamicImageVolume', c3dStreamingDynamicImageVolumeLoader);

  // Reduced-resolution navigation volumes. The volume loader is selected
  // by the scheme of the volumeId, so the decimated loader needs a scheme of its own; the viewer
  // builds these ids through `getVolumeIdForDisplaySet(displaySet, { decimated: true })`.
  c3dVolumeLoader.registerVolumeLoader('cornerstoneDecimatedImageVolume', c3dDecimatedVolumeLoader);
  
  // Enable Cornerstone 3D calibration tool integration
  c3dCoreMetaData.addProvider(
    c3dCoreUtils.calibratedPixelSpacingMetadataProvider.get.bind(c3dCoreUtils.calibratedPixelSpacingMetadataProvider));

  // Integrate OHIF Cornerstone 3 Metadata provider with Cornerstone metadata store
  c3dCoreMetaData.addProvider(metadataProvider.get.bind(metadataProvider), 9999);
}


function initDisplaySetService({ servicesManager, commandsManager }) {
  // Initialize displaySetService
  const { displaySetService } = servicesManager.services;

  displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SET_DATASYNC, ({ apiEvent, ...apiData }) => {
    console.log('[cornerstone:displaySet:datasync-event] apiEvent='+apiEvent, apiData);
  });
}


function initDataServiceIntegration({ servicesManager, commandsManager }) {
  // Initialize data service integration and callbacks: configure OHIF v3 metadata service 

  initMetaDataStore({ servicesManager });
  initDisplaySetService({ servicesManager, commandsManager });
}


export { initDataServiceIntegration };