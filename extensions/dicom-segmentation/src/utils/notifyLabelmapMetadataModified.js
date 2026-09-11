/**
 * Announce that legacy labelmap metadata was changed in place.
 *
 * `SegmentationPanel` writes `labelmap3D.activeSegmentIndex` and `labelmap3D.segmentsHidden`
 * directly on the cornerstone-tools segmentation module and then repaints the canvases. The module
 * is a plain object, so nothing observes those writes: cornerstone-tools raises no event for them,
 * and anything holding a second representation of the same labelmap has no way to notice.
 *
 * Since Cornerstone3D owns the segmentation and renders it alongside the classic viewport, that
 * state has to travel. This raises a document-level event for it -- the same mechanism
 * `loadSegmentation.js` uses for `extensiondicomsegmentationsegloaded`, but an event of its own,
 * because these carry different meanings and different payloads. Using a document event rather than
 * a direct call keeps `dicom-segmentation` and `vtk` from depending on one another in either
 * direction. The subscriber is the labelmap bridge
 * (`extensions/vtk/src/utils/labelmapBridge.js`), which mirrors the new values into the canonical
 * Cornerstone3D segmentation state.
 *
 * No identity is carried: the bridge re-reads every labelmap it has registered, which is metadata
 * only -- no voxel work -- and there are at most a handful.
 */
export const LABELMAP_METADATA_MODIFIED = 'extensiondicomsegmentationlabelmapmetadatamodified';

export default function notifyLabelmapMetadataModified() {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') {
    return;
  }

  document.dispatchEvent(new CustomEvent(LABELMAP_METADATA_MODIFIED));
}
