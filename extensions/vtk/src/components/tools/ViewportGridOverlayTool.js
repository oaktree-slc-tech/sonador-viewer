// Implements a neutral "viewport grid" which provides lines and scale relative to the
// viewport's coordinate system.
import _ from 'lodash';

import { vec3 } from 'gl-matrix';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';

import {
  getEnabledElementByIds,
  getRenderingEngines,
  utilities as c3dUtils,
  
  Types as c3dTypes,
} from '@cornerstonejs/core';

import {
  AnnotationDisplayTool,
  ScaleOverlayTool,

  // SVG drawing helpers
  drawing as c3dSvgDrawing,

  // Annotation state management
  ToolGroupManager as C3dToolGroupManager,
  annotation as c3dAnnotations,
} from '@cornerstonejs/tools';

import { gridReferenceLineColors } from '../../utils/cornerstone3d.js';

const { drawLine } = c3dSvgDrawing;


// Global structure for internal state tracking of those viewports which have active annotations.
const viewportsWithAnnotations = [];


class ViewportGridOverlayTool extends ScaleOverlayTool {
  // Provides a neutral grid with overlay lines that allow user to create measurements

  static toolName;

  constructor(...args) {
    // Provides an override so that bound methods of the ScaleOverlay tool can be overridden
    // and subclasses to work 
    super(...args);
    const _grid = this;

    // Due to the way ScaleOverLayTool defines the _init function, an functional override
    // which sets the method as an instance property is required to ensure that they are
    // invoked correctly.
    _grid._scaleInit = this._init;
    _grid._scaleOnEnabled = this.onSetToolEnabled;
    _grid._scaleOnCameraModified = this.onCameraModified;

    // Override for init
    _grid._init = () => {
      _grid._scaleInit();

      // Initialize annotation for the grid overlay if one was not created during
      // as part invoking ScaleOverlayTool._init
      _grid._init_annotation();
    }

    // Override for onSetToolEnabled
    _grid.onSetToolEnabled = () => {      
      _grid._scaleOnEnabled();
    }

    // Override for onCameraModified
    _grid.onCameraModified = (evt) => {      
      _grid._scaleOnCameraModified(evt);
    }
  }

  _get_renderengine() {
    // Retrieve the active render engine

    const renderingEngines = getRenderingEngines();
    return renderingEngines[0];
  }

  _get_viewport() {
    // Retrieve the viewport for the current grid

    const _renderEngine = this._get_renderengine()
    if (!_renderEngine) {
      return;
    }

    // retrieve viewports with the tool enabled
    const viewportIds = C3dToolGroupManager.getToolGroup(this.toolGroupId).viewportsInfo;

    if (!viewportIds) {
      return;
    }

    // Get enabled elements
    const enabledElements = viewportIds.map((e) => {
      const _el = getEnabledElementByIds(e.viewportId, e.renderingEngineId)
      return _el;
    });
    const _enabledElement = enabledElements[0];
    if (!_enabledElement) {      
      return;
    }

    let { viewport } = _enabledElement;
    const { FrameOfReferenceUID  } = _enabledElement;

    // onCameraModified, configuration.viewportId is set to the active viewport Id. This logic
    // sets the viewport variable to the viewport with the matching Id.
    if (this.configuration.viewportId) {
      enabledElements.forEach((element) => {
        if (element.viewport.id == this.configuration.viewportId) {
          viewport = element.viewport;
        }
      });
    }

    return { viewport, FrameOfReferenceUID, enabledElements }
  }

  _get_annotation(options) {
    // Retrieve the annotation for the current grid
    options = options || {};

    // Retrieve annotation from  local reference
    let annotation = this.editData?.annotation;
    if (annotation) {
      return annotation;
    }

    // Retrieve viewport reference (if one not provided)
    const { viewport } = options.viewport || this._get_viewport();
    if (!viewport) {
      return;
    }

    // Retrieve annotation from the annotations store
    const annotations = c3dAnnotations.state.getAnnotations(this.getToolName(), viewport.element);

    // if annotations have been created, get the annotation for the
    // current viewport Id
    if (annotations.length) {
      annotation = annotations.filter(
        (thisAnnotation) => thisAnnotation.data.viewportId == viewport.id
      )[0];
    }
    
    return annotation;
  }

