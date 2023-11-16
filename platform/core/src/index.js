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
import measurements from './measurements';
import object from './object.js';
import { ServicesManager } from './services';
import { LoggerService, MeasurementService, UIDialogService, UIModalService, UINotificationService } from './services';
import string from './string.js';
import ui from './ui';
import user from './user.js';

const OHIF = {
  MODULE_TYPES,
  //
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  //
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
  measurements,
  hangingProtocols,
  //
  UINotificationService,
  UIModalService,
  UIDialogService,
  MeasurementService,
  LoggerService,
};

export {
  MODULE_TYPES,
  //
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  //
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
  measurements,
  hangingProtocols,
  //
  UINotificationService,
  UIModalService,
  UIDialogService,
  MeasurementService,
  LoggerService,
  str2ab,
};

export { OHIF };

export default OHIF;
