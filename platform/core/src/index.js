import './lib';

import classes, { CommandsManager, HotkeysManager } from './classes/';

import metadata from './classes/metadata/';
import redux from './redux/';
import studies from './studies/';
import utils, { hotkeys } from './utils/';
import str2ab from './utils/str2ab';
import cornerstone from './cornerstone.js';
import DICOMSR from './DICOMSR';
import DICOMWeb from './DICOMWeb';
import errorHandler from './errorHandler.js';
import { ExtensionManager, MODULE_TYPES } from './extensions';
import hangingProtocols from './hanging-protocols';
import header from './header.js';
import log from './log.js';

import { fileLoader } from './store';
import IWebApiDataSource from './DataSources/IWebApiDataSource';

import measurements from './measurements';

import display from './display';
import { ViewportRefsProvider, useViewportRef } from './hooks/useViewportRef';

import object from './object.js';
import { ServicesManager } from './services';
import {
  PubSubService,
  DicomMetadataStore,
  DisplaySetService,
  CustomizationService,
  LoggerService, 
  MeasurementService, 
  UIDialogService, 
  UIModalService, 
  UINotificationService,
  pubSubServiceInterface,
} from './services';
import string from './string.js';
import ui from './ui';
import user from './user.js';
import {
  sonadorUrl, 
  getAuthToken, 
  getActiveServer, 
  searchImageServerGroups, 
  fetchServerSystemInfo,
  fetchGroupTags
} from './api/sonador.js';
import { getDistortionCheck } from './api/distortionFilter';


// Sonador Utilities
const sonador = {
  sonadorUrl, 
  getAuthToken,
  getActiveServer,
  searchImageServerGroups,
  fetchServerSystemInfo,
  fetchGroupTags,
  distortionFilter: {
    getDistortionCheck,
  }
}


// Input/Output utilities for OHIF
const io = {
  fileLoader,
  IWebApiDataSource,
}


// Define OHIF module
const OHIF = {
  MODULE_TYPES,
  
  // Managers
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  
  // Modules
  utils,
  hotkeys,
  studies,
  redux,
  classes,
  metadata,
  header,
  cornerstone,
  string,
  ui,
  user,
  errorHandler,
  object,
  log,
  DICOMWeb,
  DICOMSR,
  viewer: {},

  display,
  useViewportRef,
  ViewportRefsProvider,
  measurements,
  hangingProtocols,

  // Sonador Extensions to OHIF and Cornerstone
  sonador,
  io,
  IWebApiDataSource,
  
  // Services
  PubSubService,
  DicomMetadataStore,
  UINotificationService,
  UIModalService,
  UIDialogService,
  MeasurementService,
  DisplaySetService,
  CustomizationService,
  LoggerService,
  pubSubServiceInterface,
};


export {
  MODULE_TYPES,
  
  // Managers
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  
  // Modules
  utils,
  hotkeys,
  studies,
  redux,
  classes,
  metadata,
  header,
  cornerstone,
  string,
  ui,
  user,
  errorHandler,
  object,
  log,
  DICOMWeb,
  DICOMSR,

  display,
  useViewportRef,
  ViewportRefsProvider,
  measurements,
  hangingProtocols,
  sonador,
  io,
  IWebApiDataSource,
  
  // Services
  PubSubService,
  DicomMetadataStore,
  UINotificationService,
  UIModalService,
  UIDialogService,
  MeasurementService,
  DisplaySetService,
  CustomizationService,
  LoggerService,
  pubSubServiceInterface,
  str2ab,
};


export { OHIF };
export default OHIF;
