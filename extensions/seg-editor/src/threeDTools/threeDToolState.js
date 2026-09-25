// State of the Segmentation Editor's 3D tools (ohif-viewers#142, §10): which 3D tool is active,
// what it can act on, and the current selection. The 3D tools act on the Three.js editing canvas
// rather than a Cornerstone3D tool group, so this store takes the tool group's place: the palette
// commands and evaluators write and read it, and the canvas (SegEditorSurfaceView) follows it and
// publishes its target and selection back.

export const THREE_D_TOOLS = {
  Selection: 'Selection',
};

// Removal depth of the Selection tool's delete (mm): the segment's voxels within this distance of
// the removed points are removed too
export const REMOVAL_DEPTH = { min: 0, max: 20, step: 0.5, default: 2 };

const INITIAL_STATE = {
  // The active 3D tool (THREE_D_TOOLS), or null
  activeTool: null,
  // The segment the tools act on, published by the canvas: { segmentIndex, label } when it can
  // be edited, else { segmentIndex, disabledReason }
  target: null,
  // Selected surface points of the target segment
  selectionCount: 0,
  // A delete is running
  busy: false,
  // Selection tool delete setting (kept across editor sessions, like the brush radius)
  removalDepth: REMOVAL_DEPTH.default,
};

let _state = { ...INITIAL_STATE };
// The job that owns `busy` (begin3DToolJob), so a stale job cannot clear a newer one's flag
let _busyOwner = null;
let _jobCounter = 0;
const _listeners = new Set();
// Requests from the palette to the canvas (delete the selection, clear it)
const _requestHandlers = new Map();

function _notify() {
  _listeners.forEach(listener => {
    try {
      listener(_state);
    } catch (err) {
      console.error('[segEditor3DTools] listener failed', err);
    }
  });
}

function _set(changes) {
  const next = { ..._state, ...changes };
  if (Object.keys(changes).every(key => Object.is(next[key], _state[key]))) {
    return;
  }
  _state = next;
  _notify();
}

export function get3DToolState() {
  return _state;
}

export function subscribe3DToolState(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Activate a 3D tool, or deactivate all with null. */
export function setActive3DTool(toolName) {
  _set({ activeTool: toolName || null });
}

export function set3DToolTarget(target) {
  _set({ target: target || null });
}

export function set3DSelectionCount(selectionCount) {
  _set({ selectionCount });
}

export function set3DToolBusy(busy) {
  _busyOwner = null;
  _set({ busy: !!busy });
}

/** Mark a long-running 3D tool job as started; returns its token for end3DToolJob. */
export function begin3DToolJob() {
  _jobCounter += 1;
  _busyOwner = _jobCounter;
  _set({ busy: true });
  return _busyOwner;
}

/** End a job. Only the job that currently owns `busy` clears it. */
export function end3DToolJob(token) {
  if (token !== undefined && token === _busyOwner) {
    _busyOwner = null;
    _set({ busy: false });
  }
}

export function setRemovalDepth(depth) {
  const value = Number(depth);
  if (Number.isFinite(value)) {
    _set({ removalDepth: Math.min(REMOVAL_DEPTH.max, Math.max(REMOVAL_DEPTH.min, value)) });
  }
}

/** The target segment can be edited (and nothing is running). */
export function is3DTargetEditable(state = _state) {
  return !!state.target && !state.target.disabledReason && !state.busy;
}

/**
 * The canvas registers a handler for a request; returns an unregister function.
 * Requests: 'deleteSelection', 'clearSelection'.
 */
export function handle3DToolRequest(request, handler) {
  _requestHandlers.set(request, handler);
  return () => {
    if (_requestHandlers.get(request) === handler) {
      _requestHandlers.delete(request);
    }
  };
}

/** Ask the canvas to act; returns the handler's result, or undefined when none is registered. */
export function request3DToolAction(request, options) {
  return _requestHandlers.get(request)?.(options);
}

/** Back to the initial state (editor closed; tests). Settings are kept unless `settings` is set. */
export function reset3DToolState({ settings = false } = {}) {
  _state = { ...INITIAL_STATE, ...(settings ? {} : { removalDepth: _state.removalDepth }) };
  _busyOwner = null;
  _requestHandlers.clear();
  _notify();
}
