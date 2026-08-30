import LocalCacheService, { LocalCacheServiceEvents } from './LocalCacheService';
import DownloadManagerService, {
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
  SERIES_TRANSFER_STATES,
} from './DownloadManagerService';
import rehydrateStudyFromCache from './rehydrateStudyFromCache';
import {
  notifyStudiesQueued,
  notifySeriesQueued,
  clearOfflineStorageWithNotice,
  startDownloadNotifications,
  stopDownloadNotifications,
} from './downloadNotifications';

export {
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
};

export default LocalCacheService;
