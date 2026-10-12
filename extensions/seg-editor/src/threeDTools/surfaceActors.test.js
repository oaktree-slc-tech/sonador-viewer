// The VTK surface actors refreshed in place after an edit that kept the surface's array lengths

jest.mock('@cornerstonejs/core', () => ({ getEnabledElements: jest.fn(() => []) }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ segmentation: { state: { getSegmentation: jest.fn() } } }), { virtual: true });

const { refreshSurfaceActors, segmentIndexOfGeometry } = require('./surfaceActors');


function fakeActor(representationUID, pointCount, polyCount) {
  const points = { data: new Float32Array(pointCount), setData: jest.fn(function set(data) { this.data = data; }), getData() { return this.data; }, modified: jest.fn() };
  const polys = { data: new Float32Array(polyCount), setData: jest.fn(function set(data) { this.data = data; }), getData() { return this.data; }, modified: jest.fn() };
  const polyData = { getPoints: () => points, getPolys: () => polys, modified: jest.fn() };
  const mapper = { getInputData: () => polyData, modified: jest.fn() };
  return { entry: { representationUID, actor: { getMapper: () => mapper } }, points, polys, polyData, mapper };
}

const SEG = 'vol3d:seg::edit';
const getSegmentation = () => ({ representationData: { Surface: { geometryIds: new Map([[1, 'g1'], [2, 'g2']]) } } });

describe('segmentIndexOfGeometry', () => {
  it('finds the segment a geometry belongs to', () => {
    expect(segmentIndexOfGeometry(SEG, 'g2', { getSegmentation })).toBe(2);
    expect(segmentIndexOfGeometry(SEG, 'g9', { getSegmentation })).toBeUndefined();
    expect(segmentIndexOfGeometry(SEG, 'g1', { getSegmentation: () => null })).toBeUndefined();
  });
});

describe('refreshSurfaceActors', () => {
  it('pushes a same-length surface into the actor of its segment, and leaves the others', () => {
    const mine = fakeActor(`${SEG}-Surface-1`, 9, 4);
    const other = fakeActor(`${SEG}-Surface-2`, 9, 4);
    const grown = fakeActor(`${SEG}-Surface-1`, 6, 4); // another viewport, a stale actor of a different size
    const render = jest.fn();
    const enabledElements = () => [
      { viewport: { getActors: () => [mine.entry, other.entry], render } },
      { viewport: { getActors: () => [grown.entry], render } },
    ];
    const surface = { points: Float32Array.from({ length: 9 }, (_, i) => i), polys: Int32Array.from([3, 0, 1, 2]) };

    const updated = refreshSurfaceActors(SEG, 'g1', surface, { enabledElements, getSegmentation });

    expect(updated).toBe(1);
    expect(mine.points.setData).toHaveBeenCalledWith(surface.points, 3);
    expect(Array.from(mine.polys.data)).toEqual([3, 0, 1, 2]);
    expect(mine.polyData.modified).toHaveBeenCalled();
    expect(mine.mapper.modified).toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(other.points.setData).not.toHaveBeenCalled();
    expect(grown.points.setData).not.toHaveBeenCalled();
  });

  it('does nothing for a geometry the segmentation does not show', () => {
    expect(refreshSurfaceActors(SEG, 'g9', { points: new Float32Array(0), polys: new Int32Array(0) }, {
      enabledElements: () => [], getSegmentation,
    })).toBe(0);
  });
});
