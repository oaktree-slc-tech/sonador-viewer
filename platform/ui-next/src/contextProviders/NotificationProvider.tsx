import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  ReactNode,
  useState,
  useRef,
} from 'react';
import PropTypes from 'prop-types';
import { Toaster, toast } from '../components/Sonner';

/**
 * Notification rendering implementation for `UINotificationService`, ported from OHIF v3
 * (`platform/ui-next/src/contextProviders/NotificationProvider.tsx`).
 *
 * This replaces the OHIF v2 `SnackbarProvider` from `@ohif/ui`. It renders through sonner and
 * registers itself with the service on mount, so every `uiNotificationService.show()` call in the
 * viewer lands here.
 *
 * Deviation from upstream: upstream pushes every notification into a `options` state array and
 * only removes entries in `hide()`. Auto-dismissing toasts never call `hide()`, so the array grows
 * for the lifetime of the session. That array is read only by a custom renderer, so it is
 * maintained here only when one is registered.
 */

const NotificationContext = createContext(null);

export const useNotification = () => useContext(NotificationContext);

interface NotificationCacheEntry {
  timestamp: number;
  id: string;
}

interface NotificationProviderProps {
  children: ReactNode;
  service?: any;
  deduplicationInterval?: number;
}

const DEFAULT_OPTIONS = {
  title: '',
  message: '',
  duration: 5000,
  position: 'bottom-right',
  type: 'info',
  visible: true,
};

const NotificationProvider = ({
  children,
  service,
  deduplicationInterval = 10000,
}: NotificationProviderProps) => {
  const [options, setOptions] = useState([]);

  // Recently shown notifications, keyed by `title_message_type`, used to suppress repeat errors.
  const recentNotificationsRef = useRef<Record<string, NotificationCacheEntry>>({});

  const CustomNotification = service?.getCustomComponent();

  const show = useCallback(
    incomingOptions => {
      const newNotification = {
        ...DEFAULT_OPTIONS,
        ...incomingOptions,
      };

      const {
        title,
        message,
        duration,
        position,
        type,
        promise,
        allowDuplicates = false,
        deduplicationInterval: optionsDeduplicationInterval,
        action,
      } = newNotification;

      const notificationDeduplicationInterval =
        optionsDeduplicationInterval || deduplicationInterval;

      if (promise) {
        return toast.promise(promise, {
          loading: title || 'Loading...',
          success: (data: unknown) => ({
            title: title || 'Success',
            description: typeof message === 'function' ? message(data) : message,
          }),
          error: (err: unknown) => ({
            title: title || 'Error',
            description: typeof message === 'function' ? message(err) : message,
          }),
        });
      }

      const messageStr = typeof message === 'function' ? 'function' : message;
      const cacheKey = `${title}_${messageStr}_${type}`;

      // Errors are the only type deduplicated: repeated load failures from a retrying viewport
      // would otherwise stack up and bury everything else.
      if (!allowDuplicates && type === 'error') {
        const cachedNotification = recentNotificationsRef.current[cacheKey];

        if (cachedNotification) {
          const timeSinceLastShown = Date.now() - cachedNotification.timestamp;

          if (timeSinceLastShown < notificationDeduplicationInterval) {
            return cachedNotification.id;
          }

          // Shown before, but long enough ago to show again. Clear the stale one first.
          toast.dismiss(cachedNotification.id);
        }
      }

      const toastOptions: Record<string, unknown> = {
        duration,
        position,
        description: message,
        id: incomingOptions.id,
      };

      if (action && action.label && typeof action.onClick === 'function') {
        toastOptions.action = {
          label: action.label,
          onClick: action.onClick,
        };
      }

      const toastFn = typeof toast[type] === 'function' ? toast[type] : toast;
      const id = toastFn(title, toastOptions);

      if (type === 'error') {
        recentNotificationsRef.current[cacheKey] = { timestamp: Date.now(), id };
      }

      if (CustomNotification) {
        setOptions(prev => [...prev, { ...newNotification, id }]);
      }

      return id;
    },
    [deduplicationInterval, CustomNotification]
  );

  const hide = useCallback(id => {
    setOptions(state => state.filter(item => item.id !== id));
    toast.dismiss(id);

    for (const [key, entry] of Object.entries(recentNotificationsRef.current)) {
      if (entry.id === id) {
        delete recentNotificationsRef.current[key];
        break;
      }
    }
  }, []);

  const hideAll = useCallback(() => {
    setOptions([]);
    toast.dismiss();
    recentNotificationsRef.current = {};
  }, []);

  /**
   * Registers this provider as the notification service's rendering implementation. Any `show()`
   * calls made before this point are flushed by the service at registration time.
   */
  useEffect(() => {
    if (service) {
      service.setServiceImplementation({ hide, show });
    }
  }, [service, hide, show]);

  return (
    <NotificationContext.Provider value={{ show, hide, hideAll }}>
      {CustomNotification ? (
        <CustomNotification options={options} />
      ) : (
        <Toaster position="bottom-right" />
      )}
      {children}
    </NotificationContext.Provider>
  );
};

NotificationProvider.propTypes = {
  children: PropTypes.node.isRequired,
  service: PropTypes.object,
  deduplicationInterval: PropTypes.number,
};

export const withNotification = Component => {
  return function WrappedComponent(props) {
    const notificationContext = useNotification();
    return (
      <Component
        {...props}
        notificationContext={notificationContext}
      />
    );
  };
};

export default NotificationProvider;
