// Slice-order arithmetic between a legacy cornerstone-tools labelmap and a Cornerstone3D volume.
// Pure module: nothing is mocked, because nothing is imported that would need it.

const {
  computeLabelmapSliceMap,
  getSegmentsOnPixelData,
  invertLabelmapSliceMap,
  mapLabelmapBufferToVolumeOrder,
} = require('./labelmapOrder.js');


function makeVolume(imageIds, columns = 2, rows = 2) {
  return {
    dimensions: [columns, rows, imageIds.length],
    imageIds,
    getImageIdIndex: id => imageIds.indexOf(id),
  };
}


describe('computeLabelmapSliceMap', () => {
  it('reports the identity when the stack and the volume agree slice for slice', () => {
    const stack = ['a', 'b', 'c'];
    const { map, identity, slices } = computeLabelmapSliceMap(makeVolume(stack), stack);

    expect(map).toEqual([0, 1, 2]);
    expect(identity).toBe(true);
    expect(slices).toBe(3);
  });

  it('maps by imageId, not by position, when the volume sorted the slices differently', () => {
    const stack = ['a', 'b', 'c'];
    const { map, identity } = computeLabelmapSliceMap(makeVolume(['c', 'a', 'b']), stack);

    expect(map).toEqual([1, 2, 0]);
    expect(identity).toBe(false);
  });

  it('is not the identity when the volume holds fewer slices than the stack', () => {
    // The decimated navigation volume drops slices; the labelmap has nowhere to put them.
    const stack = ['a', 'b', 'c', 'd'];
    const { map, identity } = computeLabelmapSliceMap(makeVolume(['a', 'c']), stack);

    expect(map).toEqual([0, -1, 1, -1]);
    expect(identity).toBe(false);
  });
});


describe('invertLabelmapSliceMap', () => {
  it('turns volume slice indices back into stack indices and drops the unmapped ones', () => {
    const inverse = invertLabelmapSliceMap([1, 2, 0, -1]);

    expect(inverse.get(0)).toBe(2);
    expect(inverse.get(1)).toBe(0);
    expect(inverse.get(2)).toBe(1);
    expect(inverse.has(-1)).toBe(false);
  });
});


describe('mapLabelmapBufferToVolumeOrder', () => {
  it('re-orders a stack-order buffer into the volume slice order', () => {
    const stack = ['a', 'b', 'c'];
    const volume = makeVolume(['c', 'a', 'b'], 2, 1);

    // One slice of two voxels each: a=[1,1], b=[2,2], c=[3,3]
    const buffer = Uint16Array.from([1, 1, 2, 2, 3, 3]);
    const reordered = mapLabelmapBufferToVolumeOrder(volume, stack, buffer);

    expect(Array.from(reordered)).toEqual([3, 3, 1, 1, 2, 2]);
  });

  it('leaves slices the volume does not carry empty rather than shifting the rest', () => {
    const stack = ['a', 'b', 'c'];
    const volume = makeVolume(['a', 'c'], 2, 1);

    const buffer = Uint16Array.from([1, 1, 2, 2, 3, 3]);
    const reordered = mapLabelmapBufferToVolumeOrder(volume, stack, buffer);

    expect(Array.from(reordered)).toEqual([1, 1, 3, 3]);
  });
});


describe('getSegmentsOnPixelData', () => {
  it('matches cornerstone-tools: every distinct value present, background included', () => {
    expect(getSegmentsOnPixelData(Uint16Array.from([0, 2, 2, 5]))).toEqual([0, 2, 5]);
    expect(getSegmentsOnPixelData(Uint16Array.from([3, 3]))).toEqual([3]);
  });
});


describe('planSegmentValueRemap', () => {
  const { planSegmentValueRemap } = require('./labelmapOrder.js');

  it('is empty when every declared segment number fits Uint8', () => {
    const data = [];
    data[1] = { SegmentNumber: 1 };
    data[255] = { SegmentNumber: 255 };
    expect(planSegmentValueRemap({ data })).toEqual({});
  });

  it('assigns each high segment number the lowest voxel value no declared segment uses', () => {
    const data = [];
    data[1] = { SegmentNumber: 1 };
    data[3] = { SegmentNumber: 3 };
    data[300] = { SegmentNumber: 300 };
    data[512] = { SegmentNumber: 512 };
    expect(planSegmentValueRemap({ data })).toEqual({ 300: 2, 512: 4 });
  });

  it('never assigns a value another declared segment already holds', () => {
    const data = [];
    for (let i = 1; i <= 254; i++) {
      data[i] = { SegmentNumber: i };
    }
    data[1000] = { SegmentNumber: 1000 };
    expect(planSegmentValueRemap({ data })).toEqual({ 1000: 255 });
  });

  it('throws when more than 255 segments are declared -- no valid narrowing exists', () => {
    const data = [];
    for (let i = 1; i <= 256; i++) {
      data[i + 300] = { SegmentNumber: i + 300 };
    }
    expect(() => planSegmentValueRemap({ data })).toThrow(/255/);
  });

  it('tolerates missing metadata', () => {
    expect(planSegmentValueRemap(undefined)).toEqual({});
    expect(planSegmentValueRemap({})).toEqual({});
  });
});