  _init_annotation() {
    // Initialize annotation for the overlay grid

    // Check to see if an annotation already exists, if so, return it
    let annotation = this._get_annotation();

    // If the viewport does not have an annotation, one needs to be created.
    const { viewport, enabledElements, FrameOfReferenceUID } = this._get_viewport();
    if (!viewport || !enabledElements) {
      return;
    }

    // Camera view planes and viewport corners
    const { viewUp, viewPlaneNormal } = viewport.getCamera();    
    const viewportCanvasCornersInWorld = c3dUtils.getViewportImageCornersInWorld(viewport);

    // Iterate through active viewports for the tool and generate an annotation
    // for the current tool type.
    enabledElements.forEach((e) => {
      const { viewport } = e;

      // Add annotations to the global tracking array for the tool, to speed up
      // filter, tracking, and global state search.
      if (!viewportsWithAnnotations.includes(viewport.id)) {
        const newAnnotation = {
          metadata: {
            toolName: this.getToolName(),
            viewPlaneNormal: [...viewPlaneNormal],
            viewUp: [...viewUp],
            FrameOfReferenceUID,
            referencedImageId: null,
          },
          data: {
            handles: {
              points: c3dUtils.getViewportImageCornersInWorld(viewport),
            },
            viewportId: viewport.id,
          }
        }

        // Add viewport reference ID and persist annotation to state
        viewportsWithAnnotations.push(viewport.id);
        c3dAnnotations.state.addAnnotation(newAnnotation, viewport.element);
        
        annotation = newAnnotation;
      }
    });


    if (this.editData?.annotation && this.editData.annotation.data.viewportId == viewport.id) {

      // Update active annotation data properties
      this.editData.annotation.data.handles.points = viewportCanvasCornersInWorld;
      this.editData.annotation.data.viewportId = viewport.id;
    }

    // Update edit data for the tool
    this.editData = { viewport, renderingEngine: this._get_renderengine(), annotation }
  }

  getStyle(property, styleSpecifier, annotation, options) {
    // Retrieve the requested style
    options = options || {};

    let style;

    // Determine color based on the reference plane
    if (property == 'color') {
      const { viewport } = this._get_viewport();

      if (viewport) {
        const { viewPlaneNormal } = viewport.getCamera();        

        // Determine the color of the line based on the view plan
        if (Math.abs(viewPlaneNormal[0]) === 1) {

          // Sagittal display plane: green and red
          if (options.lineType == 'horizontal-grid') {
            style = gridReferenceLineColors.red;
          } else { style = gridReferenceLineColors.green; }

        } else if (Math.abs(viewPlaneNormal[1]) === 1) {

          // Frontal display plane: yellow and red
          if (options.lineType == 'horizontal-grid') {
            style = gridReferenceLineColors.red;
          } else { style = gridReferenceLineColors.yellow; }

        } else if (Math.abs(viewPlaneNormal[2]) === 1) {

          // Axial display plane: yellow and green
          if (options.lineType == 'horizontal-grid') {
            style = gridReferenceLineColors.green;
          } else { style = gridReferenceLineColors.yellow; }

        } else {
          style = gridReferenceLineColors.default;
        }
      }
    }

    // If unable to retrieve color, fetch style from scale overlay
    if (!style) {
      style = super.getStyle(property, styleSpecifier, annotation);
    }
    
    return style;
  }

  renderAnnotation(enabledElement, svgDrawingHelper) {
    // Render the overlay grid
      
    if (!this.editData || !this.editData.viewport) {
      return;
    }

    const vLocation = 'bottom';
    const hLocation = 'left';
    const { viewport } = enabledElement;
    
    // Filter annotations for the viewport grid overlay, retrieve a reference to the viewport canvas
    const annotation = this._get_annotation({ viewport: viewport });
    const canvas = enabledElement.viewport.canvas;

    const renderStatus = false;

    if (!viewport) {
      return renderStatus;
    }

    const styleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    }

    const canvasSize = {
      width: canvas.width / window.devicePixelRatio || 1,
      height: canvas.height / window.devicePixelRatio || 1,
    }

    const topLeft = annotation.data.handles.points[0];
    const topRight = annotation.data.handles.points[1];
    const bottomLeft = annotation.data.handles.points[2];
    const bottomRight = annotation.data.handles.points[3];

    const pointSet1 = [topLeft, bottomLeft, topRight, bottomRight];

    const worldWidthViewport = vec3.distance(bottomLeft, bottomRight);
    const worldHeightViewport = vec3.distance(topLeft, bottomLeft);

    // hscaleBounds and vscaleBounds: calculate the frame of the overlay
    const vhScaleBounds = this.computeScaleBounds(canvasSize, 0, 0, vLocation);
    const vvScaleBounds = this.computeScaleBounds(canvasSize, 0, 0, vLocation);
    const hhScaleBounds = this.computeScaleBounds(canvasSize, 0, 0, hLocation);
    const hvScaleBounds = this.computeScaleBounds(canvasSize, 0, 0, hLocation);

    // Compute scale size size for vertical and horizontal lines
    const vScaleSize = this.computeScaleSize(worldWidthViewport, worldHeightViewport, vLocation);  
    const hScaleSize = this.computeScaleSize(worldWidthViewport, worldHeightViewport, hLocation);

