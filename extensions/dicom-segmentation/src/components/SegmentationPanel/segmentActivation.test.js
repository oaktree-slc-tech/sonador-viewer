// Segment selection in the Segmentation panel: the clicked segment's layer is activated before the
// "already active" test, the layer index is a number, and a segment no slice holds selects without
// a jump.

import {
  activateSegment, findSegmentHolder, getSegmentFrameIndices, getSegmentJumpIndex,
} from './segmentActivation';

// An overlapping SEG imported as layers 0 and 1, plus an unrelated SEG on layer 2 that also has a
// segment 1
function makeDisplaySets() {
  return [
    { displaySetInstanceUID: 'ct' },
    {
      displaySetInstanceUID: 'seg-overlap',
      hasOverlapping: true,
      originLabelMapIndex: 0,
      labelmapSegments: { 0: [1], 1: [2] },
    },
    {
      displaySetInstanceUID: 'seg-other',
      hasOverlapping: false,
      labelmapIndex: 2,
      labelmapSegments: { 2: [1, 3] },
    },
  ];
}

function makeBrushStackState(activeLabelmapIndex = 0) {
  return {
    activeLabelmapIndex,
    labelmaps3D: [
      { activeSegmentIndex: 1, labelmaps2D: [] },
      { activeSegmentIndex: 0, labelmaps2D: [] },
      { activeSegmentIndex: 1, labelmaps2D: [] },
    ],
  };
}

describe('findSegmentHolder', () => {
  it('returns the holding layer as a number', () => {
    const holder = findSegmentHolder(makeDisplaySets(), 2, 'seg-overlap');

    expect(holder).toEqual({ labelmapIndex: 1, selectedSegmentation: 0 });
    expect(typeof holder.labelmapIndex).toBe('number');
  });

  it('lists a non-overlapping SEG under its own layer', () => {
    expect(findSegmentHolder(makeDisplaySets(), 3, 'seg-other'))
      .toEqual({ labelmapIndex: 2, selectedSegmentation: 2 });
  });

  it('keeps to the named SEG when segment numbers repeat across SEGs', () => {
    expect(findSegmentHolder(makeDisplaySets(), 1, 'seg-overlap').labelmapIndex).toBe(0);
    expect(findSegmentHolder(makeDisplaySets(), 1, 'seg-other').labelmapIndex).toBe(2);
  });

  it('returns null when no layer holds the segment', () => {
    expect(findSegmentHolder(makeDisplaySets(), 9, 'seg-overlap')).toBeNull();
  });
});

describe('activateSegment', () => {
  it('writes the active segment on the holding layer, not the previously active one', () => {
    const brushStackState = makeBrushStackState(0);
    const holder = findSegmentHolder(makeDisplaySets(), 2, 'seg-overlap');

    const result = activateSegment(brushStackState, 2, holder);

    expect(result).toEqual({ changed: true, labelmapIndex: 1 });
    expect(brushStackState.activeLabelmapIndex).toBe(1);
    expect(brushStackState.labelmaps3D[1].activeSegmentIndex).toBe(2);
    expect(brushStackState.labelmaps3D[0].activeSegmentIndex).toBe(1);
  });

  it('switches layers when the clicked segment equals the current layer\'s active segment number', () => {
    // Segment 1 of the other SEG: layer 0's active segment is also 1
    const brushStackState = makeBrushStackState(0);
    const holder = findSegmentHolder(makeDisplaySets(), 1, 'seg-other');

    expect(activateSegment(brushStackState, 1, holder).changed).toBe(true);
    expect(brushStackState.activeLabelmapIndex).toBe(2);
  });

  it('reports no change when the segment is already active on its own layer', () => {
    const brushStackState = makeBrushStackState(1);
    brushStackState.labelmaps3D[1].activeSegmentIndex = 2;
    const holder = findSegmentHolder(makeDisplaySets(), 2, 'seg-overlap');

    expect(activateSegment(brushStackState, 2, holder)).toEqual({ changed: false, labelmapIndex: 1 });
  });

  it('activates the segment on the current layer when no layer holds it', () => {
    const brushStackState = makeBrushStackState(0);

    expect(activateSegment(brushStackState, 5, null)).toEqual({ changed: true, labelmapIndex: 0 });
    expect(brushStackState.labelmaps3D[0].activeSegmentIndex).toBe(5);
  });

  it('stores a numeric layer index even when the module held a string', () => {
    const brushStackState = makeBrushStackState('0');

    activateSegment(brushStackState, 2, findSegmentHolder(makeDisplaySets(), 2, 'seg-overlap'));
    expect(brushStackState.activeLabelmapIndex).toBe(1);
  });
});

describe('getSegmentJumpIndex', () => {
  const labelmaps2D = [];
  labelmaps2D[2] = { segmentsOnLabelmap: [0, 1] };
  labelmaps2D[3] = { segmentsOnLabelmap: [1, 2] };
  labelmaps2D[4] = { segmentsOnLabelmap: [1] };
  labelmaps2D[5] = undefined;

  it('picks the holding slice nearest the middle of the segment', () => {
    expect(getSegmentFrameIndices(labelmaps2D, 1)).toEqual([2, 3, 4]);
    expect(getSegmentJumpIndex(labelmaps2D, 1)).toBe(3);
    expect(getSegmentJumpIndex(labelmaps2D, 2)).toBe(3);
  });

  it('returns undefined, without throwing, when no slice holds the segment', () => {
    expect(() => getSegmentJumpIndex(labelmaps2D, 7)).not.toThrow();
    expect(getSegmentJumpIndex(labelmaps2D, 7)).toBeUndefined();
    expect(getSegmentJumpIndex([], 1)).toBeUndefined();
    expect(getSegmentJumpIndex(undefined, 1)).toBeUndefined();
  });
});
