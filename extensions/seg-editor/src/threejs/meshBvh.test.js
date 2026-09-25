// three-mesh-bvh wiring (ohif-viewers#142)

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Raycaster,
  Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

import {
  ensureBoundsTree,
  installMeshBvh,
  refreshBoundsTree,
  releaseBoundsTree,
} from './meshBvh';

// A unit square in the z=0 plane, centred on the origin (two triangles)
function square(z = 0) {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([
    -1, -1, z, 1, -1, z, 1, 1, z,
    -1, -1, z, 1, 1, z, -1, 1, z,
  ]);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

function rayDown() {
  return new Raycaster(new Vector3(0.25, -0.5, 5), new Vector3(0, 0, -1));
}

describe('meshBvh', () => {
  it('installs the prototype extensions once', () => {
    installMeshBvh();
    installMeshBvh();

    expect(typeof BufferGeometry.prototype.computeBoundsTree).toBe('function');
    expect(typeof BufferGeometry.prototype.disposeBoundsTree).toBe('function');
    expect(Mesh.prototype.raycast).toBe(acceleratedRaycast);
  });

  it('builds a bounds tree on first use and reuses it', () => {
    const geometry = square();

    const tree = ensureBoundsTree(geometry);

    expect(tree).toBeInstanceOf(MeshBVH);
    expect(ensureBoundsTree(geometry)).toBe(tree);
  });

  it('raycasts through the bounds tree', () => {
    const geometry = square();
    ensureBoundsTree(geometry);
    const mesh = new Mesh(geometry);

    const hits = rayDown().intersectObject(mesh);

    expect(hits).toHaveLength(1);
    expect(hits[0].point.z).toBeCloseTo(0);
  });

  it('rebuilds after the positions change and releases on request', () => {
    const geometry = square();
    const before = ensureBoundsTree(geometry);

    geometry.getAttribute('position').array.fill(2, 2, 3); // move one vertex up
    const after = refreshBoundsTree(geometry);

    expect(after).toBeInstanceOf(MeshBVH);
    expect(after).not.toBe(before);

    releaseBoundsTree(geometry);
    expect(geometry.boundsTree).toBeNull();
    expect(() => releaseBoundsTree(geometry)).not.toThrow();
    expect(() => releaseBoundsTree(undefined)).not.toThrow();
  });
});