    // Apply scale to get the image (real world) coordintes, and then convert to canvas coordinates
    const vCanvasCoordinates = this.computeWorldScaleCoordinates(vScaleSize, vLocation, pointSet1)
      .map((w) => viewport.worldToCanvas(w));
    const hCanvasCoordinates = this.computeWorldScaleCoordinates(hScaleSize, hLocation, pointSet1)
      .map((w) => viewport.worldToCanvas(w));

    // Use bounds and vanvas size to center grid
    const vGridCanvasCoordinates = this.computeCanvasScaleCoordinates (
      canvasSize, vCanvasCoordinates, vvScaleBounds, vhScaleBounds, vLocation);
    const hGridCanvasCoordinates = this.computeCanvasScaleCoordinates(
      canvasSize, hCanvasCoordinates, hvScaleBounds, hhScaleBounds, hLocation);

    const { annotationUID } = annotation;

    // Create style for lines
    styleSpecifier.annotationUID = annotationUID;
    const lineWidth = this.getStyle('lineWidth', styleSpecifier, annotation);
    const lineDash = this.getStyle('lineDash', styleSpecifier, annotation);
    const colorV = this.getStyle('color', styleSpecifier, annotation, { lineType: 'vertical-grid' });
    const colorH = this.getStyle('color', styleSpecifier, annotation, { lineType: 'horizontal-grid' });
    const shadow = this.getStyle('shadow', styleSpecifier, annotation);

    const scaleId = `${annotationUID}-scaleline`
    const scaleLineUID01 = '1';
    const scaleLineUID02 = '2';

    // Draw topline for grid
    drawLine(svgDrawingHelper, annotationUID, '999', 
      [0, 0], [canvasSize.width, 0], {
        color: colorH, width: lineWidth, lineDash, shadow,
      }, scaleId);


    // Draw centerlines
    drawLine(svgDrawingHelper, annotationUID, '100',
        [canvasSize.width/2, 0], [canvasSize.width/2, canvasSize.height], {
          color: colorV, width: lineWidth, lineDash, shadow,
        }, scaleId);
    drawLine(svgDrawingHelper, annotationUID, '200',
        [0, canvasSize.height/2], [canvasSize.width, canvasSize.height/2], {
          color: colorH, width: lineWidth, lineDash, shadow
        }, scaleId);
    
    // Draw scale enpoint lines for SVG (intersect with scale toolbar end)
    drawLine(svgDrawingHelper, annotationUID, scaleLineUID01, 
        [vGridCanvasCoordinates[0][0], canvasSize.height], [vGridCanvasCoordinates[0][0], 0], {
          color: colorV, width: lineWidth, lineDash, shadow,
        }, scaleId);
    drawLine(svgDrawingHelper, annotationUID, scaleLineUID02, 
        [vGridCanvasCoordinates[1][0], canvasSize.height], [vGridCanvasCoordinates[1][0], 0], {
          color: colorV, width: lineWidth, lineDash, shadow,
        }, scaleId);

    // Vertical inner lines
    const vGridTicks = this.computeEndScaleTicks(vGridCanvasCoordinates, vLocation);
    
    const  { tickIds: vTickIds, tickUIDs: vTickUIDs, tickCoordinates: vTickCoordinates } = this.computeInnerScaleTicks(
      vScaleSize, vLocation, annotationUID+'-v', 
      vGridTicks.endTick1, vGridTicks.endTick2);

    _.each(vTickCoordinates, (t, i) => {

      // Draw full-length vertical lines
      drawLine(svgDrawingHelper, annotationUID, vTickUIDs[i]+'-v', 
        [t[0][0], 0], [t[1][0], canvasSize.height], {
        color: colorV, width: lineWidth, lineDash, shadow,
      }, vTickIds[i]);

    });

    // Horizontal inner lines
    const hGridTicks = this.computeEndScaleTicks(hGridCanvasCoordinates, hLocation);

    const  { tickIds: hTickIds, tickUIDs: hTickUIDs, tickCoordinates: hTickCoordinates } = this.computeInnerScaleTicks(
      hScaleSize, hLocation, annotationUID+'-h', 
      hGridTicks.endTick1, hGridTicks.endTick2);

    _.each(hTickCoordinates, (t, i) => {

      // Draw full-length vertical lines
      drawLine(svgDrawingHelper, annotationUID, hTickUIDs[i]+'-h', 
        [0, t[0][1]], [canvasSize.width, t[1][1]], {
        color: colorH, width: lineWidth, lineDash, shadow,
      }, hTickIds[i]);

    });

  }
};


ViewportGridOverlayTool.toolName = 'SonadorViewportGridOverlay';
export default ViewportGridOverlayTool;