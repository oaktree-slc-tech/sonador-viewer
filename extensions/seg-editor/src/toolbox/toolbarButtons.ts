// Segmentation Editor palette buttons, adapted from the OHIF v3 segmentation mode
// (modes/segmentation/src/toolbarButtons.ts). Differences from v3:
// - commands carry the editor's command context and act on the editor's tool group only;
// - evaluators are the editor's (./evaluators.js), which read the editor tool context;
// - `activateSelectedSegmentationOfType` makes the editor's working copy the active segmentation.

import React from 'react';

import i18n from '@ohif/i18n';

import SelectionToolPanel from '../toolbarComponents/SelectionToolPanel';
import { THREE_D_TOOLS } from '../threeDTools/threeDToolState';

import {
  BRUSH_TOOL_NAMES,
  DEFAULT_SEGMENTATION_DRAWING_RADIUS,
  ERASER_TOOL_NAMES,
  EVALUATORS,
  HISTORY_BUTTONS,
  IMAGING_TOOLS,
  LABELMAP_TOOLS,
  MAX_SEGMENTATION_DRAWING_RADIUS,
  MIN_SEGMENTATION_DRAWING_RADIUS,
  OPTION_UNITS,
  POINTER_BUTTONS,
  SEGMENTATION_DRAWING_RADIUS_STEP,
  SEG_EDITOR_COMMAND_CONTEXT,
  SHAPE_TOOL_NAMES,
  THRESHOLD_RANGE_TOOL_NAMES,
  THRESHOLD_TOOL_NAMES,
} from './constants';


// Labels come from the Buttons namespace (the OHIF v3 keys). The namespace is passed as an option
// rather than a `Buttons:` key prefix: i18next 23 treats a prefixed key containing spaces, such as
// 'Buttons:Radius (mm)', as natural-language text and returns it untranslated, prefix included.
const tb = (key: string) => i18n.t(key, { ns: 'Buttons' });

const command = (commandName: string, commandOptions = {}) => ({
  commandName,
  commandOptions,
  context: SEG_EDITOR_COMMAND_CONTEXT,
});

const activateWorkingSegmentation = command('activateSelectedSegmentationOfType', {
  segmentationRepresentationType: 'Labelmap',
});

// The option cards show the unit after the value (mm, or generic units on a series without pixel
// spacing), so the radius is named without one
const radiusOption = (id: string, toolNames: string[]) => ({
  name: tb('Radius'),
  unit: OPTION_UNITS.length,
  id,
  type: 'range',
  explicitRunOnly: true,
  min: MIN_SEGMENTATION_DRAWING_RADIUS,
  max: MAX_SEGMENTATION_DRAWING_RADIUS,
  step: SEGMENTATION_DRAWING_RADIUS_STEP,
  value: DEFAULT_SEGMENTATION_DRAWING_RADIUS,
  commands: command('setBrushSize', { toolNames }),
});

const imagingToolButton = (id: string, icon: string, label: string) => ({
  id,
  uiType: 'ohif.toolButton',
  props: {
    icon,
    label,
    commands: command('setToolActiveToolbar', { toolName: id }),
    evaluate: EVALUATORS.tool,
  },
});

