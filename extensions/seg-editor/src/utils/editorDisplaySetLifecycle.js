// The editor's hold on a display set: while open it publishes its working segmentation as the
// display set's `segmentationId` (what the side panels bind to) plus its own attributes, and on
// close it gives the display set back. A display set opened from another viewer (an M3D series)
// already carried that viewer's segmentationId, which is displaced while the editor is open and
// restored on close. The viewer may also have re-published its own id by the time the editor's
// deferred close runs, in which case that id is left alone.

export const EDITOR_DISPLAY_SET_ATTRIBUTES = [
  'segEditorSegmentationId',
  'volumeSegmentationId',
  'segEditorVolumeRenderingEnabled',
  'segEditorSurfaceRenderingEnabled',
  'segEditor3dEditingEnabled',
  'segEditorLayout',
  'segEditor3dViewReset',
];

/**
 * Take the display set for the editor. Returns the segmentationId it displaced (undefined when
 * there was none), which `releaseEditorDisplaySet` restores.
 */
export function claimEditorDisplaySet(displaySet, workingSegmentationId, editorAttributes = {}) {
  const displacedSegmentationId = displaySet.segmentationId !== workingSegmentationId
    ? displaySet.segmentationId
    : undefined;

  displaySet.segmentationId = workingSegmentationId;
  displaySet.stableViewport = true;
  Object.entries(editorAttributes).forEach(([name, value]) => {
    displaySet[name] = value;
  });

  return { displacedSegmentationId };
}

/**
 * Give the display set back. `segmentationId` is restored to the displaced value only while it
 * still holds the editor's working id; an id another owner published since stays.
 */
export function releaseEditorDisplaySet(displaySet, { workingSegmentationId, displacedSegmentationId } = {}) {
  const heldByEditor = !!workingSegmentationId && displaySet.segmentationId === workingSegmentationId;
  if (heldByEditor) {
    displaySet.segmentationId = displacedSegmentationId;
  }

  EDITOR_DISPLAY_SET_ATTRIBUTES.forEach(name => {
    displaySet[name] = undefined;
  });
  displaySet.stableViewport = false;

  return { restored: heldByEditor, segmentationId: displaySet.segmentationId };
}
