/**
 * UI Notification Service
 *
 * Ported from OHIF v3 (`platform/core/src/services/UINotificationService`) so that the Sonador
 * Viewer has a single notification pathway with the same API and the same look and feel as
 * upstream. The v3 service is class based and adds promise-backed notifications, error
 * deduplication, action buttons, and a customizable renderer over the v2 functional service it
 * replaces.
 *
 * The rendering implementation is supplied by `NotificationProvider` (@ohif/ui-next), which
 * renders through `sonner`. Call `setServiceImplementation` to swap it.
 *
 * Sonador deviations from upstream v3, each of which exists to keep an existing Sonador call site
 * working. They are additive -- v3-shaped calls behave exactly as they do upstream:
 *
 *   1. `autoClose: false` maps to an infinite duration. Upstream v3 accepts the flag but silently
 *      drops it, so every "sticky" error would auto-dismiss. Roughly a dozen Sonador call sites
 *      depend on errors staying up until dismissed.
 *   2. `action.onClick` is invoked with `({ ...notification, close })`, the v2 SnackbarItem
 *      contract. The 2D MPR "Exit 2D MPR" action relies on the injected `close`. Zero-argument v3
 *      style handlers are unaffected.
 *   3. Positions may be given in v2 camelCase (`bottomRight`) or v3 kebab-case (`bottom-right`).
 *   4. `show()` calls made before the provider mounts are queued and flushed on registration,
 *      preserving v2 behaviour. Upstream v3 dropped the queue; Sonador bootstraps notifications
 *      from `sonador.index.js` before React renders, and those would otherwise be lost.
 *   5. The default duration stays at the v2 value of 5000ms rather than v3's 2000ms, which is too
 *      short to read a study/series load failure.
 */

import { notificationLogService, NotificationLogSources } from '../NotificationLogService';

const name = 'UINotificationService';
const altName = 'uiNotificationService';

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';

type NotificationPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center';

/** v2 camelCase positions accepted for backwards compatibility (deviation 3). */
const POSITION_ALIASES = {
  topLeft: 'top-left',
  topRight: 'top-right',
  topCenter: 'top-center',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
  bottomCenter: 'bottom-center',
};

const normalizePosition = (position: string): NotificationPosition =>
  (POSITION_ALIASES[position] || position) as NotificationPosition;

/**
 * Queue of `show()` requests received before a rendering implementation registered (deviation 4).
 * Entries carry the id handed back to the caller so a queued notification can still be hidden.
 */
const serviceShowRequestQueue = [];

let queuedNotificationCount = 0;

const serviceImplementation = {
  _hide: id => {
    // Nothing is rendered yet; drop the matching queued request so it never appears.
    const index = serviceShowRequestQueue.findIndex(request => request.id === id);

    if (index !== -1) {
      serviceShowRequestQueue.splice(index, 1);
    }
  },
  _show: showArguments => {
    const id = showArguments.id || `pending-notification-${++queuedNotificationCount}`;

    serviceShowRequestQueue.push({ ...showArguments, id });

    return id;
  },
  _customComponent: null,
};

class UINotificationService {
  static REGISTRATION = {
    name,
    altName,
    create: (): UINotificationService => uiNotificationService,
  };

  public name = name;

  /**
   * Provides the component used to render notifications, when one has been supplied via
   * `setServiceImplementation({ customComponent })`.
   *
   * @returns {React.Component}
   */
  public getCustomComponent() {
    return serviceImplementation._customComponent;
  }

  /**
   * Registers the rendering implementation backing this service.
   *
   * @param {object} implementation
   * @param {function} implementation.hide
   * @param {function} implementation.show
   * @param {React.Component} implementation.customComponent
   */
  public setServiceImplementation({
    hide: hideImplementation,
    show: showImplementation,
    customComponent: customComponentImplementation,
  }): void {
    if (hideImplementation) {
      serviceImplementation._hide = hideImplementation;
    }
    if (customComponentImplementation) {
      serviceImplementation._customComponent = customComponentImplementation;
    }
    if (showImplementation) {
      serviceImplementation._show = showImplementation;

      // Flush in arrival order. The v2 implementation used `pop()`, which replayed the queue
      // backwards and showed the oldest bootstrap error last.
      while (serviceShowRequestQueue.length > 0) {
        serviceImplementation._show(serviceShowRequestQueue.shift());
      }
    }
  }

  /**
   * Hides/dismisses the notification, if currently shown.
   *
   * @param {string} id - id of the notification to hide/dismiss
   */
  public hide(id: string) {
    return serviceImplementation._hide(id);
  }

