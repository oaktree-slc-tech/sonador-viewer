// Lasso selection of visible surface points, against real three.js meshes with three-mesh-bvh

import { DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, SphereGeometry } from 'three';

import { ensureBoundsTree } from '../threejs/meshBvh';
import {
  combineSelection,
  pointInPolygon,
  selectionModeForEvent,
  selectVerticesInLasso,
  SELECTION_MODES,
} from './lassoSelection';


function sphere({ radius = 10, x = 0, z = 0 } = {}) {
  const geometry = new SphereGeometry(radius, 32, 16);
  geometry.translate(x, 0, z);
  ensureBoundsTree(geometry);
  geometry.computeBoundingSphere();
  return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
}

function frontCamera() {
  // Looking down -z at the origin
  const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 200);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  return camera;
}

const FULL = [-1, -1, 1, -1, 1, 1, -1, 1];

describe('pointInPolygon', () => {
  const square = [0, 0, 2, 0, 2, 2, 0, 2];

  it('tests points against a polygon', () => {
    expect(pointInPolygon(1, 1, square)).toBe(true);
    expect(pointInPolygon(3, 1, square)).toBe(false);
  });

  it('handles concave polygons', () => {
    const u = [0, 0, 3, 0, 3, 3, 2, 3, 2, 1, 1, 1, 1, 3, 0, 3];
    expect(pointInPolygon(1.5, 2, u)).toBe(false);
    expect(pointInPolygon(0.5, 2, u)).toBe(true);
  });
});

describe('selectVerticesInLasso', () => {
  it('selects only the vertices the camera can see', () => {
    const mesh = sphere();
    const position = mesh.geometry.getAttribute('position');

    const selected = selectVerticesInLasso({ mesh, camera: frontCamera(), lasso: FULL, occluders: [mesh] });

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(v => position.getZ(v) > -0.5)).toBe(true);
    // Without occlusion, the back of the sphere is selected too
    const all = selectVerticesInLasso({ mesh, camera: frontCamera(), lasso: FULL });
    expect(all.length).toBe(position.count);
  });

  it('does not select points hidden behind another mesh', () => {
    const target = sphere({ radius: 5 });
    const blocker = sphere({ radius: 8, z: 20 }); // between the camera and the target

    const selected = selectVerticesInLasso({
      mesh: target, camera: frontCamera(), lasso: FULL, occluders: [target, blocker],
    });

    expect(selected).toEqual([]);
  });

  it('selects only inside the lasso', () => {
    const mesh = sphere();
    const position = mesh.geometry.getAttribute('position');
    const rightHalf = [0.01, -1, 1, -1, 1, 1, 0.01, 1];

    const selected = selectVerticesInLasso({ mesh, camera: frontCamera(), lasso: rightHalf });

    expect(selected.every(v => position.getX(v) > 0)).toBe(true);
  });
});

describe('combineSelection / selectionModeForEvent', () => {
  it('replaces, adds to and subtracts from the selection', () => {
    const current = new Set([1, 2, 3]);
    expect([...combineSelection(current, [3, 4], SELECTION_MODES.replace)]).toEqual([3, 4]);
    expect([...combineSelection(current, [3, 4], SELECTION_MODES.add)]).toEqual([1, 2, 3, 4]);
    expect([...combineSelection(current, [3, 4], SELECTION_MODES.subtract)]).toEqual([1, 2]);
    expect([...current]).toEqual([1, 2, 3]);
  });

  it('reads the mode from the modifier keys', () => {
    expect(selectionModeForEvent({})).toBe(SELECTION_MODES.replace);
    expect(selectionModeForEvent({ shiftKey: true })).toBe(SELECTION_MODES.add);
    expect(selectionModeForEvent({ ctrlKey: true })).toBe(SELECTION_MODES.subtract);
    expect(selectionModeForEvent({ metaKey: true, shiftKey: true })).toBe(SELECTION_MODES.subtract);
  });
});
