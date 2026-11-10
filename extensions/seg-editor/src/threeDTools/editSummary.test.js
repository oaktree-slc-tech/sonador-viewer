// The Selection panel's edit summary line

import { depthText, editSummary, writeStatusText } from './editSummary';

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

describe('editSummary: synchronizations (ohif-viewers#152)', () => {
  const { acknowledgedText } = require('./editSummary');

  it('describes a synchronization by the edits it covered, and an acknowledged conversion by its defects', () => {
    expect(editSummary(t, { kind: 'sync', covered: 3, acknowledged: null, write: 'queued' }))
      .toBe('3 edit(s) synchronized from the last checkpoint; 2D views updating...');
    expect(editSummary(t, {
      kind: 'sync', covered: 2, write: 'written', removedVoxels: 40, addedVoxels: 2, farField: 0,
      acknowledged: { defects: { boundaryEdgeCount: 4, nonManifoldEdgeCount: 1, inconsistentEdgeCount: 0, closed: false } },
    })).toBe('best-effort conversion acknowledged with 4 open, 1 non-manifold and 0 inverted edge(s); '
      + '2D views updated: 40 voxel(s) removed, 2 added, 0 outside the edit region');
    expect(acknowledgedText(t, { defects: null })).toBe('surface synchronized');
    expect(acknowledgedText(t, null)).toBe('');
  });
});

describe('editSummary: the removal depth with its basis (ohif-viewers#151 FR-7)', () => {
  it('states a world-unit depth with its voxel reading, and a voxel-unit depth with its world reading', () => {
    expect(depthText(t, { basis: 'world', unit: 'mm', value: 2, world: 2, voxels: 4 })).toBe('depth 2 mm (≈ 4 vox)');
    expect(depthText(t, { basis: 'voxels', unit: 'units', value: 4, world: 4, voxels: 4 })).toBe('depth 4 vox (= 4 units)');
    expect(depthText(t, { basis: 'voxels', unit: 'units', value: 3, world: 2.25, voxels: 3 })).toBe('depth 3 vox (= 2.25 units)');
  });

  it('leaves the other reading out when the grid steps are not known, and says nothing without a depth', () => {
    expect(depthText(t, { basis: 'world', unit: 'units', value: 3.5, world: 3.5, voxels: null })).toBe('depth 3.5 units');
    expect(depthText(t, { basis: 'world', unit: 'mm', value: 0, world: 0, voxels: 0 })).toBe('depth 0 mm (≈ 0 vox)');
    expect(depthText(t, null)).toBe('');
    expect(depthText(t, { basis: 'world', value: -1 })).toBe('');
  });

  it('puts the depth on a removal line, after what was removed and closed', () => {
    const line = editSummary(t, {
      faces: 12, holes: 1, methods: { flat: 1 }, closed: true, write: 'queued',
      depth: { basis: 'world', unit: 'mm', value: 2, world: 2, voxels: 4 },
    });
    expect(line).toBe('12 face(s) removed, 1 hole(s) closed (1 flat); depth 2 mm (≈ 4 vox); result closed; 2D views updating...');
    // A repair has no depth
    expect(editSummary(t, { repair: true, holes: 2, methods: {}, depth: { basis: 'world', value: 2 } })).not.toMatch(/depth/);
  });
});
