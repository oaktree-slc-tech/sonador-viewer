// Segmentation Editor tool palettes (ohif-viewers#142): tool names, toolbar sections, limits.

import { Enums as SegEditEnums } from '../enums';


// Commands run by the palette buttons live in the editor's command context
export const SEG_EDITOR_COMMAND_CONTEXT = SegEditEnums.ACTIVE_VIEWPORT;

// Brush radius (mm). OHIF v3 starts at 25 and allows up to 99.5, which is coarse for slice
// editing; the editor starts at 5 and caps the radius at 25 (a 50 mm stroke).
export const MIN_SEGMENTATION_DRAWING_RADIUS = 0.5;
export const SEGMENTATION_DRAWING_RADIUS_STEP = 0.25;
export const MAX_SEGMENTATION_DRAWING_RADIUS = 25;
export const DEFAULT_SEGMENTATION_DRAWING_RADIUS = 5;

// Slice imaging tools that can hold the primary (left) mouse binding
export const IMAGING_TOOLS = {
  WindowLevel: 'WindowLevel',
  Zoom: 'Zoom',
  Pan: 'Pan',
};

// History buttons shown after the imaging tools in the editor's top toolbar
export const HISTORY_BUTTONS = {
  undo: 'SegEditorUndo',
  redo: 'SegEditorRedo',
};

// Scrolls the 2D views on the mouse wheel
export const STACK_SCROLL_TOOL = 'StackScroll';

// Labelmap tool instances registered on the editor's 2D tool group
export const LABELMAP_TOOLS = {
  CircularBrush: 'CircularBrush',
  SphereBrush: 'SphereBrush',
  CircularEraser: 'CircularEraser',
  SphereEraser: 'SphereEraser',
  ThresholdCircularBrush: 'ThresholdCircularBrush',
  ThresholdSphereBrush: 'ThresholdSphereBrush',
  ThresholdCircularBrushDynamic: 'ThresholdCircularBrushDynamic',
  ThresholdSphereBrushDynamic: 'ThresholdSphereBrushDynamic',
  CircleScissor: 'CircleScissor',
  SphereScissor: 'SphereScissor',
  RectangleScissor: 'RectangleScissor',
};

export const BRUSH_TOOL_NAMES = [LABELMAP_TOOLS.CircularBrush, LABELMAP_TOOLS.SphereBrush];
export const ERASER_TOOL_NAMES = [LABELMAP_TOOLS.CircularEraser, LABELMAP_TOOLS.SphereEraser];
export const THRESHOLD_RANGE_TOOL_NAMES = [
  LABELMAP_TOOLS.ThresholdCircularBrush,
  LABELMAP_TOOLS.ThresholdSphereBrush,
];
export const THRESHOLD_TOOL_NAMES = [
  ...THRESHOLD_RANGE_TOOL_NAMES,
  LABELMAP_TOOLS.ThresholdCircularBrushDynamic,
  LABELMAP_TOOLS.ThresholdSphereBrushDynamic,
];
export const SHAPE_TOOL_NAMES = [
  LABELMAP_TOOLS.CircleScissor,
  LABELMAP_TOOLS.SphereScissor,
  LABELMAP_TOOLS.RectangleScissor,
];

// ToolbarService sections
export const SECTIONS = {
  // Top-level Labelmap palette (must contain only button sections; see Toolbox)
  labelMapToolbox: 'segEditorLabelMapToolbox',
  labelMapTools: 'SegEditorLabelMapTools',
  brushTools: 'SegEditorBrushTools',
  // Slice imaging tools shown in the editor's top toolbar
  imagingTools: 'segEditorImagingTools',
  // Top-level 3D palette, and its tools (act on the 3D editing canvas)
  threeDToolbox: 'segEditor3DToolbox',
  threeDTools: 'SegEditor3DTools',
};

// Names of the editor's toolbar evaluators (registered through the toolbar module's uiTypes)
export const EVALUATORS = {
  tool: 'segEditor.evaluate.tool',
  segmentation: 'segEditor.evaluate.segmentation',
  synchronizeDrawingRadius: 'segEditor.evaluate.synchronizeDrawingRadius',
  threeDTool: 'segEditor.evaluate.3dTool',
  synchronizeSelectionOptions: 'segEditor.evaluate.synchronizeSelectionOptions',
  pointer2D: 'segEditor.evaluate.pointer2D',
  pointer3D: 'segEditor.evaluate.pointer3D',
};

// Pointer buttons: the first button of each palette, which puts back the palette's default
// navigation (no editing tool holding the left mouse button)
export const POINTER_BUTTONS = {
  labelmap: 'SegEditorPointer2D',
  threeD: 'SegEditorPointer3D',
};
