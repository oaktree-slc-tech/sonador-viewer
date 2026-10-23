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

/**
 * One line on an edit's outcome.
 */
export function editSummary(t, edit) {
  const {
    holes = 0, methods = {}, closed, openEdges = 0, repair, points = 0, faces = 0, kind,
    preexistingLoops = 0, introduced, before, after, conditioning,
  } = edit;
  const parts = [];
  if (kind === 'smooth') {
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