  /**
   * Create and show a new UI notification; returns the ID of the created notification. Can also
   * handle promises for loading states.
   *
   * @param {object} notification - The notification object
   * @param {string} notification.title - The title of the notification
   * @param {string | function} notification.message - The message content, or a function returning one
   * @param {number} [notification.duration=5000] - How long to show the notification, in milliseconds
   * @param {string} [notification.position='bottom-right'] - Where to anchor the notification
   * @param {ToastType} [notification.type='info'] - The type of the notification
   * @param {boolean} [notification.autoClose=true] - Whether the notification should auto-close
   * @param {Promise} [notification.promise] - A promise to track for loading, success, and error states
   * @param {object} [notification.promiseMessages] - Custom messages for promise states
   * @param {object} [notification.action] - Action button configuration
   * @param {string} notification.action.label - The label for the action button
   * @param {function} notification.action.onClick - Called with `({ ...notification, close })`
   * @returns {string} id - The ID of the created notification
   */
  public show({
    title,
    message,
    duration = 5000,
    position = 'bottom-right',
    type = 'info',
    autoClose = true,
    promise,
    promiseMessages,
    id,
    allowDuplicates = false,
    deduplicationInterval = 30000,
    action,
    log,
    source = NotificationLogSources.NOTIFICATION,
    studyInstanceUID,
    seriesInstanceUID,
    details,
    error,
  }: {
    title: string;
    message?: string | ((data?: any) => string);
    duration?: number;
    position?: NotificationPosition | string;
    type?: ToastType;
    autoClose?: boolean;
    promise?: Promise<any>;
    promiseMessages?: {
      loading?: string;
      success?: string | ((data: any) => string);
      error?: string | ((error: any) => string);
    };
    id?: string;
    allowDuplicates?: boolean;
    deduplicationInterval?: number;
    action?: {
      label: string;
      onClick: (context?: any) => void;
    };
    log?: boolean;
    source?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
    details?: Record<string, unknown>;
    error?: unknown;
  }): string {
    const resolvedPosition = normalizePosition(position);

    // Many v2 call sites pass only `message`, because the v2 snackbar treated title and message as
    // equally optional. sonner renders the title as the primary line, so a message-only
    // notification would draw an empty heading above its text. Promote it.
    if (!title && message) {
      title = message as string;
      message = undefined;
    }

    // `autoClose: false` means "stay until dismissed" (deviation 1). sonner expresses that as an
    // infinite duration; leaving `duration` alone would let a sticky error disappear on its own.
    const resolvedDuration = autoClose === false ? Infinity : duration;

    // Carried through to `_showResolved`, which is where the write to the unified log happens --
    // for a promise-backed notification the severity worth logging is the SETTLED one, which is
    // not known here.
    const shared = {
      title,
      position: resolvedPosition,
      autoClose,
      allowDuplicates,
      deduplicationInterval,
      log,
      source,
      studyInstanceUID,
      seriesInstanceUID,
      details,
      error,
    };

    if (promise && promiseMessages) {
      const loadingId = serviceImplementation._show({
        ...shared,
        message: promiseMessages.loading || 'Loading...',
        type: 'loading',
        autoClose: false,
        duration: Infinity,
        id: id ? `${id}-loading` : undefined,
      });

      const settle = (
        settledType: ToastType,
        settledMessage: string,
        suffix: string,
        settledError?: unknown
      ) => {
        this._showResolved({
          ...shared,
          message: settledMessage,
          type: settledType,
          duration: resolvedDuration,
          id: id ? `${id}-${suffix}` : undefined,
          action,
          // A rejection is the more useful thing to record than whatever the caller passed up front.
          error: settledError === undefined ? shared.error : settledError,
        });
        this.hide(loadingId);
      };

      promise.then(
        data =>
          settle(
            'success',
            typeof promiseMessages.success === 'function'
              ? promiseMessages.success(data)
              : promiseMessages.success || 'Success',
            'success'
          ),
        reason =>
          settle(
            'error',
            typeof promiseMessages.error === 'function'
              ? promiseMessages.error(reason)
              : promiseMessages.error || 'Error',
            'error',
            reason
          )
      );

      return loadingId;
    }

    return this._showResolved({
      ...shared,
      message,
      duration: resolvedDuration,
      type,
      id,
      action,
    });
  }

  /**
   * Hands a fully resolved notification to the rendering implementation, wrapping any action
   * handler in the v2 calling convention (deviation 2).
   */
  private _showResolved(notification): string {
    const {
      action,
      log,
      source,
      studyInstanceUID,
      seriesInstanceUID,
      details,
      error,
      ...rest
    } = notification;

    // Write through to the unified log (ohif-viewers#84). Warnings and errors are recorded by
    // default because they are what the Issues panel exists to collect; transient confirmations
    // ("Tag created successfully") would only be noise there, so they are recorded only when a
    // caller explicitly opts in with `log: true`.
    const { type, title, message } = rest;
    const shouldLog = log === undefined ? type === 'error' || type === 'warning' : log;

    if (shouldLog) {
      notificationLogService.add({
        title,
        message: typeof message === 'function' ? undefined : message,
        severity: type === 'loading' ? 'info' : type,
        source,
        studyInstanceUID,
        seriesInstanceUID,
        details,
        error,
      });
    }

    let notificationId;

    const wrappedAction =
      action && action.label && typeof action.onClick === 'function'
        ? {
            label: action.label,
            // v2 SnackbarItem called `options.action.onClick({ ...options, close })`. Handlers
            // written against v3 take no arguments and simply ignore this.
            onClick: () =>
              action.onClick({ ...notification, close: () => this.hide(notificationId) }),
          }
        : undefined;

    notificationId = serviceImplementation._show({ ...rest, action: wrappedAction });

    return notificationId;
  }
}

/**
 * Module singleton.
 *
 * Registered with the ServicesManager (under both `UINotificationService` and
 * `uiNotificationService`) and also importable directly from `@ohif/core`, which is how non-React
 * modules such as `lib/preferenceWriteQueue.js` reach it. This mirrors LocalCacheService and
 * DownloadManagerService.
 */
const uiNotificationService = new UINotificationService();

export { UINotificationService, uiNotificationService };

export default {
  name,
  altName,
  create: () => uiNotificationService,
};
