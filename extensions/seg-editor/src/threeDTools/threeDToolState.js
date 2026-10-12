// State of the Segmentation Editor's 3D tools (ohif-viewers#142, §10): which 3D tool is active,
// what it can act on, and the current selection. The 3D tools act on the Three.js editing canvas
// rather than a Cornerstone3D tool group, so this store takes the tool group's place: the palette
// commands and evaluators write and read it, and the canvas (SegEditorSurfaceView) follows it and
// publishes its target and selection back.

// The 3D selection tools: both build the same triangle selection of the target segment's
// surface, with a lasso (or box) drawn over the view, or a brush painted on the surface
export const THREE_D_TOOLS = {
  Lasso: 'Lasso',
  Paint: 'Paint',
};

/** Whether a 3D tool is one of the selection tools (the selection is kept between them). */
export function is3DSelectionTool(toolName) {
  return toolName === THREE_D_TOOLS.Lasso || toolName === THREE_D_TOOLS.Paint;
}

// Removal depth of the Selection tool's delete (surface units): the segment's voxels within this
// distance of the removed points are removed too
export const REMOVAL_DEPTH = { min: 0, max: 20, step: 0.5, default: 2 };

// Brush radius of the Paint selector (surface units)
export const PAINT_RADIUS = { min: 0.5, max: 50, step: 0.5, default: 5 };

// Smooth: the Laplacian step per pass, and the number of passes (ohif-viewers#148, FR-8)
export const SMOOTH_STRENGTH = { min: 0.1, max: 0.9, step: 0.025, default: 0.5 };
export const SMOOTH_PASSES = { min: 1, max: 10, step: 1, default: 3 };

// The lasso's shape: drawn freehand, or a box dragged out
export const LASSO_SHAPES = {
  lasso: 'lasso',
  box: 'box',
};

// What a paint stroke does: selects faces, or erases them from the selection
export const PAINT_MODES = {
  paint: 'paint',
  erase: 'erase',
};

// The action card shown under the tool: one at a time
export const SELECTION_ACTIONS = {
  remove: 'remove',
  smooth: 'smooth',
  repair: 'repair',
};

// Selection tool settings kept across editor sessions, with their allowed values
export const EDIT_SETTINGS = {
  removalDepth: { default: REMOVAL_DEPTH.default },
  // The lasso: freehand or a box (LASSO_SHAPES)
  lassoShape: { default: LASSO_SHAPES.lasso, values: Object.values(LASSO_SHAPES) },
  // The brush: paint or erase (PAINT_MODES), and its radius
  paintMode: { default: PAINT_MODES.paint, values: Object.values(PAINT_MODES) },
  paintRadius: { default: PAINT_RADIUS.default, min: PAINT_RADIUS.min, max: PAINT_RADIUS.max },
  // The action card shown under the tool (SELECTION_ACTIONS); an edit started elsewhere (Delete,
  // a shortcut) switches it to its own
  action: { default: SELECTION_ACTIONS.remove, values: Object.values(SELECTION_ACTIONS) },
  // Smooth of the selection: strength and passes of the Taubin pass, and whether the boundary
  // ring moves at half weight (feather) or stays pinned
  smoothStrength: { default: SMOOTH_STRENGTH.default, min: SMOOTH_STRENGTH.min, max: SMOOTH_STRENGTH.max },
  smoothPasses: { default: SMOOTH_PASSES.default, min: SMOOTH_PASSES.min, max: SMOOTH_PASSES.max, integer: true },
  smoothFeather: { default: true, boolean: true },
  // How a hole is closed: auto (flat for small holes, smooth for larger ones), smooth, flat
  closure: { default: 'auto', values: ['auto', 'smooth', 'flat'] },
  // Rim cleanup after the cut: ears and islands removed (off, light, full)
  rimCleanup: { default: 'full', values: ['off', 'light', 'full'] },
  // A lasso keeps only the largest connected part of what it selects
  connectedOnly: { default: false, boolean: true },
  // An edit is shown for Apply / Cancel before it is recorded
  previewEnabled: { default: true, boolean: true },
  // Open and non-manifold edges drawn on the canvas
  showIssues: { default: false, boolean: true },
  // Vertices closer than this (mm) are one vertex
  weldTolerance: { default: 0.001, min: 0, max: 1 },
  // Largest edge-connected piece removed as an island after a cut (triangles)
  islandMaxTriangles: { default: 50, min: 0, max: 10000 },
  // Most boundary vertices a smooth patch is fitted to
  maxConstraints: { default: 12, min: 4, max: 32 },
};

