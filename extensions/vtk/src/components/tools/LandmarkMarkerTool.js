// Landmark markers in the Cornerstone3D MPR slice panes. The landmarks of the visible patient-domain
// sets of the viewport's Frame of Reference are drawn where they fall against the displayed plane: in full within half the slice spacing, as a ghost up to two spacings
// off when the volume reaches them, with a caret above for a later slice and below for an earlier one
// (the slice index grows along the view plane normal). Image-domain sets are never drawn here.
// Markers are drawn without text: hovering a named one shows its name, and the landmark chosen from
// the panel has brackets (@ohif/core DICOMSR landmarks.markers; extensions/cornerstone
// utils/landmarkMarkerOverlay).
//
// Display only: it takes no input. Add it to a tool group with `addLandmarkMarkerToolToGroup`.

import OHIF from '@ohif/core';
import { utils as cextUtils } from '@ohif/extension-cornerstone';

import {
  Enums as c3dEnums, eventTarget as c3dEventTarget, getRenderingEngines, utilities as c3dUtils, VolumeViewport,
} from '@cornerstonejs/core';
import {
  AnnotationTool,
  addTool as c3dAddTool,
  state as c3dToolsState,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import { srViewOf } from './DICOMSRDisplayTool';

const landmarks = () => OHIF.DICOMSR && OHIF.DICOMSR.landmarks;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? a.map(value => value / length) : a;
};

/**
 * The extent of a volume viewport's slices along its view plane normal: { min, max, current } in mm,
 * as Cornerstone3D numbers its slices, or undefined without a volume
 */
function sliceRangeOf(viewport) {
  if (!(viewport instanceof VolumeViewport)) {
    return undefined;
  }
  try {
    const camera = viewport.getCamera();
    const { imageVolume } = c3dUtils.getTargetVolumeAndSpacingInNormalDir(viewport, camera);
    const entry = imageVolume && viewport.getActors()
      .find(actor => actor.referencedId === imageVolume.volumeId || actor.uid === imageVolume.volumeId);
    return entry ? c3dUtils.getSliceRange(entry.actor, camera.viewPlaneNormal, camera.focalPoint) : undefined;
  } catch (error) {
    return undefined;
  }
}

/** The landmarks a viewport shows, placed: { landmark, x, y (CSS pixels), slice } */
function placedLandmarks(viewport) {
  const api = landmarks();
  const view = srViewOf(viewport);
  if (!api || !api.markers || view.is3D || !view.viewPlaneNormal || !view.focalPoint) {
    return [];
  }
  const normal = unit(view.viewPlaneNormal.map(Number));
  const spacing = 2 * view.halfSpacing;
  const range = sliceRangeOf(viewport);
  const half = view.halfSpacing;

  return api.markers.viewLandmarks({ frameOfReferenceUID: viewport.getFrameOfReferenceUID() }).map((landmark) => {
    const point = landmark.point.map(Number);
    // Along the normal, positive towards the later slices
    const distance = dot([0, 1, 2].map(axis => point[axis] - view.focalPoint[axis]), normal);
    const position = range ? range.current + distance : undefined;
    const reachable = Boolean(range) && position >= range.min - half - 1e-6 && position <= range.max + half + 1e-6;
    const slice = api.markers.sliceClass(distance, spacing, reachable);
    if (slice.kind === 'none') {
      return null;
    }
    const [x, y] = viewport.worldToCanvas(point);
    return { landmark, slice, x, y };
  }).filter(placed => placed && Number.isFinite(placed.x) && Number.isFinite(placed.y));
}

/** Draw the annotation layer of every Cornerstone3D viewport again */
function renderViewports() {
  const ids = (getRenderingEngines() || []).flatMap(engine => engine.getViewports().map(viewport => viewport.id));
  if (ids.length) {
    c3dToolsUtilities.triggerAnnotationRenderForViewportIds(ids);
  }
}


// The views follow the sets, the current landmark and the brackets' frames; a disabled viewport's
// markers go with it
let following = false;
function follow() {
  const api = landmarks();
  if (following || !api || !api.markers) {
    return;
  }
  following = true;
  api.subscribe(renderViewports);
  api.markers.subscribeMarkerFrames(renderViewports);
  if (c3dEventTarget) {
    c3dEventTarget.addEventListener(c3dEnums.Events.ELEMENT_DISABLED,
      evt => cextUtils.landmarkMarkers.clearLandmarkMarkers(evt.detail && evt.detail.element));
  }
}


class LandmarkMarkerTool extends AnnotationTool {

  static toolName = 'SonadorLandmarkMarker3D';

  constructor(toolProps = {}, defaultToolProps = { configuration: {} }) {
    super(toolProps, defaultToolProps);
    follow();
  }

  // Display only: nothing is created, selected or moved here
  addNewAnnotation = () => undefined;
  cancel = () => undefined;
  handleSelectedCallback = () => undefined;
  toolSelectedCallback = () => undefined;
  isPointNearTool = () => false;
  getHandleNearImagePoint = () => undefined;

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const { viewport } = enabledElement;
    const api = landmarks();
    if (!api || !api.markers || viewport.type === c3dEnums.ViewportType.VOLUME_3D) {
      return false;
    }
    const { drawLayersAsSvg, landmarkLayers, markerRecords, setLandmarkMarkers } = cextUtils.landmarkMarkers;
    const placed = placedLandmarks(viewport);
    const hovered = setLandmarkMarkers(viewport.element, viewport.canvas, markerRecords(placed), {
      markerAt: api.markers.markerAt,
      refresh: () => c3dToolsUtilities.triggerAnnotationRenderForViewportIds([viewport.id]),
    });
    const { layers } = landmarkLayers(placed, { markers: api.markers, hovered, bracketSize: api.markers.currentBracketSize() });
    drawLayersAsSvg(svgDrawingHelper, viewport.id, layers);
    return layers.length > 0;
  };
}


/**
 * Add the landmark markers to a Cornerstone3D tool group (registering the tool globally on first
 * use), enabled.
 */
function addLandmarkMarkerToolToGroup(toolGroup) {
  if (!toolGroup) {
    return;
  }
  const { toolName } = LandmarkMarkerTool;
  if (!c3dToolsState.tools[toolName]) {
    c3dAddTool(LandmarkMarkerTool);
  }
  if (!toolGroup.hasTool(toolName)) {
    toolGroup.addTool(toolName);
  }
  toolGroup.setToolEnabled(toolName);
}


export default LandmarkMarkerTool;
export { LandmarkMarkerTool, addLandmarkMarkerToolToGroup, placedLandmarks, sliceRangeOf };
