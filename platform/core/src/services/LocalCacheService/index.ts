import LocalCacheService, { LocalCacheServiceEvents } from './LocalCacheService';
import DownloadManagerService, {
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
  SERIES_TRANSFER_STATES,
  RETRY_ATTEMPTS_DEFAULT,
  RETRY_ATTEMPTS_MIN,
  RETRY_ATTEMPTS_MAX,
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
  RETRY_ATTEMPTS_DEFAULT,
  RETRY_ATTEMPTS_MIN,
  RETRY_ATTEMPTS_MAX,
  rehydrateStudyFromCache,
  notifyStudiesQueued,
  notifySeriesQueued,
  clearOfflineStorageWithNotice,
  startDownloadNotifications,
  stopDownloadNotifications,
};

export default LocalCacheService;
