// The editor's claim on a display set and its release: the segmentationId another viewer
// published (an M3D series) survives a round trip through the editor

import {
  EDITOR_DISPLAY_SET_ATTRIBUTES,
  claimEditorDisplaySet,
  releaseEditorDisplaySet,
} from './editorDisplaySetLifecycle';

const editorAttributes = { segEditorLayout: 'primary3D', segEditorSurfaceRenderingEnabled: true };

describe('claimEditorDisplaySet', () => {
  it('publishes the working id, marks the viewport stable and remembers what it displaced', () => {
    const displaySet = { segmentationId: 'm3d:series' };

    const { displacedSegmentationId } = claimEditorDisplaySet(displaySet, 'src::edit', editorAttributes);

    expect(displacedSegmentationId).toBe('m3d:series');
    expect(displaySet).toMatchObject({ segmentationId: 'src::edit', stableViewport: true, ...editorAttributes });
  });

  it('displaces nothing on a display set without a segmentation', () => {
    expect(claimEditorDisplaySet({}, 'src::edit').displacedSegmentationId).toBeUndefined();
  });
});

describe('releaseEditorDisplaySet', () => {
  it('restores the displaced id and clears the editor attributes', () => {
    const displaySet = {};
    const claim = claimEditorDisplaySet(displaySet, 'src::edit', editorAttributes);
    displaySet.segEditor3dViewReset = 2;

    const result = releaseEditorDisplaySet(displaySet, { workingSegmentationId: 'src::edit', ...claim });

    expect(result).toEqual({ restored: true, segmentationId: undefined });
    expect(displaySet.stableViewport).toBe(false);
    EDITOR_DISPLAY_SET_ATTRIBUTES.forEach(name => expect(displaySet[name]).toBeUndefined());
  });

  it('gives an M3D series its own segmentation back', () => {
    const displaySet = { segmentationId: 'm3d:series' };
    const claim = claimEditorDisplaySet(displaySet, 'src::edit', editorAttributes);

    releaseEditorDisplaySet(displaySet, { workingSegmentationId: 'src::edit', ...claim });

    expect(displaySet.segmentationId).toBe('m3d:series');
  });

  it('leaves an id another viewer published after the claim', () => {
    const displaySet = { segmentationId: 'm3d:series' };
    const claim = claimEditorDisplaySet(displaySet, 'src::edit', editorAttributes);
    displaySet.segmentationId = 'm3d:series';   // the remounted M3D viewport re-published first

    const result = releaseEditorDisplaySet(displaySet, { workingSegmentationId: 'src::edit', ...claim });

    expect(result.restored).toBe(false);
    expect(displaySet.segmentationId).toBe('m3d:series');
    expect(displaySet.segEditorLayout).toBeUndefined();
  });
});
