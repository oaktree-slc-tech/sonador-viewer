// The one-line account of a surface edit the Selection panel shows (ohif-viewers#142, §12;
// ohif-viewers#149, FR-10): what was removed, how the holes were closed, what was left as found,
// what the result introduced, and what the 2D views got.

const _methods = (t, methods) => {
  const parts = [];
  if (methods.fitted) {
    parts.push(t('{{count}} smooth', { count: methods.fitted }));
  }
  if (methods.flat) {
    parts.push(t('{{count}} flat', { count: methods.flat }));
  }
  if (methods.cap) {
    parts.push(t('{{count}} fan', { count: methods.cap }));
  }
  return parts.length ? ` (${parts.join(', ')})` : '';
};

const _edgeCounts = (t, counts) => t('{{open}} open, {{nonManifold}} non-manifold, {{inconsistent}} inverted', {
  open: counts.boundaryEdgeCount || 0,
  nonManifold: counts.nonManifoldEdgeCount || 0,
  inconsistent: counts.inconsistentEdgeCount || 0,
});

/**
 * What a synchronization acknowledged (ohif-viewers#152 §3, §5): the defects of the surface
 * written as found, never described as repaired or watertight.
 */
export function acknowledgedText(t, acknowledged) {
  if (!acknowledged) {
    return '';
  }
  const { defects } = acknowledged;
  if (!defects) {
    return t('surface synchronized');
  }
  return t('best-effort conversion acknowledged with {{open}} open, {{nonManifold}} non-manifold and {{inconsistent}} inverted edge(s)', {
    open: defects.boundaryEdgeCount || 0,
    nonManifold: defects.nonManifoldEdgeCount || 0,
    inconsistent: defects.inconsistentEdgeCount || 0,
  });
}

/** What the 2D views got from the edit, from the summary's `write` status. */
export function writeStatusText(t, edit) {
  const { write, removedVoxels = 0, addedVoxels = 0, farField = 0 } = edit;
  switch (write) {
    case 'queued':
      return t('2D views updating...');
    case 'written':
      return t('2D views updated: {{removed}} voxel(s) removed, {{added}} added, {{farField}} outside the edit region', {
        removed: removedVoxels, added: addedVoxels, farField,
      });
    case 'nothing':
      return t('2D views unchanged');
    case 'surfaceOnly':
      return t('3D surface only; 2D views not updated');
    case 'refused':
      return t('2D views not updated: the write was refused');
    case 'failed':
      return t('2D views not updated: the write failed');
    default:
      return '';
  }
}

const _round3 = value => Number(Number(value).toPrecision(3));

/**
 * The removal depth as it was set, with its basis and calibration state (ohif-viewers#151 FR-7):
 * "depth 2 mm (≈ 4 vox)" on a calibrated grid, "depth 4 vox (= 4 units)" on one whose
 * calibration is unknown; the other reading is left out when the grid's steps are not known.
 */
export function depthText(t, depth) {
  if (!depth || !(depth.value >= 0)) {
    return '';
  }
  const unit = t(depth.unit || 'units');
  if (depth.basis === 'voxels') {
    return depth.world === null || depth.world === undefined
      ? `${t('depth')} ${depth.value} ${t('vox')}`
      : t('depth {{value}} vox (= {{world}} {{unit}})', { value: depth.value, world: _round3(depth.world), unit });
  }
  return depth.voxels === null || depth.voxels === undefined
    ? `${t('depth')} ${_round3(depth.value)} ${unit}`
    : t('depth {{value}} {{unit}} (≈ {{voxels}} vox)', { value: _round3(depth.value), unit, voxels: _round3(depth.voxels) });
}

/**
 * One line on an edit's outcome.
 */
export function editSummary(t, edit) {
  const {
    holes = 0, methods = {}, closed, openEdges = 0, repair, points = 0, faces = 0, kind,
    preexistingLoops = 0, introduced, before, after, conditioning, depth,
  } = edit;
  const parts = [];
  if (kind === 'sync') {
    parts.push(edit.acknowledged?.defects ? acknowledgedText(t, edit.acknowledged)
      : t('{{count}} edit(s) synchronized from the last checkpoint', { count: edit.covered || 0 }));
  } else if (kind === 'smooth') {
    parts.push(t('{{count}} point(s) smoothed', { count: points }));
  } else {
    const how = _methods(t, methods);
    if (repair) {
      parts.push(t('{{count}} open rim(s) closed', { count: holes }) + how);
      if (before && after) {
        parts.push(`${_edgeCounts(t, before)} → ${_edgeCounts(t, after)}`);
      }
    } else {
      parts.push(`${t('{{count}} face(s) removed', { count: faces || points })}, ${t('{{count}} hole(s) closed', { count: holes })}${how}`);
      const depthPart = depthText(t, depth);
      if (depthPart) {
        parts.push(depthPart);
      }
    }
    if (preexistingLoops) {
      parts.push(t('{{count}} opening(s) left as found', { count: preexistingLoops }));
    }
    if (openEdges) {
      parts.push(t('{{count}} edge(s) could not be closed', { count: openEdges }));
    }
    if (introduced?.total) {
      parts.push(`${t('introduced')} ${_edgeCounts(t, introduced)}`);
    }
    if (closed !== undefined && closed !== null) {
      parts.push(closed ? t('result closed') : t('result still open'));
    }
    if (conditioning?.fellBack) {
      parts.push(t('weld {{tolerance}} not kept; exact weld used', { tolerance: conditioning.requestedWeldTolerance }));
    }
  }
  const status = writeStatusText(t, edit);
  if (status) {
    parts.push(status);
  }
  return parts.join('; ');
}
