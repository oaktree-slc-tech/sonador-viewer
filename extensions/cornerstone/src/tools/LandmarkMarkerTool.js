// Landmark markers in the classic viewport. The landmarks of the visible sets of the displayed
// image's Frame of Reference are drawn where they fall against the image: in full within half the
// stack's slice spacing, as a ghost up to two spacings off when the stack reaches them, with a caret
// set by the stack's order (@ohif/core DICOMSR landmarks.markers). An image-domain set is drawn on its
// own instance and frame only, without ghosts. Markers are drawn without text: hovering a named one
// shows its name, and the landmark chosen from the panel has brackets.
//
// Enabled on every image (init.js): it draws, and takes no input.

import cornerstone from 'cornerstone-core';
import { importInternal, getToolState } from 'cornerstone-tools';

import OHIF, { DicomMetadataStore } from '@ohif/core';

import imagePlaneOf from './imagePlaneOf';
import { signedDistanceFromImagePlane } from '../utils/arrowMarkers';
import { imageHoldingPoint, stackSpacing } from '../utils/landmarkStack';
import {
  clearLandmarkMarkers, drawOnCanvas, landmarkLayers, markerRecords, setLandmarkMarkers,
} from '../utils/landmarkMarkerOverlay';

const BaseTool = importInternal('base/BaseTool');
const getNewContext = importInternal('drawing/getNewContext');

const TOOL_NAME = 'SonadorLandmarkMarker';

const landmarks = () => OHIF.DICOMSR && OHIF.DICOMSR.landmarks;

/** The active display sets, or undefined when the display set service is not available */
function activeDisplaySets() {
  const api = OHIF.display && OHIF.display.DisplaySetApi && OHIF.display.DisplaySetApi.Instance;
  const service = api && api.displaySetService;
  return service ? service.activeDisplaySets || [] : undefined;
}

const frameNumberOf = (record) => {
  const frame = record ? Number(record.frameNumber) : NaN;
  return Number.isInteger(frame) && frame >= 1 ? frame : undefined;
};

/**
 * The frame number (1-based) an image id shows: its metadata's (the frame module, else the frame
 * the Viewer's metadata provider resolved for the instance), else the frame its URL names
 * (`/frames/N`, 1-based; `frame=N`, the stack's 0-based frame index), else 1.
 */
function frameNumberOfImageId(imageId) {
  for (const type of ['frameModule', 'instance']) {
    try {
      const frame = frameNumberOf(cornerstone.metaData.get(type, imageId));
      if (frame) {
        return frame;
      }
    } catch (error) {
      // the next source then
    }
  }
  const text = String(imageId || '');
  const rendered = text.match(/\/frames\/(\d+)/);
  if (rendered) {
    return Number(rendered[1]);
  }
  const indexed = text.match(/[?&]frame=(\d+)/);
  return indexed ? Number(indexed[1]) + 1 : 1;
}

function sopInstanceUIDOf(imageId) {
  try {
    return cornerstone.metaData.get('SOPInstanceUID', imageId);
  } catch (error) {
    return undefined;
  }
}

// The planes, spacing and order of a stack, kept while its image ids are the same
const stacks = new WeakMap();
function stackGeometry(imageIds) {
  let geometry = stacks.get(imageIds);
  if (!geometry) {
    const planes = imageIds.map(imagePlaneOf);
    geometry = { planes, spacing: stackSpacing(planes) || 1 };
    stacks.set(imageIds, geometry);
  }
  return geometry;
}

/**
 * The sign that turns a distance from the displayed plane into one along the stack's order:
 * positive towards its later images
 */
function laterSign(planes, index, plane) {
  const offset = (other) => {
    const neighbour = planes[other];
    return neighbour ? signedDistanceFromImagePlane(plane, neighbour.imagePositionPatient) : NaN;
  };
  const after = offset(index + 1);
  if (Number.isFinite(after) && after !== 0) {
    return Math.sign(after);
  }
  const before = offset(index - 1);
  return Number.isFinite(before) && before !== 0 ? -Math.sign(before) : 1;
}

/**
 * The landmarks the displayed image shows, placed: { landmark, x, y (CSS pixels), slice }
 *
 * @param {HTMLElement} element
 * @param {object} image - the displayed cornerstone image
 * @param {number} scale - canvas pixels per CSS pixel
 */
