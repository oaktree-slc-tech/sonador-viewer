import LoggerService from './LoggerService';
import DicomMetadataStore from './DicomMetadataStore';
import DisplaySetService from './DisplaySetService';
import MeasurementService from './MeasurementService';
import CustomizationService from './CustomizationService';
import ViewportGridService from './ViewportGridService';
import UIDialogService from './UIDialogService';
import UIModalService from './UIModalService';
import UINotificationService, { uiNotificationService } from './UINotificationService';
import NotificationLogService, {
  notificationLogService,
  NotificationLogServiceEvents,
  NotificationLogSources,
} from './NotificationLogService';

import {
  LocalCacheService,
  LocalCacheServiceEvents,
  DownloadManagerService,
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
  SERIES_TRANSFER_STATES,
  rehydrateStudyFromCache,
  notifyStudiesQueued,
  notifySeriesQueued,
  clearOfflineStorageWithNotice,
  startDownloadNotifications,
  stopDownloadNotifications,
} from './LocalCacheService';

// Archive export ("download this study as a .zip to my computer"). Deliberately separate from the
// offline cache above, which saves a study INTO this browser (ohif-viewers#52, AR-1). The states
// export as ARCHIVE_JOB_STATES rather than shadowing the cache queue's JOB_STATES (AR-4).
import {
  ArchiveDownloadService,
  ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
  notifyArchivesQueued,
  startArchiveNotifications,
  stopArchiveNotifications,
} from './ArchiveDownloadService';

import ServicesManager from './ServicesManager.js';
import pubSubServiceInterface, { PubSubService } from './_shared/pubSubServiceInterface';


export {
  DicomMetadataStore,
  DisplaySetService,
  CustomizationService,
  ViewportGridService,
  UINotificationService,
  uiNotificationService,
  NotificationLogService,
  notificationLogService,
  NotificationLogServiceEvents,
  NotificationLogSources,
  UIModalService,
  UIDialogService,
  ServicesManager,
  MeasurementService,
  LoggerService,
  LocalCacheService,
  LocalCacheServiceEvents,
  DownloadManagerService,
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
  SERIES_TRANSFER_STATES,
  rehydrateStudyFromCache,
  notifyStudiesQueued,
  notifySeriesQueued,
  clearOfflineStorageWithNotice,
  startDownloadNotifications,
  stopDownloadNotifications,
  ArchiveDownloadService,
  ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
  notifyArchivesQueued,
  startArchiveNotifications,
  stopArchiveNotifications,
  pubSubServiceInterface,
  PubSubService,
};
