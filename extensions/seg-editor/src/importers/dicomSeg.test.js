// A DICOM SEG read into a labelled grid from its own frame geometry

import dcmjs from 'dcmjs';

import {
  asSequence,
  createStudyFrameResolver,
  parseDicomSeg,
  segmentsFromSegmentSequence,
} from './dicomSeg';

const { BitArray, Colors } = dcmjs.data;

const SEG_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.66.4';
const RED_LAB = Colors.rgb2DICOMLAB([1, 0, 0]);

// A 3 x 2 pixel SEG: frame pixels are given as bits, rows first
function makeSeg({ frames, segments, shared, bitsAllocated = 1, extra = {} }) {
  const pixels = Uint8Array.from(frames.flatMap(frame => frame.pixels));
  const pixelData = bitsAllocated === 1
    ? BitArray.pack(pixels).buffer
    : Uint8Array.from(pixels.map(bit => (bit ? 255 : 0))).buffer;
  return {
    SOPClassUID: SEG_SOP_CLASS,
    Rows: 2,
    Columns: 3,
    NumberOfFrames: frames.length,
    BitsAllocated: bitsAllocated,
    SegmentSequence: segments,
    SharedFunctionalGroupsSequence: shared || {
      PlaneOrientationSequence: { ImageOrientationPatient: [1, 0, 0, 0, 1, 0] },
      PixelMeasuresSequence: { PixelSpacing: [0.5, 0.25], SpacingBetweenSlices: 2 },
    },
    PerFrameFunctionalGroupsSequence: frames.map(frame => ({
      ...(frame.position ? { PlanePositionSequence: { ImagePositionPatient: frame.position } } : {}),
      SegmentIdentificationSequence: { ReferencedSegmentNumber: frame.segment },
      ...(frame.referenced ? {
        DerivationImageSequence: { SourceImageSequence: { ReferencedSOPInstanceUID: frame.referenced } },
      } : {}),
    })),
    PixelData: pixelData,
    ...extra,
  };
}

