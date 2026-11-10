// Display of the Angle and Cobb angle annotations in a Cornerstone3D 3D (volume rendering)
// viewport: every annotation of those tools in the viewport's Frame of Reference, including the
// ones the classic measurements are mirrored to (extensions/cornerstone measurementAnnotationSync). This
// tool only draws them. The stock Angle / Cobb angle tools offer an annotation only to views whose
// plane is parallel to it, which a rotating 3D view almost never is, so this tool draws them
// whatever the camera: the lines, the handles and the value (DICOMSR angleGeometry
// `annotationAngle`; for a mirrored measurement, the value its classic record and SR hold).
//
// Display only: it takes no mouse input, and editing stays with the 2D and inspection views. Add it to a tool
// group with `addAngleDisplay3DToolToGroup`; `setAngleDisplay3DEnabled` shows or hides it.

import { annotationAngle } from '@ohif/core/src/DICOMSR/utils/angleGeometry';

import { utilities as c3dUtils } from '@cornerstonejs/core';
import {
  AnnotationTool,
  addTool as c3dAddTool,
  annotation as c3dAnnotation,
  drawing as c3dSvgDrawing,
  state as c3dToolsState,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

const { drawHandles, drawLine, drawLinkedTextBox, drawPolyline } = c3dSvgDrawing;

// Tools whose annotations are drawn, with their point counts
const ANGLE_TOOLS = { Angle: 3, CobbAngle: 4 };


class AngleDisplay3DTool extends AnnotationTool {

  static toolName = 'SonadorAngleDisplay3D';

  constructor(toolProps = {}, defaultToolProps = { configuration: {} }) {
    super(toolProps, defaultToolProps);
  }

  // Display only: the annotations cannot be created, selected or moved here
  addNewAnnotation = () => undefined;
  cancel = () => undefined;
  handleSelectedCallback = () => undefined;
  toolSelectedCallback = () => undefined;
  isPointNearTool = () => false;
  getHandleNearImagePoint = () => undefined;

  _annotations(viewport) {
    // Visible Angle / Cobb angle annotations of the viewport's Frame of Reference, with complete
    // geometry
    const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();
    return Object.keys(ANGLE_TOOLS).flatMap(toolName =>
      (c3dAnnotation.state.getAnnotations(toolName, viewport.element) || []).filter(annotation =>
        annotation.metadata?.FrameOfReferenceUID === FrameOfReferenceUID
        && c3dAnnotation.visibility.isAnnotationVisible(annotation.annotationUID)
        && annotation.data?.handles?.points?.length === ANGLE_TOOLS[toolName])
        .map(annotation => ({ toolName, annotation })));
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const { viewport } = enabledElement;

    // Nothing to draw over before the viewport shows its data
    const hasActors = typeof viewport.getActors === 'function'
      ? viewport.getActors().length > 0
      : Boolean(viewport._actors?.size);
    if (!hasActors) {
      return false;
    }

    const annotations = this._annotations(viewport);
    if (!annotations.length) {
      return false;
    }

    const styleSpecifier = { toolGroupId: this.toolGroupId, toolName: this.getToolName(), viewportId: viewport.id };
    annotations.forEach(({ toolName, annotation }) => {
      const { annotationUID, data } = annotation;
      styleSpecifier.annotationUID = annotationUID;
      const color = this.getStyle('color', styleSpecifier, annotation);
      const lineOptions = { color, width: this.getStyle('lineWidth', styleSpecifier, annotation) };

      const canvasCoordinates = data.handles.points.map(point => viewport.worldToCanvas(point));
      if (toolName === 'Angle') {
        drawPolyline(svgDrawingHelper, annotationUID, 'angle', canvasCoordinates, lineOptions);
      } else {
        drawLine(svgDrawingHelper, annotationUID, 'line1', canvasCoordinates[0], canvasCoordinates[1], lineOptions);
        drawLine(svgDrawingHelper, annotationUID, 'line2', canvasCoordinates[2], canvasCoordinates[3], lineOptions);
      }
      drawHandles(svgDrawingHelper, annotationUID, 'handles', canvasCoordinates, { color });

      // The value; 0 is a value, and an incomplete or degenerate angle without a matching record
      // value has none
      const value = annotationAngle(toolName, data);
      if (!Number.isFinite(value)) {
        return;
      }
      drawLinkedTextBox(
        svgDrawingHelper,
        annotationUID,
        'textBox',
        [`${c3dUtils.roundNumber(value)} ${String.fromCharCode(176)}`],
        c3dToolsUtilities.drawing.getTextBoxCoordsCanvas(canvasCoordinates),
        canvasCoordinates,
        {},
        { ...this.getLinkedTextBoxStyle(styleSpecifier, annotation), color },
      );
    });

    return true;
  };
}


/**
 * Add the angle display to a Cornerstone3D tool group (registering the tool globally on first
 * use), shown or hidden.
 */
function addAngleDisplay3DToolToGroup(toolGroup, enabled = true) {
  if (!toolGroup) {
    return;
  }

  const { toolName } = AngleDisplay3DTool;
  if (!c3dToolsState.tools[toolName]) {
    c3dAddTool(AngleDisplay3DTool);
  }
  if (!toolGroup.hasTool(toolName)) {
    toolGroup.addTool(toolName);
  }
  setAngleDisplay3DEnabled(toolGroup, enabled);
}


/** Show (enabled: drawn, no input) or hide (disabled: not drawn) the angles of a tool group */
function setAngleDisplay3DEnabled(toolGroup, enabled) {
  if (!toolGroup || !toolGroup.hasTool(AngleDisplay3DTool.toolName)) {
    return;
  }
  if (enabled) {
    toolGroup.setToolEnabled(AngleDisplay3DTool.toolName);
  } else {
    toolGroup.setToolDisabled(AngleDisplay3DTool.toolName);
  }

  const viewportIds = (toolGroup.getViewportIds && toolGroup.getViewportIds()) || [];
  if (viewportIds.length) {
    c3dToolsUtilities.triggerAnnotationRenderForViewportIds(viewportIds);
  }
}


export default AngleDisplay3DTool;
export { AngleDisplay3DTool, addAngleDisplay3DToolToGroup, setAngleDisplay3DEnabled };