function placedLandmarks(element, image, scale) {
  const api = landmarks();
  if (!api || !api.markers) {
    return [];
  }
  // Patient-domain landmarks need the image's place in the patient; image-domain ones do not
  const plane = imagePlaneOf(image.imageId);
  let stack;
  if (plane) {
    const data = (getToolState(element, 'stack') || {}).data;
    const { imageIds = [image.imageId] } = (data && data[0]) || {};
    const { planes, spacing } = stackGeometry(imageIds);
    stack = { planes, spacing, sign: laterSign(planes, Math.max(0, imageIds.indexOf(image.imageId)), plane) };
  }

  const shown = api.markers.viewLandmarks({
    frameOfReferenceUID: plane ? plane.frameOfReferenceUID : undefined,
    image: { sopInstanceUID: sopInstanceUIDOf(image.imageId), frameNumber: frameNumberOfImageId(image.imageId) },
    store: DicomMetadataStore,
    displaySets: activeDisplaySets(),
  });
  const toCss = (x, y) => {
    const point = cornerstone.pixelToCanvas(element, { x, y });
    return { x: point.x / scale, y: point.y / scale };
  };

  return shown.map((landmark) => {
    if (landmark.domain === 'image') {
      const [column, row] = landmark.point;
      return { landmark, slice: { kind: 'full' }, ...toCss(column, row) };
    }
    if (!stack) {
      return null;
    }
    const distance = signedDistanceFromImagePlane(plane, landmark.point) * stack.sign;
    const slice = api.markers.sliceClass(distance, stack.spacing, imageHoldingPoint(stack.planes, landmark.point) >= 0);
    if (slice.kind === 'none') {
      return null;
    }
    const [x, y] = OHIF.DICOMSR.angleGeometry.patientToImage(plane, landmark.point);
    return { landmark, slice, ...toCss(x, y) };
  }).filter(placed => placed && Number.isFinite(placed.x) && Number.isFinite(placed.y));
}

/** Draw every enabled classic viewport again (a marker hovered, a set shown or hidden, a landmark chosen) */
function refreshViewports(element) {
  const elements = element ? [{ element, image: true }] : (cornerstone.getEnabledElements ? cornerstone.getEnabledElements() : []);
  elements.forEach((enabled) => {
    if (enabled.image) {
      try {
        cornerstone.updateImage(enabled.element);
      } catch (error) {
        // an element that is no longer enabled
      }
    }
  });
}


// The viewports follow the sets (listed, shown, hidden), the current landmark and the brackets' frames;
// a disabled element's markers go with it
let following = false;
function follow() {
  const api = landmarks();
  if (following || !api || !api.markers) {
    return;
  }
  following = true;
  api.subscribe(() => refreshViewports());
  api.markers.subscribeMarkerFrames(() => refreshViewports());
  if (cornerstone.events) {
    cornerstone.events.addEventListener(cornerstone.EVENTS.ELEMENT_DISABLED, evt => clearLandmarkMarkers(evt.detail && evt.detail.element));
  }
}


export default class LandmarkMarkerTool extends BaseTool {
  constructor(props = {}) {
    super({ name: TOOL_NAME, mixins: [], ...props });
    follow();
  }

  renderToolData(evt) {
    const { element, image, canvasContext } = evt.detail;
    const canvas = canvasContext && canvasContext.canvas;
    const api = landmarks();
    if (!canvas || !image || !api || !api.markers) {
      return;
    }
    const scale = canvas.width / (canvas.clientWidth || canvas.width) || 1;
    const placed = placedLandmarks(element, image, scale);
    const hovered = setLandmarkMarkers(element, canvas, markerRecords(placed), { markerAt: api.markers.markerAt, refresh: refreshViewports });
    const { layers } = landmarkLayers(placed, { markers: api.markers, hovered, bracketSize: api.markers.currentBracketSize() });
    if (layers.length) {
      const context = getNewContext(canvas);
      layers.forEach(([, primitives]) => drawOnCanvas(context, primitives, scale));
    }
  }
}

export { TOOL_NAME as LANDMARK_MARKER_TOOL, LandmarkMarkerTool, frameNumberOfImageId, laterSign, placedLandmarks };
