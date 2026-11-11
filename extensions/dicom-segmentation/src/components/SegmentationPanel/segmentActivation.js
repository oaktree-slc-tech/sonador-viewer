// Segment selection for the Segmentation panel: which labelmap layer holds a clicked segment,
// activating it there, and the slice to jump to. Kept free of React and of the cornerstone-tools
// module so the rules can be tested on plain state.


export function findSegmentHolder(displaySets, segmentIndex, segmentationId) {
  // The labelmap layer that holds `segmentIndex`, from the SEG display sets' per-layer membership.
  //
  // @input displaySets (object[]): the study's display sets
  // @input segmentIndex (num): the clicked segment
  // @input segmentationId (str): restricts the search to this displaySetInstanceUID, so equal
  //   segment numbers in different SEGs do not select each other's layers
  // @returns { labelmapIndex, selectedSegmentation } as numbers, or null when no layer holds it.
  //   `selectedSegmentation` is the value the labelmap dropdown lists for the SEG: an overlapping
  //   SEG is listed once, under its first layer.

  let holder = null;

  (displaySets || []).forEach(displaySet => {
    if (segmentationId && displaySet.displaySetInstanceUID !== segmentationId) {
      return;
    }
    if (!displaySet.labelmapSegments) {
      return;
    }

    Object.keys(displaySet.labelmapSegments).forEach(key => {
      const segments = displaySet.labelmapSegments[key] || [];
      if (!segments.includes(segmentIndex)) {
        return;
      }
      const labelmapIndex = Number(key);
      holder = {
        labelmapIndex,
        selectedSegmentation: displaySet.hasOverlapping === true
          ? Number(displaySet.originLabelMapIndex)
          : labelmapIndex,
      };
    });
  });

  return holder;
}


export function activateSegment(brushStackState, segmentIndex, holder) {
  // Make `segmentIndex` the active segment, on the layer that holds it. The layer switch comes
  // first: the "already active" test is only meaningful on the layer the segment lives on.
  //
  // @returns { changed, labelmapIndex }: `changed` is false when the segment was already active on
  //   its own layer, i.e. nothing needs redrawing

  if (!brushStackState) {
    return { changed: false, labelmapIndex: undefined };
  }

  const previousLabelmapIndex = Number(brushStackState.activeLabelmapIndex);
  const labelmapIndex = holder ? holder.labelmapIndex : previousLabelmapIndex;
  brushStackState.activeLabelmapIndex = labelmapIndex;

  const labelmap3D = (brushStackState.labelmaps3D || [])[labelmapIndex];
  const layerChanged = labelmapIndex !== previousLabelmapIndex;

  if (!labelmap3D) {
    return { changed: layerChanged, labelmapIndex };
  }

  if (labelmap3D.activeSegmentIndex === segmentIndex && !layerChanged) {
    return { changed: false, labelmapIndex };
  }

  labelmap3D.activeSegmentIndex = segmentIndex;
  return { changed: true, labelmapIndex };
}


export function getSegmentFrameIndices(labelmaps2D, segmentNumber) {
  // The slice indices whose 2D labelmap lists `segmentNumber`. `labelmaps2D` is sparse.
  const indices = [];
  (labelmaps2D || []).forEach((labelmap2D, index) => {
    if (labelmap2D && (labelmap2D.segmentsOnLabelmap || []).includes(segmentNumber)) {
      indices.push(index);
    }
  });
  return indices;
}


export function getSegmentJumpIndex(labelmaps2D, segmentNumber) {
  // The slice to jump to for a segment: the one holding it nearest the middle of its extent, or
  // undefined when no slice holds it.
  const indices = getSegmentFrameIndices(labelmaps2D, segmentNumber);
  if (!indices.length) {
    return undefined;
  }

  const average = indices.reduce((a, b) => a + b, 0) / indices.length;
  return indices.reduce((prev, curr) => (
    Math.abs(curr - average) < Math.abs(prev - average) ? curr : prev
  ));
}