const INITIAL_STATE = {
  // The active 3D tool (THREE_D_TOOLS), or null
  activeTool: null,
  // The segment the tools act on, published by the canvas: { segmentIndex, label, color } when
  // it can be edited, else { segmentIndex, disabledReason }
  target: null,
  // Selected faces of the target segment's surface, the points they have, and the connected
  // regions they form
  selectionCount: 0,
  selectionPoints: 0,
  selectionRegions: 0,
  // An edit is being computed for the surface (cut, patch, smooth)
  busy: false,
  // Labelmap writes queued behind surface edits
  pendingWrites: 0,
  // An edit shown on the canvas awaiting Apply / Cancel: its summary ({ kind, points, holes,
  // methods, closed, openEdges, repair }), or null
  preview: null,
  // Open and non-manifold edge counts of the target segment's surface, or null while unknown
  surfaceHealth: null,
  // Summary of the last edit applied in this session, or null
  lastEdit: null,
  // Selection tool settings (EDIT_SETTINGS; kept across editor sessions, like the brush radius)
  ...Object.fromEntries(Object.entries(EDIT_SETTINGS).map(([key, setting]) => [key, setting.default])),
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

export function set3DSelectionCount(selectionCount, {
  points = 0, regions = selectionCount ? 1 : 0,
} = {}) {
  _set({ selectionCount, selectionPoints: points, selectionRegions: regions });
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

/** Count a queued labelmap write in (+1) or out (-1). */
export function adjustPendingWrites(delta) {
  _set({ pendingWrites: Math.max(0, _state.pendingWrites + delta) });
}

export function setRemovalDepth(depth) {
  const value = Number(depth);
  if (Number.isFinite(value)) {
    _set({ removalDepth: Math.min(REMOVAL_DEPTH.max, Math.max(REMOVAL_DEPTH.min, value)) });
  }
}

/** The target segment can be edited (nothing is running and no edit awaits Apply / Cancel). */
export function is3DTargetEditable(state = _state) {
  return !!state.target && !state.target.disabledReason && !state.busy && !state.preview;
}

/**
 * Set a Selection tool setting (EDIT_SETTINGS): enumerations must hold the value, numbers are
 * clamped, booleans coerced. Unknown settings are ignored.
 */
export function set3DToolOption(key, value) {
  const setting = EDIT_SETTINGS[key];
  if (!setting) {
    return false;
  }
  if (key === 'removalDepth') {
    setRemovalDepth(value);
    return true;
  }
  if (setting.values) {
    if (!setting.values.includes(value)) {
      return false;
    }
    _set({ [key]: value });
  } else if (setting.boolean) {
    _set({ [key]: !!value });
  } else {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return false;
    }
    const clamped = Math.min(setting.max, Math.max(setting.min, number));
    _set({ [key]: setting.integer ? Math.round(clamped) : clamped });
  }
  return true;
}

/** The current Smooth options (smoothSelection's SMOOTH_OPTION_DEFAULTS keys). */
export function get3DSmoothOptions(state = _state) {
  const { smoothStrength, smoothPasses, smoothFeather } = state;
  return { strength: smoothStrength, passes: smoothPasses, feather: smoothFeather };
}

/** The current cut-and-patch options (deleteSelection's EDIT_OPTION_DEFAULTS keys). */
export function get3DEditOptions(state = _state) {
  const { closure, rimCleanup, weldTolerance, islandMaxTriangles, maxConstraints } = state;
  return { closure, rimCleanup, weldTolerance, islandMaxTriangles, maxConstraints };
}

/** An edit awaiting Apply / Cancel (its summary), or null once decided. */
export function set3DPreview(preview) {
  _set({ preview: preview || null });
}

export function set3DSurfaceHealth(surfaceHealth) {
  _set({ surfaceHealth: surfaceHealth || null });
}

export function set3DLastEdit(lastEdit) {
  _set({ lastEdit: lastEdit || null });
}

/**
 * The canvas registers a handler for a request; returns an unregister function.
 * Requests: 'deleteSelection', 'smoothSelection', 'clearSelection', 'growSelection',
 * 'shrinkSelection', 'applyPreview', 'cancelPreview', 'repairSurface'.
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
  const kept = settings
    ? {}
    : Object.fromEntries(Object.keys(EDIT_SETTINGS).map(key => [key, _state[key]]));
  _state = { ...INITIAL_STATE, ...kept };
  _busyOwner = null;
  _requestHandlers.clear();
  _notify();
}
