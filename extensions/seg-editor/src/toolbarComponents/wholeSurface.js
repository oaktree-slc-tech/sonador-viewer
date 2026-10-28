// The whole-surface side of the 3D Tools palette (owner's review of 2026-10-26): what acts on the
// entire 3D surface of the selected segment, never on the selection, is kept apart from the
// selection tools. The status block under the tool row shows the surface's state with every
// tool (health, the 2D slices behind the surface, the last edit); the "⋯" menu in the title row
// holds the whole-surface operations (Repair surface..., Synchronize 2D slices...) and the
// display toggles. This module is the React-free model of both; WholeSurface.jsx renders it.

import { MESH_COLOR_AUTO, meshColorFor, meshColorPalette } from '../threeDTools/editModeOverlay';


const number = value => Number(value || 0).toLocaleString();

/** The non-zero defect counts of a surface, short ("38 open edges, 2 non-manifold"). */
export function healthSummary(t, health) {
  if (!health) {
    return '';
  }
  if (health.closed) {
    return t('Closed');
  }
  const parts = [];
  if (health.boundaryEdgeCount > 0) {
    parts.push(t('{{count}} open edges', { count: health.boundaryEdgeCount }));
  }
  if (health.nonManifoldEdgeCount > 0) {
    parts.push(t('{{count}} non-manifold', { count: health.nonManifoldEdgeCount }));
  }
  if (health.inconsistentEdgeCount > 0) {
    parts.push(t('{{count}} inverted', { count: health.inconsistentEdgeCount }));
  }
  return parts.length ? parts.join(', ') : t('Open');
}

/**
 * The surface health line: a dot's tone and its text, and whether the line opens the Repair
 * surface dialog (there is a surface to show).
 *
 * @returns {{ tone: 'ok'|'warning'|'muted', text: string, interactive: boolean }}
 */
export function surfaceStatus(t, state) {
  const { target, surfaceHealth: health } = state;
  const hasTarget = !!target && !target.disabledReason;
  if (!hasTarget && !health) {
    return { tone: 'muted', text: target?.disabledReason || t('Select a segment to check its surface'), interactive: false };
  }
  if (!health) {
    return { tone: 'muted', text: t('Checking the surface...'), interactive: true };
  }
  if (health.closed) {
    return {
      tone: 'ok',
      text: health.triangles > 0
        ? t('Surface is closed · {{n}} triangles', { count: health.triangles, n: number(health.triangles) })
        : t('Surface is closed'),
      interactive: true,
    };
  }
  return { tone: 'warning', text: healthSummary(t, health), interactive: true };
}

/**
 * The synchronization lines: the pending writes, the surface ahead of the 2D slices (with the
 * failed count), and whether Synchronize... may run now.
 *
 * @returns {{ pending: string|null, ahead: string|null, failed: string|null, canSynchronize: boolean }}
 */
export function syncStatus(t, state) {
  const { pendingWrites = 0, unsynchronizedEdits = 0, failedWrites = 0, busy, preview } = state;
  return {
    pending: pendingWrites > 0 ? t('Updating the 2D slices ({{count}} pending)...', { count: pendingWrites }) : null,
    ahead: unsynchronizedEdits > 0 ? t('3D surface ahead of the 2D slices: {{count}} edits not written.', { count: unsynchronizedEdits }) : null,
    failed: unsynchronizedEdits > 0 && failedWrites > 0 ? t('{{count}} of them because the write was refused or failed.', { count: failedWrites }) : null,
    canSynchronize: unsynchronizedEdits > 0 && !busy && !preview && pendingWrites === 0,
  };
}

/**
 * The "⋯" menu: the whole-surface operations with their availability and the line that
 * explains each, and the display toggles.
 *
 * @returns {{
 *   repair: { enabled: boolean, title: string, description: string, trailing: string },
 *   synchronize: { enabled: boolean, title: string, description: string, trailing: string },
 *   showMesh: { checked: boolean, title: string, description: string },
 *   meshColor: { auto: boolean, preference: string, effective: string, palette: string[] },
 *   showIssues: { checked: boolean, title: string, description: string },
 * }}
 */
export function wholeSurfaceMenu(t, state, { meshColor: preference = MESH_COLOR_AUTO } = {}) {
  const { target, surfaceHealth: health, unsynchronizedEdits = 0, pendingWrites = 0, busy, preview } = state;
  const hasTarget = !!target && !target.disabledReason;
  // Without a segment the item explains why (the target's own reason is already worded)
  const repair = {
    enabled: hasTarget,
    title: t('Repair surface...'),
    description: hasTarget
      ? t('Closes open edges across the whole 3D surface. Ignores the selection.')
      : target?.disabledReason || t('Select a segment to repair'),
    trailing: hasTarget && health ? healthSummary(t, health) : '',
  };
  let synchronize;
  if (unsynchronizedEdits === 0) {
    synchronize = { enabled: false, description: t('The 2D slices match the 3D surface.') };
  } else if (preview) {
    synchronize = { enabled: false, description: t('Finish or cancel the edit shown first.') };
  } else if (busy || pendingWrites > 0) {
    synchronize = { enabled: false, description: t('Updating the 2D slices...') };
  } else {
    synchronize = { enabled: true, description: t('Writes the surface\'s unwritten edits to the 2D slices. Opens a choice of how.') };
  }
  return {
    repair,
    synchronize: {
      ...synchronize,
      title: t('Synchronize 2D slices...'),
      trailing: unsynchronizedEdits > 0 ? t('{{count}} edits', { count: unsynchronizedEdits }) : '',
    },
    showMesh: {
      checked: !!state.showMesh,
      title: t('Show mesh'),
      description: t('Draws every edge and vertex of the segment in the mesh colour.'),
    },
    // The mesh colour: following the segment (a much lighter or darker shade of its colour) or
    // the user's pick, with a palette of the segment's own shades to pick from
    meshColor: {
      auto: !preference || preference === MESH_COLOR_AUTO,
      preference: preference || MESH_COLOR_AUTO,
      effective: `#${meshColorFor(target?.color, preference).getHexString()}`,
      palette: meshColorPalette(target?.color),
    },
    showIssues: {
      checked: !!state.showIssues,
      title: t('Show issues'),
      description: t('Marks open edges red, non-manifold amber and inverted edges purple on the model.'),
    },
  };
}
