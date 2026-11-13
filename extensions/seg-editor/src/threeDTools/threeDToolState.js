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

// Brush radius of the Paint selector (surface units: mm on a calibrated series). Faces are picked
// in a small neighbourhood; a wider brush is a lasso's job, so the radius stops at 5 and steps finely
export const PAINT_RADIUS = { min: 0.1, max: 5, step: 0.1, default: 1 };

// On a grid whose calibration is unknown (utils/segEditorUnits: no patient-plane spacing), Depth
// and Brush size are set in voxel units instead: whole steps of the grid's smallest spacing
// (ohif-viewers#151 FR-3). Each length keeps a value per basis, so a number set in millimetres on
// one series is never reread as grid steps on another, and the other way round. The world value
// the canvas and workers use is derived from the basis in force (`lengths` in the state).
export const LENGTH_BASIS = {
  // Patient coordinates: millimetres on a calibrated grid
  world: 'world',
  // Whole steps of the grid's smallest spacing
  voxels: 'voxels',
};
export const REMOVAL_DEPTH_VOXELS = { min: 0, max: 40, step: 1, default: 2 };
export const PAINT_RADIUS_VOXELS = { min: 1, max: 10, step: 1, default: 2 };

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

// The action card shown under the selection tool: one at a time. Repair acts on the whole
// surface and lives in the palette's "⋯" menu and Repair surface dialog, not here.
export const SELECTION_ACTIONS = {
  remove: 'remove',
  smooth: 'smooth',
};

// The developer-only weld, as a fraction of the target surface's first-percentile edge length
// (ohif-viewers#149 FR-1, #151 FR-4): exact by default, never above a tenth of p1. The world
// value is derived from the current surface's statistics when an edit runs (effectiveWeldTolerance).
export const WELD_FRACTION = { min: 0, max: 0.1, step: 0.005, default: 0 };

// Most boundary vertices a smooth patch is fitted to: at most eight, and two attempts per hole
// (ohif-viewers#149, FR-7)
export const MAX_CONSTRAINTS = { min: 4, max: 8, step: 1, default: 8 };

// Selection tool settings kept across editor sessions, with their allowed values
export const EDIT_SETTINGS = {
  // The removal depth in world units (LENGTH_BASIS.world), and in voxel units for an uncalibrated
  // grid (LENGTH_BASIS.voxels); `lengths.removalDepth` says which is in force
  removalDepth: { default: REMOVAL_DEPTH.default, min: REMOVAL_DEPTH.min, max: REMOVAL_DEPTH.max },
  removalDepthVoxels: { default: REMOVAL_DEPTH_VOXELS.default, min: REMOVAL_DEPTH_VOXELS.min, max: REMOVAL_DEPTH_VOXELS.max, integer: true },
  // The lasso: freehand or a box (LASSO_SHAPES)
  lassoShape: { default: LASSO_SHAPES.lasso, values: Object.values(LASSO_SHAPES) },
  // The brush: paint or erase (PAINT_MODES), and its radius per basis, as the depth
  paintMode: { default: PAINT_MODES.paint, values: Object.values(PAINT_MODES) },
  paintRadius: { default: PAINT_RADIUS.default, min: PAINT_RADIUS.min, max: PAINT_RADIUS.max },
  paintRadiusVoxels: { default: PAINT_RADIUS_VOXELS.default, min: PAINT_RADIUS_VOXELS.min, max: PAINT_RADIUS_VOXELS.max, integer: true },
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
  // The target segment's surface drawn with every edge and vertex in black, as Blender's edit
  // mode draws the active object (the other segments keep their presentation look)
  showMesh: { default: true, boolean: true },
  // Vertices closer than this fraction of the surface's p1 edge length are one vertex
  // (developer tools only; the world value is derived per surface version)
  weldFraction: { default: WELD_FRACTION.default, min: WELD_FRACTION.min, max: WELD_FRACTION.max },
  // Largest edge-connected piece removed as an island after a cut (triangles)
  islandMaxTriangles: { default: 50, min: 0, max: 10000 },
  // Most boundary vertices a smooth patch is fitted to
  maxConstraints: { default: MAX_CONSTRAINTS.default, min: MAX_CONSTRAINTS.min, max: MAX_CONSTRAINTS.max, integer: true },
};

/**
 * A setting's value made valid: enumerations must hold it, numbers are clamped (integers
 * rounded), booleans coerced. Undefined when the value cannot be made valid.
 */
