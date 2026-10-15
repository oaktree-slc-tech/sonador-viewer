// The preview overlay: which faces an edit changes, their compacted geometry, and the colours

import { uvSphere } from './testing/meshes';
import {
  changedTriangles,
  createChangeOverlay,
  disposeChangeOverlay,
  movedPoints,
  overlayGeometry,
  previewShades,
  setChangeOverlayColor,
  updateChangeOverlay,
} from './previewOverlay';
import { smoothSurface } from './smoothSelection';


// Two triangles of an unchanged surface, then one patch triangle
const CUT = {
  cut: true,
  after: {
    points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 2, 0]),
    polys: Int32Array.from([3, 0, 1, 2, 3, 1, 3, 2, 3, 2, 3, 4]),
    patchPolysOffset: 8,
  },
};

describe('changedTriangles', () => {
  it('gives a cut its patch faces only', () => {
    expect([...changedTriangles(CUT)]).toEqual([2, 3, 4]);
  });

  it('gives a smooth every face with a moved point, including unselected faces sharing a boundary point', () => {
    // Faces 0 (0-1-2) and 1 (1-3-2) share the points 1 and 2. Only face 1 is selected, but a soft
    // edge moves its boundary point 2, which face 0 has too: Apply changes both faces.
    const polys = Int32Array.from([3, 0, 1, 2, 3, 1, 3, 2]);
    const before = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const softEdge = Float32Array.from(before);
    softEdge[8] = 0.25; // point 2 lifted at half weight
    const smooth = { kind: 'smooth', selected: [1], before: { points: before, polys }, after: { points: softEdge, polys } };
    expect([...movedPoints(before, softEdge)]).toEqual([0, 0, 1, 0]);
    expect([...changedTriangles(smooth)]).toEqual([0, 1, 2, 1, 3, 2]);

    // With only point 3 moved (an interior point of the selected face), only that face changes
    const interior = Float32Array.from(before);
    interior[11] = 0.5;
    expect([...changedTriangles({ ...smooth, after: { points: interior, polys } })]).toEqual([1, 3, 2]);
  });

  it('falls back to a smooth\'s selection without comparable before and after points', () => {
    const smooth = { kind: 'smooth', selected: [1], after: { points: CUT.after.points, polys: CUT.after.polys } };
    expect([...changedTriangles(smooth)]).toEqual([1, 3, 2]);
  });

  it('covers the faces a real Soft-edge smooth changes outside the selection', () => {
    // The review's reproduction: a uv sphere, the cap above z = 6 selected, strength 0.5, 3 passes
    const surface = uvSphere({ radius: 10, segments: 24, rings: 16 });
    const { points, polys } = surface;
    const selected = [];
    for (let t = 0; 4 * t < polys.length; t++) {
      if ([1, 2, 3].every(k => points[3 * polys[4 * t + k] + 2] > 6)) {
        selected.push(t);
      }
    }
    const overlayFaces = feather => {
      const result = smoothSurface({ surface, selectedTriangles: selected, options: { strength: 0.5, passes: 3, feather } });
      expect(result).toMatchObject({ changed: true, flipped: 0, degenerate: 0 });
      return changedTriangles({ kind: 'smooth', selected, before: surface, after: result.after }).length / 3;
    };
    expect(selected).toHaveLength(168);
    // Pinned boundary: exactly the selection changes
    expect(overlayFaces(false)).toBe(168);
    // Soft edge: the boundary ring's neighbours change too
    expect(overlayFaces(true)).toBe(216);
  });

  it('gives nothing for a cut without patches, or without a result', () => {
    expect(changedTriangles({ cut: true, after: { ...CUT.after, patchPolysOffset: 12 } })).toHaveLength(0);
    expect(changedTriangles({ cut: true, after: { ...CUT.after, patchPolysOffset: undefined } })).toHaveLength(0);
    expect(changedTriangles(null)).toHaveLength(0);
  });
});

