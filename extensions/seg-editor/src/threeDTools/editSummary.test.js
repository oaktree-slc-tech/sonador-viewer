// The Selection panel's edit summary line

import { editSummary, writeStatusText } from './editSummary';

const t = (key, options = {}) => key.replace(/{{(\w+)}}/g, (_m, name) => options[name]);

describe('editSummary', () => {
  it('describes a removal: faces, holes and how they were closed, the result, and the 2D views', () => {
    expect(editSummary(t, { faces: 300, points: 312, holes: 2, methods: { fitted: 1, flat: 1 }, closed: true, write: 'queued' }))
      .toBe('300 face(s) removed, 2 hole(s) closed (1 smooth, 1 flat); result closed; 2D views updating...');
    expect(editSummary(t, { points: 312, holes: 2, methods: { fitted: 2 }, closed: true, write: 'written', removedVoxels: 120, addedVoxels: 0, farField: 0 }))
      .toBe('312 face(s) removed, 2 hole(s) closed (2 smooth); result closed; 2D views updated: 120 voxel(s) removed, 0 added, 0 outside the edit region');
  });

  it('describes a repair with its counts before and after, and open edges that could not be closed', () => {
    const before = { boundaryEdgeCount: 20, nonManifoldEdgeCount: 3, inconsistentEdgeCount: 1 };
    const after = { boundaryEdgeCount: 4, nonManifoldEdgeCount: 3, inconsistentEdgeCount: 1 };
    expect(editSummary(t, { repair: true, holes: 1, methods: { flat: 1 }, openEdges: 4, closed: false, before, after, write: 'surfaceOnly' }))
      .toBe('1 open rim(s) closed (1 flat); 20 open, 3 non-manifold, 1 inverted → 4 open, 3 non-manifold, 1 inverted; '
        + '4 edge(s) could not be closed; result still open; 3D surface only; 2D views not updated');
  });

  it('reports openings left as found, defects introduced, and a weld that was not kept', () => {
    expect(editSummary(t, {
      faces: 10, holes: 1, methods: { flat: 1 }, preexistingLoops: 2, closed: false,
      introduced: { total: 5, boundaryEdgeCount: 5, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
      conditioning: { fellBack: true, requestedWeldTolerance: 0.05 },
      write: 'surfaceOnly',
    })).toBe('10 face(s) removed, 1 hole(s) closed (1 flat); 2 opening(s) left as found; introduced 5 open, 0 non-manifold, 0 inverted; '
      + 'result still open; weld 0.05 not kept; exact weld used; 3D surface only; 2D views not updated');
  });

  it('leaves the result and the write out when they are unknown', () => {
    expect(editSummary(t, { points: 3, holes: 0 })).toBe('3 face(s) removed, 0 hole(s) closed');
  });

  it('describes a smooth by the points it moved', () => {
    expect(editSummary(t, { kind: 'smooth', points: 120, write: 'queued' })).toBe('120 point(s) smoothed; 2D views updating...');
  });

  it('names every write status', () => {
    expect(writeStatusText(t, { write: 'refused' })).toMatch(/refused/);
    expect(writeStatusText(t, { write: 'failed' })).toMatch(/failed/);
    expect(writeStatusText(t, { write: 'nothing' })).toBe('2D views unchanged');
    expect(writeStatusText(t, {})).toBe('');
  });
});
