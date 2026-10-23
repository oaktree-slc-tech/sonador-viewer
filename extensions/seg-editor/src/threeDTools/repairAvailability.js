// Whether the Repair action can run, and why not when it cannot (ohif-viewers#149, FR-8). One
// helper, so the Repair card and the action row's hover status agree. Repair is offered for any
// diagnosed open, non-manifold or inconsistently wound edge; counts of zero do not make the surface
// a valid solid, and the message says so.

export const REPAIR_REASONS = {
  noTarget: 'noTarget',
  preview: 'preview',
  busy: 'busy',
  checking: 'checking',
  noDefect: 'noDefect',
  defects: 'defects',
};

/**
 * @param {Object} state - the 3D tool state (target, surfaceHealth, busy, preview)
 * @returns {{ enabled: boolean, reason: string, message: string, values: Object }} `message` is
 *   an i18n key for the panel, `values` its interpolation
 */
export function repairAvailability(state) {
  const { target, surfaceHealth: health, busy, preview } = state || {};
  if (!target || target.disabledReason) {
    return {
      enabled: false,
      reason: REPAIR_REASONS.noTarget,
      message: target?.disabledReason || 'Select a segment to repair',
      values: {},
    };
  }
  if (preview) {
    return { enabled: false, reason: REPAIR_REASONS.preview, message: 'Finish or cancel the edit shown first', values: {} };
  }
  if (busy) {
    return { enabled: false, reason: REPAIR_REASONS.busy, message: 'Another edit is still running', values: {} };
  }
  if (!health) {
    return { enabled: false, reason: REPAIR_REASONS.checking, message: 'Checking the surface...', values: {} };
  }
  const values = {
    open: health.boundaryEdgeCount || 0,
    nonManifold: health.nonManifoldEdgeCount || 0,
    inconsistent: health.inconsistentEdgeCount || 0,
  };
  if (!values.open && !values.nonManifold && !values.inconsistent) {
    return {
      enabled: false,
      reason: REPAIR_REASONS.noDefect,
      message: 'No open, non-manifold or inverted edge to repair. That alone does not make the surface a valid solid.',
      values,
    };
  }
  return {
    enabled: true,
    reason: REPAIR_REASONS.defects,
    message: 'Repair {{open}} open, {{nonManifold}} non-manifold and {{inconsistent}} inverted edge(s). Changes the 3D surface only.',
    values,
  };
}

export default repairAvailability;
