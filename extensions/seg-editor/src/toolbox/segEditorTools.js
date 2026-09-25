// Labelmap tool instances for the Segmentation Editor's 2D tool group, mirroring the OHIF v3
// segmentation mode (modes/segmentation/src/initToolGroups.ts). All are added passive: the slice
// imaging tools keep the primary binding until a palette tool is chosen.

import {
  addTool as c3dAddTool,
  BrushTool,
  CircleScissorsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
} from '@cornerstonejs/tools';

import {
  DEFAULT_SEGMENTATION_DRAWING_RADIUS,
  LABELMAP_TOOLS,
  MAX_SEGMENTATION_DRAWING_RADIUS,
  MIN_SEGMENTATION_DRAWING_RADIUS,
} from './constants';


const radius = {
  brushSize: DEFAULT_SEGMENTATION_DRAWING_RADIUS,
  minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
  maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
};

const dynamicThreshold = { threshold: { isDynamic: true, dynamicRadius: 3 } };

// Brush-based instances: [toolName, BrushTool configuration]
const BRUSH_INSTANCES = [
  [LABELMAP_TOOLS.CircularBrush, { activeStrategy: 'FILL_INSIDE_CIRCLE' }],
  [LABELMAP_TOOLS.SphereBrush, { activeStrategy: 'FILL_INSIDE_SPHERE' }],
  [LABELMAP_TOOLS.CircularEraser, { activeStrategy: 'ERASE_INSIDE_CIRCLE' }],
  [LABELMAP_TOOLS.SphereEraser, { activeStrategy: 'ERASE_INSIDE_SPHERE' }],
  [LABELMAP_TOOLS.ThresholdCircularBrush, { activeStrategy: 'THRESHOLD_INSIDE_CIRCLE' }],
  [LABELMAP_TOOLS.ThresholdSphereBrush, { activeStrategy: 'THRESHOLD_INSIDE_SPHERE' }],
  [
    LABELMAP_TOOLS.ThresholdCircularBrushDynamic,
    { activeStrategy: 'THRESHOLD_INSIDE_CIRCLE', ...dynamicThreshold },
  ],
  [
    LABELMAP_TOOLS.ThresholdSphereBrushDynamic,
    { activeStrategy: 'THRESHOLD_INSIDE_SPHERE', ...dynamicThreshold },
  ],
];

const SCISSOR_TOOLS = [CircleScissorsTool, SphereScissorsTool, RectangleScissorsTool];

/** Register the labelmap tool classes with Cornerstone3D (repeat calls are no-ops). */
export function registerLabelmapTools() {
  c3dAddTool(BrushTool);
  SCISSOR_TOOLS.forEach(ToolClass => c3dAddTool(ToolClass));
}

/**
 * Add the labelmap tools to a tool group, passive.
 *
 * @param {Object} toolGroup - Cornerstone3D ToolGroup
 */
export function addLabelmapTools(toolGroup) {
  BRUSH_INSTANCES.forEach(([toolName, configuration]) => {
    if (!toolGroup.hasTool(toolName)) {
      toolGroup.addToolInstance(toolName, BrushTool.toolName, { ...configuration, ...radius });
    }
    toolGroup.setToolPassive(toolName);
  });

  SCISSOR_TOOLS.forEach(ToolClass => {
    if (!toolGroup.hasTool(ToolClass.toolName)) {
      toolGroup.addTool(ToolClass.toolName);
    }
    toolGroup.setToolPassive(ToolClass.toolName);
  });
}

/** Every labelmap tool name added by addLabelmapTools. */
export const LABELMAP_TOOL_NAMES = Object.values(LABELMAP_TOOLS);