function _coerceSetting(setting, value) {
  if (setting.values) {
    return setting.values.includes(value) ? value : undefined;
  }
  if (setting.boolean) {
    return !!value;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  const clamped = Math.min(setting.max, Math.max(setting.min, number));
  return setting.integer ? Math.round(clamped) : clamped;
}

// The length settings and their setting key and range per basis
export const LENGTH_SETTINGS = {
  removalDepth: {
    [LENGTH_BASIS.world]: { key: 'removalDepth', range: REMOVAL_DEPTH },
    [LENGTH_BASIS.voxels]: { key: 'removalDepthVoxels', range: REMOVAL_DEPTH_VOXELS },
  },
  paintRadius: {
    [LENGTH_BASIS.world]: { key: 'paintRadius', range: PAINT_RADIUS },
    [LENGTH_BASIS.voxels]: { key: 'paintRadiusVoxels', range: PAINT_RADIUS_VOXELS },
  },
};
const LENGTH_KEYS = new Set(['units', ...Object.values(LENGTH_SETTINGS).flatMap(bases => Object.values(bases).map(b => b.key))]);

/** The voxel unit of a units record: the grid's smallest step, or null without a usable spacing. */
export function voxelUnitOf(units) {
  const spacing = units?.spacing;
  if (!Array.isArray(spacing) || spacing.length !== 3) {
    return null;
  }
  const steps = spacing.map(Number);
  return steps.every(step => Number.isFinite(step) && step > 0) ? Math.min(...steps) : null;
}

/**
 * The basis the length settings are set in for a units record (utils/segEditorUnits): voxel units
 * on a grid whose calibration is unknown and whose steps are known, world units otherwise. A grid
 * without a usable spacing (no target yet, a volume still loading) stays in world units rather
 * than in a voxel unit nobody can define: the conversion is refused, not invented
 * (ohif-viewers#151 FR-3).
 */
export function lengthBasisFor(units) {
  return units?.calibration === 'unknown' && voxelUnitOf(units) !== null ? LENGTH_BASIS.voxels : LENGTH_BASIS.world;
}

/**
 * The length settings resolved for a state: for each, the basis in force, the setting key and
 * range the panel edits, the user's value in that basis, the world value the canvas and workers
 * use, the same length in voxel units for the secondary readout (null without a usable spacing),
 * the voxel unit and the grid's steps.
 */
function _deriveLengths(state) {
  const basis = lengthBasisFor(state.units);
  const reference = voxelUnitOf(state.units);
  const spacing = state.units?.spacing || null;
  const resolve = name => {
    const { key, range } = LENGTH_SETTINGS[name][basis];
    const value = state[key];
    const world = basis === LENGTH_BASIS.voxels ? value * reference : value;
    const voxels = reference ? (basis === LENGTH_BASIS.voxels ? value : value / reference) : null;
    return { basis, settingKey: key, range, value, world, voxels, reference, spacing };
  };
  return Object.fromEntries(Object.keys(LENGTH_SETTINGS).map(name => [name, resolve(name)]));
}

const INITIAL_STATE = {
  // The active 3D tool (THREE_D_TOOLS), or null
  activeTool: null,
  // The segment the tools act on, published by the canvas: { segmentIndex, label, color } when
  // it can be edited, else { segmentIndex, disabledReason }
  target: null,
  // The units of the target's grid (utils/segEditorUnits: calibration, its source or the reason it
  // is unknown, the plane and detector spacings, and the grid's own steps), published with the
  // target; null while no target. Length settings with a relative basis resolve against it
  // (ohif-viewers#151)
  units: null,
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
  // The target segment's surface health, or null while unknown: open, non-manifold and
  // inconsistent edge counts, `closed`, pre-existing degenerate and duplicate triangles, the
  // triangle count, the edge-length statistics ({ p1, p50, mean, edgeCount, sampleSize, sampled })
  // and the effective weld
  surfaceHealth: null,
  // Summary of the last edit applied in this session, or null
  lastEdit: null,
  // Applied edits of the target's surface the 2D views have not received (surface-only results
  // and refused or failed writes still in force, not covered by a synchronization): the 3D
  // surface is ahead of the labelmap while this is above zero, and further edits stay
  // surface-only until it is synchronized (ohif-viewers#152: Synchronize, or the handoff)
  unsynchronizedEdits: 0,
  // How many of those are writes that were refused or failed (as opposed to never asked for)
  failedWrites: 0,
  // A handoff is being resolved (ohif-viewers#152): the dialog is open or its write is awaited,
  // and no edit, undo or redo may run meanwhile
  handoff: false,
  // The Repair surface card is open in the palette (opened from the Model Actions menu, the
  // surface status line, or a repair preview starting; closed by its own control, a target
  // change, or leaving the 3D palette)
  repairPanel: false,
  // Selection tool settings (EDIT_SETTINGS; kept across editor sessions, like the brush radius)
  ...Object.fromEntries(Object.entries(EDIT_SETTINGS).map(([key, setting]) => [key, setting.default])),
};
// The length settings resolved against the units (_deriveLengths): { removalDepth, paintRadius },
// each { basis, settingKey, range, value, world, voxels, reference, spacing, unresolved }. The
// canvas and workers read `world`; the panel edits `settingKey` over `range`.
INITIAL_STATE.lengths = _deriveLengths(INITIAL_STATE);

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
  const keys = Object.keys(changes);
  if (keys.every(key => Object.is(next[key], _state[key]))) {
    return;
  }
  if (keys.some(key => LENGTH_KEYS.has(key))) {
    next.lengths = _deriveLengths(next);
  }
  _state = next;
  _notify();
}

