/**
 * Logger Service
 *
 * Application logging. Every call is recorded in the NotificationLogService so that application
 * logs appear alongside user notifications and series warnings in the unified Issues list
 * (ohif-viewers#84).
 *
 * Logging and notifying stay separate concerns: a log call does NOT raise a toast unless the
 * caller asks for one with `notify: true`. That flag was the intent behind the old `LogManager`
 * `OnLog` event, which `SnackbarProvider` subscribed to but which nothing ever published, so it
 * never did anything. It is implemented here instead.
 */

import { notificationLogService, NotificationLogSources } from '../NotificationLogService';
import { uiNotificationService } from '../UINotificationService';

const name = 'LoggerService';

const publicAPI = {
  name,
  info: _info,
  error: _error,
  setServiceImplementation,
};

const serviceImplementation = {
  _info: () => console.warn('info() NOT IMPLEMENTED'),
  _error: () => console.warn('error() NOT IMPLEMENTED'),
};

/**
 * Records an entry in the unified log and, when asked, surfaces it to the user as well.
 */
function _record({
  severity,
  title,
  message,
  notify,
  studyInstanceUID,
  seriesInstanceUID,
  details,
  error,
}) {
  const entry = {
    title: title || message,
    message: title ? message : undefined,
    source: NotificationLogSources.LOGGER,
    studyInstanceUID,
    seriesInstanceUID,
    details,
    error,
  };

  if (notify) {
    // The notification service writes its own log entry, so going through it avoids recording
    // the same condition twice.
    uiNotificationService.show({
      ...entry,
      type: severity,
      autoClose: severity !== 'error',
      log: true,
    });
    return;
  }

  notificationLogService.add({ ...entry, severity });
}

/**
 * Logs an info
 *
 * @param {object} props { message, title, displayOnConsole, notify, studyInstanceUID, seriesInstanceUID, details }
 */
function _info({
  message,
  title,
  displayOnConsole,
  notify,
  studyInstanceUID,
  seriesInstanceUID,
  details,
} = {}) {
  _record({ severity: 'info', title, message, notify, studyInstanceUID, seriesInstanceUID, details });

  return serviceImplementation._info({
    message,
    displayOnConsole,
  });
}

/**
 * Logs an error
 *
 * @param {object} props { error, stack, message, title, displayOnConsole, notify, studyInstanceUID, seriesInstanceUID, details }
 * @returns void
 */
function _error({
  error,
  stack,
  message,
  title,
  displayOnConsole,
  notify,
  studyInstanceUID,
  seriesInstanceUID,
  details,
} = {}) {
  _record({
    severity: 'error',
    title,
    message: message || (error && error.message),
    notify,
    studyInstanceUID,
    seriesInstanceUID,
    details,
    error,
  });

  return serviceImplementation._error({
    error,
    stack,
    message,
    displayOnConsole,
  });
}

/**
 *
 *
 * @param {*} {
 *   info: infoImplementation,
 *   error: errorImplementation,
 * }
 */
function setServiceImplementation({ info: infoImplementation, error: errorImplementation }) {
  if (infoImplementation) {
    serviceImplementation._info = infoImplementation;
  }
  if (errorImplementation) {
    serviceImplementation._error = errorImplementation;
  }
}

export default {
  name,
  create: ({ configuration = {} }) => {
    return publicAPI;
  },
};
