// Read-only display of DICOM-SR measurements in Cornerstone3D viewports. Adapted from the OHIF v3
// cornerstone-dicom-sr DICOMSRDisplayTool. The annotations are written by @ohif/core
// (DICOMSR/readOnly/srDisplayAnnotations.js) in patient coordinates; this tool only draws them.
//
// Differences from OHIF v3: every read-only measurement of the viewport's Frame of Reference is
// drawn (there is no SR viewport to restrict them to), visibility in a slice is decided by
// `isViewable` rather than the library filters, a 3D viewport shows every annotation, and an arrow
// without a second point gets its tail in canvas space, so SCOORD3D content needs no image.
//
// Add to a tool group with `addSRDisplayToolToGroup`: the tool is enabled, never active, so it
// takes no mouse input.

import srDisplayAnnotations from '@ohif/core/src/DICOMSR/readOnly/srDisplayAnnotations';

import {
  Enums as c3dEnums,
  VolumeViewport,
  StackViewport,
  metaData as c3dMetaData,
  utilities as c3dUtils,
} from '@cornerstonejs/core';

import {
  AnnotationTool,
  addTool as c3dAddTool,
  annotation as c3dAnnotation,
  drawing as c3dSvgDrawing,
  state as c3dToolsState,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

const { drawArrow, drawHandles, drawLine, drawLinkedTextBox, drawPolyline } = c3dSvgDrawing;

// Arrow length (canvas pixels) for a point measurement without a second point
const ARROW_LENGTH = 40;

// Text box lines per measurement
const MAX_TEXT_LINES = 5;

// Shown before the value; labels not listed are shown as "label: value"
const SHORT_HAND_MAP = {
  'Short Axis': 'W: ',
  'Long Axis': 'L: ',
  AREA: 'Area: ',
  Length: '',
  CORNERSTONEFREETEXT: '',
};


function _textLines(labels) {
  return (labels || []).slice(0, MAX_TEXT_LINES).map(({ label, value }) => {
    const shortHand = SHORT_HAND_MAP[label];
    if (shortHand !== undefined) {
      return `${shortHand}${value ?? ''}`;
    }
    return value === undefined || value === '' ? `${label}` : `${label}: ${value}`;
  });
}


class DICOMSRDisplayTool extends AnnotationTool {

  static toolName = srDisplayAnnotations.TOOL_NAME;

  constructor(toolProps = {}, defaultToolProps = {
    configuration: {
      // Lines and curves of read-only measurements are drawn dashed (arrows and handles are solid)
      lineDash: '4,4',
    },
  }) {
    super(toolProps, defaultToolProps);
  }

  // Display only: the annotations cannot be created, selected or moved
  addNewAnnotation = () => undefined;
  cancel = () => undefined;
  handleSelectedCallback = () => undefined;
  toolSelectedCallback = () => undefined;
  isPointNearTool = () => false;
  getHandleNearImagePoint = () => undefined;

  _view(viewport) {
    // The view an annotation must belong to (srDisplayAnnotations.isViewable)

    if (viewport.type === c3dEnums.ViewportType.VOLUME_3D) {
      return { is3D: true };
    }

    const camera = viewport.getCamera();
    let halfSpacing = 0.5;

    try {
      if (viewport instanceof VolumeViewport) {
        const { spacingInNormalDirection } = c3dUtils.getTargetVolumeAndSpacingInNormalDir(viewport, camera);
        halfSpacing = (Number(spacingInNormalDirection) || 1) / 2;
      } else if (viewport instanceof StackViewport) {
        const imagePlane = c3dMetaData.get('imagePlaneModule', viewport.getCurrentImageId());
        halfSpacing = (Number(imagePlane?.sliceThickness) || 1) / 2;
      }
    } catch (error) {
      // A viewport without its volume yet: keep the default
    }

    return { viewPlaneNormal: camera.viewPlaneNormal, focalPoint: camera.focalPoint, halfSpacing };
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const { viewport } = enabledElement;
    const { element } = viewport;

    // The annotation manager returns those of the viewport's Frame of Reference
    const annotations = c3dAnnotation.state.getAnnotations(this.getToolName(), element);
    if (!annotations?.length) {
      return false;
    }

    // Nothing to draw over before the viewport shows its data
    const hasActors = typeof viewport.getActors === 'function'
      ? viewport.getActors().length > 0
      : Boolean(viewport._actors?.size);
    if (!hasActors) {
      return false;
    }

    const view = this._view(viewport);
    const viewable = annotations.filter(annotation => srDisplayAnnotations.isViewable(annotation, view));
    if (!viewable.length) {
      return false;
    }

    const activeTrackingUniqueIdentifier = srDisplayAnnotations.getActiveTrackingUniqueIdentifier();
    const styleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: viewport.id,
    };

    viewable.forEach(annotation => {
      const { annotationUID, data } = annotation;
      styleSpecifier.annotationUID = annotationUID;

      const isActive = !!activeTrackingUniqueIdentifier
        && data.TrackingUniqueIdentifier === activeTrackingUniqueIdentifier;
      // The measurement's stored display colour (its Border role), else the tool style; the active
      // measurement is highlighted either way
      const storedColor = !isActive && data.displayColor && data.displayColor.Border;
      const options = {
        color: storedColor || this.getStyle(isActive ? 'colorSelected' : 'color', styleSpecifier, annotation),
        lineWidth: this.getStyle('lineWidth', styleSpecifier, annotation),
        lineDash: this.configuration.lineDash ?? this.getStyle('lineDash', styleSpecifier, annotation),
      };

      let canvasCoordinates = [];
      (data.renderableData || []).forEach((item, index) => {
        canvasCoordinates = canvasCoordinates.concat(
          this._renderItem(svgDrawingHelper, viewport, annotationUID, item, `${index}`, options));
      });

      this._renderTextBox(svgDrawingHelper, viewport, annotation, canvasCoordinates, styleSpecifier, options);
    });

    return true;
  };

  _renderItem(svgDrawingHelper, viewport, annotationUID, item, uid, options) {
    const canvasCoordinates = item.points.map(point => viewport.worldToCanvas(point));
    const lineOptions = { color: options.color, width: options.lineWidth, lineDash: options.lineDash };

    switch (item.shape) {
      case 'point': {
        // An arrow pointing at the point, from the second point when there is one
        const head = canvasCoordinates[0];
        const tail = canvasCoordinates[1] || [head[0] - ARROW_LENGTH, head[1] - ARROW_LENGTH];
        drawArrow(svgDrawingHelper, annotationUID, `arrow-${uid}`, tail, head, {
          color: options.color, width: options.lineWidth,
        });
        return [head, tail];
      }

      case 'multipoint':
        drawHandles(svgDrawingHelper, annotationUID, `handles-${uid}`, canvasCoordinates, { color: options.color });
        return canvasCoordinates;

      case 'polyline':
        if (canvasCoordinates.length === 2) {
          drawLine(svgDrawingHelper, annotationUID, `line-${uid}`, canvasCoordinates[0], canvasCoordinates[1], lineOptions);
        } else {
          drawPolyline(svgDrawingHelper, annotationUID, `polyline-${uid}`, canvasCoordinates, lineOptions);
        }
        return canvasCoordinates;

      default:
        return [];
    }
  }

  _renderTextBox(svgDrawingHelper, viewport, annotation, canvasCoordinates, styleSpecifier, options) {
    // Placed for each view from the drawn geometry: the annotation is shared by views of any
    // orientation, so a position stored by one would be wrong in the others

    const lines = _textLines(annotation.data.labels);
    if (!lines.length || !canvasCoordinates.length) {
      return;
    }

    const textBoxPosition = c3dToolsUtilities.drawing.getTextBoxCoordsCanvas(canvasCoordinates);
    drawLinkedTextBox(
      svgDrawingHelper,
      annotation.annotationUID,
      'textBox',
      lines,
      textBoxPosition,
      canvasCoordinates,
      {},
      { ...this.getLinkedTextBoxStyle(styleSpecifier, annotation), color: options.color },
    );
  }
}


/**
 * Add the read-only SR display to a Cornerstone3D tool group (registering the tool globally on first
 * use) and enable it.
 */
function addSRDisplayToolToGroup(toolGroup) {
  if (!toolGroup) {
    return;
  }

  const { toolName } = DICOMSRDisplayTool;
  if (!c3dToolsState.tools[toolName]) {
    c3dAddTool(DICOMSRDisplayTool);
  }
  if (!toolGroup.hasTool(toolName)) {
    toolGroup.addTool(toolName);
  }
  toolGroup.setToolEnabled(toolName);
}


/** Show (enabled: drawn, no input) or hide (disabled) the read-only SR display of a tool group */
function setSRDisplayToolEnabled(toolGroup, enabled) {
  const { toolName } = DICOMSRDisplayTool;
  if (!toolGroup || !toolGroup.hasTool(toolName)) {
    return;
  }
  if (enabled) {
    toolGroup.setToolEnabled(toolName);
  } else {
    toolGroup.setToolDisabled(toolName);
  }
}


export default DICOMSRDisplayTool;
export { DICOMSRDisplayTool, addSRDisplayToolToGroup, setSRDisplayToolEnabled };
