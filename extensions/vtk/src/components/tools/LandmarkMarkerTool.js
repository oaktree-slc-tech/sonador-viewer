// Landmark markers in the Cornerstone3D views: the MPR slice panes and the 3D volume view. The
// landmarks of the visible patient-domain sets of the viewport's Frame of Reference are drawn;
// image-domain sets never are. Markers are drawn without text: hovering a named one shows its name,
// and the landmark chosen from the panel has brackets (@ohif/core DICOMSR landmarks.markers and
// landmarks.volumeView; extensions/cornerstone utils/landmarkMarkerOverlay).
//
// - A slice pane draws a landmark where it falls against the displayed plane: in full within half the
//   slice spacing, as a ghost up to two spacings off when the volume reaches it, with a caret above
//   for a later slice and below for an earlier one (the slice index grows along the view plane normal).
// - The 3D volume view draws every landmark, on top of the volume, faded by its depth along the
//   viewing direction (100 % nearest to 50 % farthest, across every landmark in view); the hovered and
//   the chosen marker are at full strength, and of two overlapping markers the nearer answers. The
//   chosen landmark outside the view is marked at the nearest edge with its brackets and a chevron
//   pointing toward it. With "Follow selected landmark" on, each landmark chosen from the panel turns
//   the camera to face it (an orbit about the focal point, zoom unchanged), and turning it on turns to
//   the current landmark at once.
//
// Display only: it takes no input. Add it to a tool group with `addLandmarkMarkerToolToGroup`.

import OHIF from '@ohif/core';
import { utils as cextUtils } from '@ohif/extension-cornerstone';