describe('overlayGeometry', () => {
  it('compacts the vertices and lists each shared edge once', () => {
    // Two faces sharing the edge 1-2
    const { positions, faces, edges } = overlayGeometry(CUT.after.points, Uint32Array.from([0, 1, 2, 1, 3, 2]));
    expect(positions).toHaveLength(4 * 3);
    expect([...faces]).toEqual([0, 1, 2, 1, 3, 2]);
    expect(edges).toHaveLength(5 * 2);
    expect([...positions.slice(9, 12)]).toEqual([1, 1, 0]); // vertex 3 becomes local 3
  });
});

describe('previewShades', () => {
  it('derives a lighter edge and a pale vertex from the preview colour', () => {
    const { face, edge, vertex } = previewShades('#ff8500');
    expect(face.getHexString()).toBe('ff8500');
    const lightness = color => color.getHSL({}).l;
    expect(lightness(edge)).toBeGreaterThan(lightness(face));
    expect(lightness(vertex)).toBeGreaterThan(lightness(edge));
    expect(edge.getHSL({}).h).toBeCloseTo(face.getHSL({}).h, 2);
  });

  it('falls back to orange for a missing colour', () => {
    expect(previewShades(undefined).face.getHexString()).toBe('ff8500');
  });
});

describe('createChangeOverlay', () => {
  it('builds faces, edges and vertices, recolours and updates them, and disposes them', () => {
    const triangles = changedTriangles(CUT);
    const overlay = createChangeOverlay({ points: CUT.after.points, triangles, color: '#ff8500' });
    expect(overlay.children.map(part => [part.name, part.type])).toEqual([
      ['faces', 'Mesh'], ['edges', 'LineSegments2'], ['vertices', 'Points'],
    ]);
    const faces = overlay.getObjectByName('faces');
    expect(faces.material).toMatchObject({ transparent: true, depthWrite: false, polygonOffset: true });
    // Prominent: a strong fill, edges thicker than a one-pixel line, large vertices
    expect(faces.material.opacity).toBeGreaterThanOrEqual(0.6);
    const edges = overlay.getObjectByName('edges');
    expect(edges.material.linewidth).toBeGreaterThan(1);
    expect(edges.material.worldUnits).toBe(false);
    // The thick lines' segments: the patch triangle's three edges, end to end
    expect(edges.geometry.getAttribute('instanceStart').count).toBe(3);
    // Their width is in pixels of the canvas they are drawn on
    edges.onBeforeRender({ getSize: size => size.set(800, 600) });
    expect(edges.material.resolution.toArray()).toEqual([800, 600]);
    const vertices = overlay.getObjectByName('vertices');
    expect(vertices.material.sizeAttenuation).toBe(false);
    expect(vertices.material.size).toBeGreaterThanOrEqual(7);

    setChangeOverlayColor(overlay, '#00ff00');
    expect(faces.material.color.getHexString()).toBe('00ff00');
    expect(edges.material.color.getHSL({}).h).toBeCloseTo(faces.material.color.getHSL({}).h, 2);

    const moved = Float32Array.from(CUT.after.points);
    moved[14] = 3;
    const before = faces.geometry;
    const dispose = jest.spyOn(before, 'dispose');
    updateChangeOverlay(overlay, { points: moved, triangles });
    expect(dispose).toHaveBeenCalled();
    expect(faces.geometry.getAttribute('position').array[8]).toBe(3);
    expect(edges.geometry.getAttribute('instanceStart').count).toBe(3);
    expect([...edges.geometry.getAttribute('instanceStart').data.array]).toContain(3);

    const parts = overlay.children.map(part => jest.spyOn(part.material, 'dispose'));
    disposeChangeOverlay(overlay);
    parts.forEach(spy => expect(spy).toHaveBeenCalled());
  });

  it('is nothing when the edit changes no faces', () => {
    expect(createChangeOverlay({ points: CUT.after.points, triangles: new Uint32Array(0), color: '#ff8500' })).toBeNull();
  });
});
