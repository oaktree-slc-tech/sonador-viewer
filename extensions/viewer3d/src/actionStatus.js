// Status of a long-running action, shown over the view that follows it with the view's loading
// indicator: converting a model series to a segmentation over its M3D viewport (ohif-viewers#143),
// an import over the Segmentation Editor's 3D view. The action is started from a side panel or a
// menu; the view subscribes here under the key it shares with the action (a display set id, the
// editor's working segmentation id).

const _status = new Map();
const _listeners = new Set();

/** Set (or clear, with a falsy message) the status message under a key. */
export function setActionStatus(key, message) {
  if (!key) {
    return;
  }
  if (message) {
    _status.set(key, message);
  } else {
    _status.delete(key);
  }
  _listeners.forEach(listener => {
    try {
      listener(key, message || null);
    } catch (err) {
      console.error('[viewerm3d] status listener failed', err);
    }
  });
}

export function getActionStatus(key) {
  return _status.get(key) || null;
}

/** listener(key, message|null); returns an unsubscribe function */
export function subscribeActionStatus(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