/** A length setting resolved for the current state (see `lengths`): 'removalDepth' or 'paintRadius'. */
export function get3DLength(name, state = _state) {
  return state.lengths[name];
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

/** The units record of the target's grid (utils/segEditorUnits), or null. */
export function set3DToolUnits(units) {
  if (_state.units !== (units || null)) {
    _set({ units: units || null });
  }
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
  const valid = _coerceSetting(setting, value);
  if (valid === undefined) {
    return false;
  }
  _set({ [key]: valid });
  return true;
}

/** The current Smooth options (smoothSelection's SMOOTH_OPTION_DEFAULTS keys). */
export function get3DSmoothOptions(state = _state) {
  const { smoothStrength, smoothPasses, smoothFeather } = state;
  return { strength: smoothStrength, passes: smoothPasses, feather: smoothFeather };
}

/**
 * The world weld tolerance an edit runs with (ohif-viewers#149 FR-1, #151 FR-4): the stored
 * fraction of the target surface's first-percentile edge length, from the current surface
 * health. Without the developer tools, or without finite positive statistics, the weld is exact.
 *
 * @param {number} weldFraction - the stored setting
 * @param {{ edges?: { p1?: number } }|null} surfaceHealth
 * @param {{ developerTools?: boolean }} [options]
 * @returns {number} world units
 */
export function effectiveWeldTolerance(weldFraction, surfaceHealth, { developerTools = false } = {}) {
  const fraction = _coerceSetting(EDIT_SETTINGS.weldFraction, weldFraction);
  const p1 = surfaceHealth?.edges?.p1;
  if (!developerTools || !fraction || !Number.isFinite(p1) || !(p1 > 0)) {
    return 0;
  }
  return fraction * p1;
}

/**
 * The current cut-and-patch options (deleteSelection's EDIT_OPTION_DEFAULTS keys), with the weld
 * resolved to world units against the surface health.
 *
 * @param {Object} [state]
 * @param {Object} [options]
 * @param {Object|null} [options.surfaceHealth] - defaults to the state's
 * @param {boolean} [options.developerTools] - the developer tools flag (segEditorDeveloper)
 */
export function get3DEditOptions(state = _state, { surfaceHealth = state.surfaceHealth, developerTools = false } = {}) {
  const { closure, rimCleanup, weldFraction, islandMaxTriangles, maxConstraints } = state;
  return {
    closure,
    rimCleanup,
    weldTolerance: effectiveWeldTolerance(weldFraction, surfaceHealth, { developerTools }),
    islandMaxTriangles,
    maxConstraints,
  };
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

/** A handoff started (true) or ended (false). */
export function set3DHandoff(active) {
  _set({ handoff: !!active });
}

/** Open or close the Repair surface card in the palette. */
export function set3DRepairPanel(open) {
  _set({ repairPanel: !!open });
}

/**
 * How many applied edits of the target's surface the 2D views have not received, and how many of
 * them are refused or failed writes.
 */
export function set3DUnsynchronizedEdits(count, failed = 0) {
  const whole = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const next = whole(count);
  const nextFailed = Math.min(next, whole(failed));
  if (next !== _state.unsynchronizedEdits || nextFailed !== _state.failedWrites) {
    _set({ unsynchronizedEdits: next, failedWrites: nextFailed });
  }
}

/**
 * The canvas registers a handler for a request; returns an unregister function.
 * Requests: 'deleteSelection', 'smoothSelection', 'clearSelection', 'growSelection',
 * 'shrinkSelection', 'applyPreview', 'cancelPreview', 'repairSurface', 'synchronizeSurface',
 * 'resolveHandoff' (ohif-viewers#152: resolves to whether the destination may take over),
 * 'surfaceRedoAllowed' (whether a replay that restores a surface without its voxels is coherent
 * on the canvas now).
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

/**
 * Back to the initial state (editor closed; tests). Settings are kept unless `settings` is set;
 * a kept value is made valid again on the way (a value stored by an earlier version of the
 * ranges, such as a constraint cap of 32, comes back clamped).
 */
export function reset3DToolState({ settings = false } = {}) {
  const kept = {};
  if (!settings) {
    Object.entries(EDIT_SETTINGS).forEach(([key, setting]) => {
      const valid = _coerceSetting(setting, _state[key]);
      kept[key] = valid === undefined ? setting.default : valid;
    });
  }
  _state = { ...INITIAL_STATE, ...kept };
  _state.lengths = _deriveLengths(_state);
  _busyOwner = null;
  _requestHandlers.clear();
  _notify();
}
