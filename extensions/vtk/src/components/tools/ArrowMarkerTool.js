// Arrow markers in the Cornerstone3D slice views (the MPR panes and the Inspector): an arrow labels a
// point that exists on every plane. The arrow tool draws an arrow in the view parallel to it, on the
// slice that holds it; a view whose slice passes less than one slice spacing from the tip, and does
// not draw the arrow, shows a ring at the tip, projected onto the view, in its line color
// (extensions/cornerstone utils/arrowMarkers). Hovering a ring shows the arrow's label; pressing it
// calls the tool's `onActivate` with the tip, the arrow's plane normal and the viewport. Hidden
// arrows show nothing; read-only DICOM-SR arrows (DICOMSRDisplayTool) are included.
//
// Display only: it takes input through the markers alone. Add it to a tool group with
// `addArrowMarkerToolToGroup`.

import { getLineTextColor } from '@ohif/core/src/displayAttributes';
import srDisplayAnnotations from '@ohif/core/src/DICOMSR/readOnly/srDisplayAnnotations';
import { utils as cextUtils } from '@ohif/extension-cornerstone';

import { Enums as c3dEnums, eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import {
  AnnotationTool,
  addTool as c3dAddTool,
  annotation as c3dAnnotation,
  drawing as c3dSvgDrawing,
  state as c3dToolsState,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import { srViewOf } from './DICOMSRDisplayTool';
import { alignToPlane, jumpToWorldPoint } from '../../utils/jumpToWorldPoint';

const { drawCircle } = c3dSvgDrawing;

const ARROW_TOOL = 'ArrowAnnotate';
const SR_ARROW = /:ArrowAnnotate$/;

const isPoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const textOf = data => [data.label, data.text].find(value => typeof value === 'string' && value !== '') || '';


// A disabled viewport's rings, and its hover, go with it
let listeningForDisabled = false;
function clearOnDisable() {
  if (listeningForDisabled || !c3dEventTarget) {
    return;
  }
  listeningForDisabled = true;
  c3dEventTarget.addEventListener(c3dEnums.Events.ELEMENT_DISABLED,
    evt => cextUtils.arrowMarkers.clearArrowMarkers(evt.detail && evt.detail.element));
}


class ArrowMarkerTool extends AnnotationTool {

  static toolName = 'SonadorArrowMarker3D';

  constructor(toolProps = {}, defaultToolProps = { configuration: { onActivate: undefined } }) {
    super(toolProps, defaultToolProps);
    clearOnDisable();
  }

  // Display only: the annotations cannot be created, selected or moved here
  addNewAnnotation = () => undefined;
  cancel = () => undefined;
  handleSelectedCallback = () => undefined;
  toolSelectedCallback = () => undefined;
  isPointNearTool = () => false;
  getHandleNearImagePoint = () => undefined;

  _arrowsNotDrawn(viewport) {
    // The visible arrows of the viewport's Frame of Reference near its slice that the slice does not
    // draw: { key, tip, label, color, viewPlaneNormal }
    const view = srViewOf(viewport);
    const { isNearSlice, distanceFromPlane } = cextUtils.arrowMarkers;
    const near = tip => Boolean(view.viewPlaneNormal && view.focalPoint)
      && isNearSlice(distanceFromPlane(view.focalPoint, view.viewPlaneNormal, tip), 2 * view.halfSpacing);

    const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();
    const arrows = (c3dAnnotation.state.getAnnotations(ARROW_TOOL, viewport.element) || []).filter(annotation =>
      annotation.metadata?.FrameOfReferenceUID === FrameOfReferenceUID && annotation.isVisible !== false
      && c3dAnnotation.visibility.isAnnotationVisible(annotation.annotationUID) && isPoint(annotation.data?.handles?.points?.[0])
      && near(annotation.data.handles.points[0]));
    const drawn = new Set(c3dToolsUtilities.planar.filterAnnotationsForDisplay(viewport, arrows)
      .map(annotation => annotation.annotationUID));

    const styleSpecifier = { toolGroupId: this.toolGroupId, toolName: this.getToolName(), viewportId: viewport.id };
    const measured = arrows.filter(annotation => !drawn.has(annotation.annotationUID)).map(annotation => ({
      key: annotation.annotationUID,
      tip: annotation.data.handles.points[0],
      label: textOf(annotation.data),
      color: this.getStyle('color', { ...styleSpecifier, annotationUID: annotation.annotationUID }, annotation),
      viewPlaneNormal: annotation.metadata.viewPlaneNormal,
    }));

    // Read-only DICOM-SR arrows the read-only display does not draw in this view
    const readOnly = (c3dAnnotation.state.getAnnotations(srDisplayAnnotations.TOOL_NAME, viewport.element) || [])
      .filter(annotation => annotation.isVisible !== false && SR_ARROW.test(String(annotation.data?.TrackingIdentifier || ''))
        && isPoint(annotation.data?.handles?.points?.[0]) && near(annotation.data.handles.points[0])
        && !srDisplayAnnotations.isViewable(annotation, view))
      .map(({ annotationUID, data }) => ({
        key: annotationUID,
        tip: data.handles.points[0],
        label: ((data.labels || []).find(label => label && label.value) || {}).value || '',
        color: getLineTextColor({ Color: data.displayColor }, ARROW_TOOL).line || this.getStyle('color', styleSpecifier),
        viewPlaneNormal: data.srPlane?.sourceNormal,
      }));

    return [...measured, ...readOnly];
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const { viewport } = enabledElement;
    const { MARKER_RADIUS, setArrowMarkers, ensureArrowMarkerTooltip } = cextUtils.arrowMarkers;
    if (viewport.type === c3dEnums.ViewportType.VOLUME_3D) {
      return false;
    }

    const arrows = this._arrowsNotDrawn(viewport);
    const { onActivate } = this.configuration;
    const markers = arrows.map((arrow) => {
      const [x, y] = viewport.worldToCanvas(arrow.tip);
      drawCircle(svgDrawingHelper, `${this.getToolName()}:${arrow.key}`, 'marker', [x, y], MARKER_RADIUS,
        { color: arrow.color, width: 1.5 });
      return {
        x, y, label: arrow.label,
        activate: () => onActivate && onActivate({ worldPoint: arrow.tip, viewPlaneNormal: arrow.viewPlaneNormal, viewport }),
      };
    });

    if (markers.length) {
      ensureArrowMarkerTooltip();
    }
    setArrowMarkers(viewport.element, viewport.canvas, markers);
    return markers.length > 0;
  };
}


/**
 * Add the arrow markers to a Cornerstone3D tool group (registering the tool globally on first use),
 * enabled.
 *
 * @param {object} toolGroup
 * @param {object} configuration - { onActivate({ worldPoint, viewPlaneNormal, viewport }) }
 */
function addArrowMarkerToolToGroup(toolGroup, configuration = {}) {
  if (!toolGroup) {
    return;
  }

  const { toolName } = ArrowMarkerTool;
  if (!c3dToolsState.tools[toolName]) {
    c3dAddTool(ArrowMarkerTool);
  }
  if (!toolGroup.hasTool(toolName)) {
    toolGroup.addTool(toolName, configuration);
  }
  toolGroup.setToolEnabled(toolName);
}


/**
 * A single view's response to a pressed marker (the Inspector): turn onto the arrow's plane at any
 * angle (utils/jumpToWorldPoint), move onto the tip, and render; without a known plane, only move
 * onto the tip.
 */
function turnViewOntoArrow({ worldPoint, viewPlaneNormal, viewport }) {
  if (!viewport) {
    return;
  }
  if (viewPlaneNormal) {
    alignToPlane(viewport, viewPlaneNormal, { anyAngle: true });
  }
  jumpToWorldPoint(viewport, worldPoint);
  viewport.render();
}


export default ArrowMarkerTool;
export { ArrowMarkerTool, addArrowMarkerToolToGroup, turnViewOntoArrow };