export function getToolbarButtons() {
  return [
    // Slice imaging tools (rendered in the editor's top toolbar)
    imagingToolButton(IMAGING_TOOLS.WindowLevel, 'tool-window-level', tb('Levels')),
    imagingToolButton(IMAGING_TOOLS.Zoom, 'tool-zoom', tb('Zoom')),
    imagingToolButton(IMAGING_TOOLS.Pan, 'tool-move', tb('Pan')),

    // Undo / Redo (top toolbar, after the imaging tools): one history for 2D and 3D edits
    {
      id: HISTORY_BUTTONS.undo,
      uiType: 'ohif.toolButton',
      props: { icon: 'undo', label: tb('Undo'), commands: command('undoSegEditor') },
    },
    {
      id: HISTORY_BUTTONS.redo,
      uiType: 'ohif.toolButton',
      props: { icon: 'redo', label: tb('Redo'), commands: command('redoSegEditor') },
    },

    // Labelmap tools. Tool buttons are registered ahead of the groups that contain them, so that
    // their evaluators are resolved before a group's section is evaluated.
    {
      id: 'Brush',
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-brush',
        label: tb('Brush'),
        evaluate: [
          { name: EVALUATORS.segmentation, toolNames: BRUSH_TOOL_NAMES },
          { name: EVALUATORS.synchronizeDrawingRadius, radiusOptionId: 'brush-radius' },
        ],
        commands: activateWorkingSegmentation,
        options: [
          radiusOption('brush-radius', BRUSH_TOOL_NAMES),
          {
            name: tb('Shape'),
            type: 'radio',
            id: 'brush-mode',
            value: LABELMAP_TOOLS.CircularBrush,
            values: [
              { value: LABELMAP_TOOLS.CircularBrush, label: tb('Circle') },
              { value: LABELMAP_TOOLS.SphereBrush, label: tb('Sphere') },
            ],
            commands: command('setToolActiveToolbar'),
          },
        ],
      },
    },
    {
      id: 'Eraser',
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-eraser',
        label: tb('Eraser'),
        evaluate: [
          { name: EVALUATORS.segmentation, toolNames: ERASER_TOOL_NAMES },
          { name: EVALUATORS.synchronizeDrawingRadius, radiusOptionId: 'eraser-radius' },
        ],
        commands: activateWorkingSegmentation,
        options: [
          radiusOption('eraser-radius', ERASER_TOOL_NAMES),
          {
            name: tb('Shape'),
            type: 'radio',
            id: 'eraser-mode',
            value: LABELMAP_TOOLS.CircularEraser,
            values: [
              { value: LABELMAP_TOOLS.CircularEraser, label: tb('Circle') },
              { value: LABELMAP_TOOLS.SphereEraser, label: tb('Sphere') },
            ],
            commands: command('setToolActiveToolbar'),
          },
        ],
      },
    },
    {
      id: 'Threshold',
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-threshold',
        label: tb('Threshold Tool'),
        evaluate: [
          { name: EVALUATORS.segmentation, toolNames: THRESHOLD_TOOL_NAMES },
          { name: EVALUATORS.synchronizeDrawingRadius, radiusOptionId: 'threshold-radius' },
        ],
        commands: activateWorkingSegmentation,
        options: [
          radiusOption('threshold-radius', THRESHOLD_TOOL_NAMES),
          {
            name: tb('Shape'),
            type: 'radio',
            id: 'threshold-shape',
            value: LABELMAP_TOOLS.ThresholdCircularBrush,
            values: [
              { value: LABELMAP_TOOLS.ThresholdCircularBrush, label: tb('Circle') },
              { value: LABELMAP_TOOLS.ThresholdSphereBrush, label: tb('Sphere') },
            ],
            commands: ({ value, commandsManager, options }) => {
              const dynamicMode = options.find(option => option.id === 'dynamic-mode');
              const isCircle = value === LABELMAP_TOOLS.ThresholdCircularBrush;
              const toolName =
                dynamicMode.value === 'ThresholdDynamic'
                  ? isCircle
                    ? LABELMAP_TOOLS.ThresholdCircularBrushDynamic
                    : LABELMAP_TOOLS.ThresholdSphereBrushDynamic
                  : value;

              commandsManager.run(command('setToolActive', { toolName }));
            },
          },
          {
            name: tb('Threshold'),
            type: 'radio',
            id: 'dynamic-mode',
            value: 'ThresholdDynamic',
            values: [
              { value: 'ThresholdDynamic', label: tb('Dynamic') },
              { value: 'ThresholdRange', label: tb('Range') },
            ],
            commands: ({ value, commandsManager, options }) => {
              const shape = options.find(option => option.id === 'threshold-shape').value;
              const isCircle = shape === LABELMAP_TOOLS.ThresholdCircularBrush;

              if (value === 'ThresholdDynamic') {
                commandsManager.run(
                  command('setToolActiveToolbar', {
                    toolName: isCircle
                      ? LABELMAP_TOOLS.ThresholdCircularBrushDynamic
                      : LABELMAP_TOOLS.ThresholdSphereBrushDynamic,
                  })
                );
                return;
              }

              commandsManager.run(command('setToolActiveToolbar', { toolName: shape }));
              commandsManager.run(
                command('setThresholdRange', {
                  toolNames: THRESHOLD_RANGE_TOOL_NAMES,
                  value: options.find(option => option.id === 'threshold-range').value,
                })
              );
            },
          },
          {
            name: tb('Threshold Range'),
            type: 'double-range',
            id: 'threshold-range',
            unit: OPTION_UNITS.intensity,
            min: -1000,
            max: 1000,
            step: 1,
            value: [50, 600],
            condition: ({ options }) =>
              options.find(option => option.id === 'dynamic-mode').value === 'ThresholdRange',
            commands: command('setThresholdRange', { toolNames: THRESHOLD_RANGE_TOOL_NAMES }),
          },
        ],
      },
    },
    {
      id: 'Shapes',
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-shape',
        label: tb('Shapes'),
        evaluate: [{ name: EVALUATORS.segmentation, toolNames: SHAPE_TOOL_NAMES }],
        commands: activateWorkingSegmentation,
        options: [
          {
            name: tb('Shape'),
            type: 'radio',
            value: LABELMAP_TOOLS.CircleScissor,
            id: 'shape-mode',
            values: [
              { value: LABELMAP_TOOLS.CircleScissor, label: tb('Circle') },
              { value: LABELMAP_TOOLS.SphereScissor, label: tb('Sphere') },
              { value: LABELMAP_TOOLS.RectangleScissor, label: tb('Rectangle') },
            ],
            commands: command('setToolActiveToolbar'),
          },
        ],
      },
    },

    // Pointer buttons (not in OHIF v3): put back each palette's default navigation
    {
      id: POINTER_BUTTONS.labelmap,
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'tool-pointer',
        label: tb('Pointer'),
        evaluate: EVALUATORS.pointer2D,
        commands: command('restoreSegEditor2DNavigation'),
      },
    },
    {
      id: POINTER_BUTTONS.threeD,
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'tool-pointer',
        label: tb('Pointer'),
        evaluate: EVALUATORS.pointer3D,
        commands: command('deactivate3DTools'),
      },
    },

    // 3D tools (act on the 3D editing canvas; ohif-viewers#142, §10.2 and §13): the Lasso and
    // Paint tools build one selection; each tool's whole panel (its own card, then removal, smooth
    // and surface) is one component whose controls read and set the 3D tool state directly
    {
      id: THREE_D_TOOLS.Lasso,
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-freehand-roi',
        label: tb('Lasso'),
        evaluate: { name: EVALUATORS.threeDTool, toolName: THREE_D_TOOLS.Lasso },
        commands: command('toggleSegEditor3DTool', { toolName: THREE_D_TOOLS.Lasso }),
        options: [
          {
            id: 'lasso-panel',
            type: 'custom',
            children: () => React.createElement(SelectionToolPanel, { tool: THREE_D_TOOLS.Lasso }),
          },
        ],
      },
    },
    {
      id: THREE_D_TOOLS.Paint,
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'icon-tool-brush',
        label: tb('Paint'),
        evaluate: { name: EVALUATORS.threeDTool, toolName: THREE_D_TOOLS.Paint },
        commands: command('toggleSegEditor3DTool', { toolName: THREE_D_TOOLS.Paint }),
        options: [
          {
            id: 'paint-panel',
            type: 'custom',
            children: () => React.createElement(SelectionToolPanel, { tool: THREE_D_TOOLS.Paint }),
          },
        ],
      },
    },

    // Section containers
    {
      id: 'SegEditorBrushTools',
      uiType: 'ohif.toolBoxButtonGroup',
      props: { buttonSection: true },
    },
    {
      id: 'SegEditorLabelMapTools',
      uiType: 'ohif.toolBoxButtonGroup',
      props: { buttonSection: true },
    },
    {
      id: 'SegEditor3DTools',
      uiType: 'ohif.toolBoxButtonGroup',
      props: { buttonSection: true },
    },
  ];
}

export default getToolbarButtons;