import {
  Enums as c3dEnums, eventTarget as c3dEventTarget, getRenderingEngines, utilities as c3dUtils, VolumeViewport,
} from '@cornerstonejs/core';
import {
  AnnotationTool,
  ToolGroupManager as c3dToolGroupManager,
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

/**
 * The landmarks a 3D volume view shows: those in view, placed with their depth and strength, the
 * nearest last so that it is drawn on top; and the edge mark of the chosen landmark when it is
 * outside the view: { x, y, angle, landmark }, else null.
 */
function volumeLandmarks(viewport) {
  const api = landmarks();
  const camera = viewport.getCamera();
  const { volumeView } = api;
  const canvas = viewport.canvas || {};
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // A perspective camera projects nothing behind it
  const perspective = camera.parallelProjection === false;
  const entries = api.markers.viewLandmarks({ frameOfReferenceUID: viewport.getFrameOfReferenceUID() }).map((landmark) => {
    const point = landmark.point.map(Number);
    const depth = volumeView.depthAlong(point, camera);
    const behind = perspective && !(depth > 0);
    const [x, y] = behind ? [NaN, NaN] : viewport.worldToCanvas(point);
    return { landmark, point, x, y, depth, inView: !behind && volumeView.isInView({ x, y }, width, height) };
  });

  const shown = entries.filter(({ inView }) => inView);
  const strengths = volumeView.depthStrengths(shown.map(({ depth }) => depth));
  const placed = shown
    .map(({ landmark, x, y, depth }, i) => ({ landmark, x, y, depth, strength: strengths[i], slice: { kind: 'full' } }))
    .sort((a, b) => b.depth - a.depth);

  const chosen = entries.find(({ landmark, inView }) => landmark.current && !inView);
  const edge = chosen && volumeView.edgePlacement({
    projected: Number.isFinite(chosen.x) && Number.isFinite(chosen.y) ? { x: chosen.x, y: chosen.y } : null,
    direction: volumeView.screenDirection(chosen.point, camera),
    width,
    height,
  });
  return { placed, edge: edge ? { ...edge, landmark: chosen.landmark } : null };
}

/** Whether a viewport draws the landmark markers: its tool group holds this tool, not disabled */
function drawsLandmarks(viewport) {
  const group = c3dToolGroupManager && c3dToolGroupManager.getToolGroupForViewport
    ? c3dToolGroupManager.getToolGroupForViewport(viewport.id, viewport.renderingEngineId) : undefined;
  const { toolName } = LandmarkMarkerTool;
  if (!group || !group.hasTool || !group.hasTool(toolName)) {
    return false;
  }
  const options = group.toolOptions && group.toolOptions[toolName];
  return !options || options.mode !== 'Disabled';
}

/**
 * Turn every 3D volume view that draws the landmarks (the volume viewer's: other features' 3D views,
 * the Segmentation Editor's among them, keep their cameras) of the current landmark's Frame of
 * Reference to face it: an orbit about the focal point, zoom and focal point unchanged. A landmark at
 * the focal point gives no direction and the camera stays; an image-domain landmark turns nothing.
 * Returns the ids of the views turned.
 */
function turnVolumeViewsToLandmark(current) {
  const api = landmarks();
  const set = current && current.entry && current.entry.set;
  if (!api || !api.volumeView || !set || set.domain !== 'patient' || !current.landmark) {
    return [];
  }
  const turned = [];
  (getRenderingEngines() || []).forEach(engine => engine.getViewports().forEach((viewport) => {
    if (viewport.type !== c3dEnums.ViewportType.VOLUME_3D || viewport.getFrameOfReferenceUID() !== set.frameOfReferenceUID
      || !drawsLandmarks(viewport)) {
      return;
    }
    const camera = api.volumeView.orbitToward(viewport.getCamera(), current.landmark.point);
    if (!camera) {
      return;
    }
    viewport.setCamera(camera);
    viewport.render();
    turned.push(viewport.id);
  }));
  return turned;
}

/** Draw the annotation layer of every Cornerstone3D viewport again */
function renderViewports() {
  const ids = (getRenderingEngines() || []).flatMap(engine => engine.getViewports().map(viewport => viewport.id));
  if (ids.length) {
    c3dToolsUtilities.triggerAnnotationRenderForViewportIds(ids);
  }
}


// The views follow the sets, the current landmark and the brackets' frames; with "Follow selected
// landmark" on, the 3D views turn to each landmark chosen, and to the current one when it is turned
// on (not when it is read at startup); a disabled viewport's markers go with it
let following = false;
function follow() {
  const api = landmarks();
  if (following || !api || !api.markers) {
    return;
  }
  following = true;
  api.subscribe(({ type } = {}) => {
    if (type === api.EVENTS.SELECTION_CHANGED && api.getFollowSelectedLandmark && api.getFollowSelectedLandmark()) {
      turnVolumeViewsToLandmark(api.getCurrentLandmark());
    }
    renderViewports();
  });
  if (api.subscribeFollowSelectedLandmark) {
    api.subscribeFollowSelectedLandmark((on, { hydrated }) => {
      if (on && !hydrated && turnVolumeViewsToLandmark(api.getCurrentLandmark()).length) {
        renderViewports();
      }
    });
  }
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
    if (!api || !api.markers) {
      return false;
    }
    const is3D = viewport.type === c3dEnums.ViewportType.VOLUME_3D;
    if (is3D && !api.volumeView) {
      return false;
    }
    const { drawLayersAsSvg, landmarkLayers, markerRecords, setLandmarkMarkers } = cextUtils.landmarkMarkers;
    const { placed, edge } = is3D ? volumeLandmarks(viewport) : { placed: placedLandmarks(viewport), edge: null };
    const hovered = setLandmarkMarkers(viewport.element, viewport.canvas, markerRecords(placed), {
      markerAt: api.markers.markerAt,
      refresh: () => c3dToolsUtilities.triggerAnnotationRenderForViewportIds([viewport.id]),
    });
    const bracketSize = api.markers.currentBracketSize();
    // The chosen landmark outside the view: its brackets at the nearest edge, the chevron inside,
    // below a hovered name plate as every marker is
    const marks = edge ? [[`${edge.landmark.key}::edge`, [
      ...api.markers.bracketPrimitives(edge, bracketSize),
      ...api.volumeView.chevronPrimitives(edge, edge.angle, edge.landmark.line),
    ]]] : [];
    const { layers } = landmarkLayers(placed, { markers: api.markers, hovered, bracketSize, marks });
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
export {
  LandmarkMarkerTool, addLandmarkMarkerToolToGroup, placedLandmarks, sliceRangeOf, turnVolumeViewsToLandmark, volumeLandmarks,
};