describe('asSequence', () => {
  it('lists a naturalized one-item sequence, an array and nothing', () => {
    expect(asSequence({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asSequence([1, 2])).toEqual([1, 2]);
    expect(asSequence(undefined)).toEqual([]);
  });
});

describe('segmentsFromSegmentSequence', () => {
  it('names and colours the declared segments, by number', () => {
    const segments = segmentsFromSegmentSequence({
      SegmentSequence: [
        { SegmentNumber: 2 },
        { SegmentNumber: 1, SegmentLabel: 'Liver', RecommendedDisplayCIELabValue: RED_LAB },
      ],
    });
    expect(segments.map(s => s.value)).toEqual([1, 2]);
    expect(segments[0].label).toBe('Liver');
    expect(segments[0].color.map(c => Math.round(c / 10))).toEqual([26, 0, 0]);
    expect(segments[1]).toEqual({ value: 2, label: 'segment-2' });
  });
});

describe('parseDicomSeg', () => {
  it('places the frames by position on a grid at the smallest frame spacing, later frames winning', () => {
    const seg = makeSeg({
      segments: [{ SegmentNumber: 1, SegmentLabel: 'Liver' }, { SegmentNumber: 2 }, { SegmentNumber: 3, SegmentLabel: 'Unused' }],
      frames: [
        { segment: 1, position: [10, 20, 30], pixels: [1, 1, 0, 0, 0, 0] },
        { segment: 1, position: [10, 20, 34], pixels: [0, 0, 0, 0, 0, 1] },
        { segment: 2, position: [10, 20, 32], pixels: [1, 0, 0, 0, 0, 0] },
        { segment: 2, position: [10, 20, 30], pixels: [1, 0, 0, 0, 0, 0] },
      ],
    });

    const { grid, segments, overlapVoxels, frameCount } = parseDicomSeg(seg);

    expect(frameCount).toBe(4);
    expect(grid.dimensions).toEqual([3, 2, 3]);
    expect(grid.origin).toEqual([10, 20, 30]);
    expect(grid.spacing).toEqual([0.25, 0.5, 2]);
    expect(grid.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(grid.data)).toEqual([
      2, 1, 0, 0, 0, 0,   // z = 30: segment 2 over segment 1 at the first pixel
      2, 0, 0, 0, 0, 0,   // z = 32
      0, 0, 0, 0, 0, 1,   // z = 34
    ]);
    expect(overlapVoxels).toBe(1);
    // Declared segments that have frames, in number order
    expect(segments).toEqual([{ value: 1, label: 'Liver' }, { value: 2, label: 'segment-2' }]);
  });

  it('follows an oblique orientation and falls back to the slice spacing for a single frame', () => {
    const seg = makeSeg({
      segments: { SegmentNumber: 1 },
      shared: {
        PlaneOrientationSequence: { ImageOrientationPatient: [0, 1, 0, -1, 0, 0] },
        PixelMeasuresSequence: { PixelSpacing: [1, 1], SliceThickness: 3 },
      },
      frames: [{ segment: 1, position: [5, 5, 5], pixels: [0, 0, 0, 0, 0, 1] }],
    });

    const { grid } = parseDicomSeg(seg);

    expect(grid.dimensions).toEqual([3, 2, 1]);
    expect(grid.direction).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    expect(grid.spacing).toEqual([1, 1, 3]);
    expect(grid.data[5]).toBe(1);
  });

  it('reads fractional (8-bit) pixels at half the maximum', () => {
    const seg = makeSeg({
      segments: { SegmentNumber: 1 },
      bitsAllocated: 8,
      frames: [{ segment: 1, position: [0, 0, 0], pixels: [1, 0, 1, 0, 0, 0] }],
      extra: { MaximumFractionalValue: 255 },
    });
    expect(Array.from(parseDicomSeg(seg).grid.data)).toEqual([1, 0, 1, 0, 0, 0]);
  });

  it('takes a frame\'s position from the referenced image when the SEG has none', () => {
    const seg = makeSeg({
      segments: { SegmentNumber: 1 },
      frames: [
        { segment: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0, 0, 0] },
        { segment: 1, referenced: 'sop-2', pixels: [0, 1, 0, 0, 0, 0] },
      ],
    });
    const resolveReferencedFrame = jest.fn(() => ({ ImagePositionPatient: [0, 0, 2] }));

    const { grid } = parseDicomSeg(seg, { resolveReferencedFrame });

    expect(resolveReferencedFrame).toHaveBeenCalledWith({ sopInstanceUID: 'sop-2', frameNumber: undefined });
    expect(grid.dimensions).toEqual([3, 2, 2]);
    expect(grid.data[6 + 1]).toBe(1);

    expect(() => parseDicomSeg(seg)).toThrow(/images it references are not available/);
    expect(() => parseDicomSeg(seg, { resolveReferencedFrame: () => undefined })).toThrow(/not available/);
  });

  it('accepts gaps between frames but refuses frames off the slice lattice or shifted in the plane', () => {
    const frame = (position, segment = 1) => ({ segment, position, pixels: [1, 0, 0, 0, 0, 0] });

    // 0, 2, 6 mm: a 2 mm lattice with one slice missing
    const gapped = parseDicomSeg(makeSeg({ segments: { SegmentNumber: 1 }, frames: [frame([0, 0, 0]), frame([0, 0, 2]), frame([0, 0, 6])] }));
    expect(gapped.grid.dimensions).toEqual([3, 2, 4]);
    expect(Array.from(gapped.grid.data).filter(Boolean)).toHaveLength(3);
    expect(gapped.grid.data[6 * 2]).toBe(0);   // the missing slice stays empty

    // 0, 2, 5 mm: 5 is not on the 2 mm lattice
    expect(() => parseDicomSeg(makeSeg({ segments: { SegmentNumber: 1 }, frames: [frame([0, 0, 0]), frame([0, 0, 2]), frame([0, 0, 5])] })))
      .toThrow(/not evenly spaced/);

    // A frame displaced along the row axis
    expect(() => parseDicomSeg(makeSeg({ segments: { SegmentNumber: 1 }, frames: [frame([0, 0, 0]), frame([10, 0, 1])] })))
      .toThrow(/shifted against each other/);
  });

  it('refuses what it cannot place', () => {
    expect(() => parseDicomSeg({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2' })).toThrow('Not a DICOM Segmentation object');

    const mixed = makeSeg({
      segments: { SegmentNumber: 1 },
      frames: [
        { segment: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0, 0, 0] },
        { segment: 1, position: [0, 0, 2], pixels: [1, 0, 0, 0, 0, 0] },
      ],
    });
    mixed.PerFrameFunctionalGroupsSequence[1].PlaneOrientationSequence = { ImageOrientationPatient: [0, 1, 0, -1, 0, 0] };
    expect(() => parseDicomSeg(mixed)).toThrow(/different orientations/);

    const noFrames = makeSeg({ segments: { SegmentNumber: 1 }, frames: [] });
    expect(() => parseDicomSeg(noFrames)).toThrow('The segmentation has no frames');
  });
});

describe('createStudyFrameResolver', () => {
  it('finds an instance\'s plane by SOP Instance UID across the studies\' display sets', () => {
    const image = metadata => ({ getData: () => ({ metadata }) });
    const studies = [
      { getDisplaySets: () => [{ images: [image({ SOPInstanceUID: 'a', ImagePositionPatient: [1, 2, 3], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1] })] }] },
      { displaySets: [{ images: [image({ SOPInstanceUID: 'b', ImagePositionPatient: [4, 5, 6] })] }, { images: undefined }] },
    ];
    const resolve = createStudyFrameResolver(studies);

    expect(resolve({ sopInstanceUID: 'a' })).toEqual({
      ImagePositionPatient: [1, 2, 3], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1],
    });
    expect(resolve({ sopInstanceUID: 'b' }).ImagePositionPatient).toEqual([4, 5, 6]);
    expect(resolve({ sopInstanceUID: 'c' })).toBeUndefined();
    expect(createStudyFrameResolver()({ sopInstanceUID: 'a' })).toBeUndefined();
  });
});
