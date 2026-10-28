// The edit-mode display of the target segment: every edge and vertex of its surface, in the mesh colour (grey by default)

import {
  createEditModeOverlay,
  disposeEditModeOverlay,
  MESH_COLOR_AUTO,
  meshColorFor,
  meshColorPalette,
  setEditModeOverlayColor,
  uniqueEdges,
  updateEditModeOverlay,
} from './editModeOverlay';

// Two triangles sharing the edge 1-2, and a quad cell
const SURFACE = {
  points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 0, 0, 2, 1, 0]),
  polys: Int32Array.from([3, 0, 1, 2, 3, 1, 3, 2, 4, 1, 4, 5, 3]),
};

describe('uniqueEdges', () => {
  it('lists every edge once, a quad by its perimeter, and stops at a malformed cell', () => {
    const edges = Array.from(uniqueEdges(SURFACE.polys));
    const pairs = [];
    for (let i = 0; i < edges.length; i += 2) {
      pairs.push([edges[i], edges[i + 1]].sort((a, b) => a - b).join('-'));
    }
    expect(pairs).toEqual(['0-1', '1-2', '0-2', '1-3', '2-3', '1-4', '4-5', '3-5']);
    expect(Array.from(uniqueEdges([3, 0, 1, 2, 3, 0, 1]))).toEqual([0, 1, 1, 2, 2, 0]);
    expect(uniqueEdges([])).toHaveLength(0);
  });
});

describe('createEditModeOverlay', () => {
  it('draws grey edges and vertices over the surface, depth-tested, under the highlight and preview', () => {
    const overlay = createEditModeOverlay(SURFACE);
    expect(overlay.children.map(part => [part.name, part.type])).toEqual([['edges', 'LineSegments'], ['vertices', 'Points']]);
    const edges = overlay.getObjectByName('edges');
    const vertices = overlay.getObjectByName('vertices');
    expect(edges.geometry.index.count).toBe(16);
    expect(edges.geometry.getAttribute('position').count).toBe(6);
    expect(edges.material.color.getHex()).toBe(0x8f8f8f);
    expect(edges.material).toMatchObject({ depthTest: true, depthWrite: false, transparent: true });
    expect(vertices.material.color.getHex()).toBe(0x8f8f8f);
    expect(vertices.material).toMatchObject({ sizeAttenuation: false, depthTest: true });
    expect(vertices.material.size).toBeGreaterThanOrEqual(2);
    expect(edges.renderOrder).toBeLessThan(1);
    expect(vertices.renderOrder).toBeLessThan(1);

    const before = edges.geometry;
    const dispose = jest.spyOn(before, 'dispose');
    updateEditModeOverlay(overlay, { points: SURFACE.points.slice(0, 9), polys: [3, 0, 1, 2] });
    expect(dispose).toHaveBeenCalled();
    expect(edges.geometry.index.count).toBe(6);
    expect(vertices.geometry.getAttribute('position').count).toBe(3);

    const parent = { remove: jest.fn() };
    overlay.parent = parent;
    disposeEditModeOverlay(overlay);
    expect(parent.remove).toHaveBeenCalledWith(overlay);
  });

  it('takes the user\'s mesh colour, and recolours in place', () => {
    const overlay = createEditModeOverlay(SURFACE, { color: '#ff00ff' });
    expect(overlay.getObjectByName('edges').material.color.getHex()).toBe(0xff00ff);
    expect(overlay.getObjectByName('vertices').material.color.getHex()).toBe(0xff00ff);
    setEditModeOverlayColor(overlay, '#00ff00');
    expect(overlay.getObjectByName('edges').material.color.getHex()).toBe(0x00ff00);
    expect(overlay.getObjectByName('vertices').material.color.getHex()).toBe(0x00ff00);
  });

  it('derives the mesh colour from the segment\'s: a dark segment gets a much lighter shade, a light one a much darker shade', () => {
    // A dark red segment: toward white by 60%
    expect(meshColorFor('rgb(128, 0, 0)').getHexString()).toBe('cc9999');
    // A light yellow segment: toward black by 80%
    expect(meshColorFor('#ffff80').getHexString()).toBe('33331a');
    // A pick wins; auto and nothing fall back
    expect(meshColorFor('#ff0000', '#123456').getHexString()).toBe('123456');
    expect(meshColorFor('#ff0000', MESH_COLOR_AUTO).getHexString()).toBe('ff9999');
    expect(meshColorFor(undefined).getHexString()).toBe('8f8f8f');
    expect(meshColorFor(null, 'auto').getHexString()).toBe('8f8f8f');
  });

  it('offers a palette of the segment\'s shades, lighter to darker', () => {
    const palette = meshColorPalette('#ff0000');
    expect(palette).toEqual(['#ffd9d9', '#ff9999', '#ff5959', '#a60000', '#660000', '#260000']);
    expect(meshColorPalette(undefined)).toHaveLength(6);
  });

  it('has nothing to draw for an empty surface', () => {
    expect(createEditModeOverlay({ points: new Float32Array(0), polys: new Int32Array(0) })).toBeNull();
    expect(createEditModeOverlay(null)).toBeNull();
  });
});
