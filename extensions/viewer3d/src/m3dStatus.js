// Status of a long-running action on a model series, shown over its M3D viewport with the viewport's
// loading indicator (e.g. converting the models to a segmentation, ohif-viewers#143). The action is
// started from the side panel; the viewport follows the status here.

const _status = new Map();
const _listeners = new Set();

/** Set (or clear, with a falsy message) the status message of a display set. */
export function setM3DStatus(displaySetInstanceUID, message) {
  if (!displaySetInstanceUID) {
    return;
  }
  if (message) {
    _status.set(displaySetInstanceUID, message);
  } else {
    _status.delete(displaySetInstanceUID);
  }
  _listeners.forEach(listener => {
    try {
      listener(displaySetInstanceUID, message || null);
    } catch (err) {
      console.error('[viewerm3d] status listener failed', err);
    }
  });
}

export function getM3DStatus(displaySetInstanceUID) {
  return _status.get(displaySetInstanceUID) || null;
}

/** listener(displaySetInstanceUID, message|null); returns an unsubscribe function */
export function subscribeM3DStatus(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
