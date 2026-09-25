// ToolbarService evaluators for the Segmentation Editor palettes. Adapted from the OHIF v3
// `evaluate.cornerstoneTool` (extensions/cornerstone) and `evaluate.cornerstone.segmentation*`
// (extensions/cornerstone-dicom-seg) evaluators: the tool group, viewports and segmentation come
// from the editor's tool context rather than the ToolGroupService and the active viewport.

import {
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import i18n from '@ohif/i18n';

import { EVALUATORS } from './constants';
import { LABELMAP_TOOL_NAMES } from './segEditorTools';
import { getSegEditorToolContext } from './segEditorToolContext';
import { get3DToolState } from '../threeDTools/threeDToolState';


const disabled = disabledText => ({ disabled: true, isActive: false, disabledText });

function _isPrimaryActive(toolGroup, toolName, toolNames) {
  const primaryToolName = toolGroup.getActivePrimaryMouseButtonTool();
  return toolNames ? toolNames.includes(primaryToolName) : primaryToolName === toolName;
}

/**
 * @param {Object} params
 * @param {Object} params.servicesManager
 * @returns {Object[]} toolbar module entries ({ name, evaluate })
 */
export default function getSegEditorEvaluators({ servicesManager }) {
  const toolbarService = () => servicesManager.services.toolbarService;

  return [
    {
      // Active when the button's tool (or one of toolNames) holds the primary mouse binding
      name: EVALUATORS.tool,
      evaluate: ({ button, toolNames, disabledText }) => {
        const toolGroup = getSegEditorToolContext()?.toolGroup;
        if (!toolGroup) {
          return disabled(disabledText ?? i18n.t('The editor is not ready', { ns: 'SegmentationEditor' }));
        }

        const toolName = toolbarService().getToolNameForButton(button);
        if (!toolNames && !toolGroup.hasTool(toolName)) {
          return disabled(disabledText);
        }

        return {
          disabled: false,
          isActive: _isPrimaryActive(toolGroup, toolName, toolNames),
        };
      },
    },
    {
      // As above, and additionally requires the working segmentation to have at least one segment
      name: EVALUATORS.segmentation,
      evaluate: ({ button, toolNames, disabledText }) => {
        const context = getSegEditorToolContext();
        const toolGroup = context?.toolGroup;
        const segmentation = context?.segmentationId
          ? c3dSegmentations.state.getSegmentation(context.segmentationId)
          : undefined;

        if (!toolGroup || !segmentation) {
          return disabled(disabledText ?? i18n.t('The editor is not ready', { ns: 'SegmentationEditor' }));
        }

        if (!Object.keys(segmentation.segments ?? {}).length) {
          return disabled(i18n.t('Add a segment to enable this tool', { ns: 'SegmentationEditor' }));
        }

        if (!toolNames) {
          return { disabled: false };
        }

        const toolName = toolbarService().getToolNameForButton(button);
        return {
          disabled: false,
          isActive: _isPrimaryActive(toolGroup, toolName, toolNames),
        };
      },
    },
    {
      // 3D tools: available while the 3D editing canvas has an editable target segment, active
      // while selected in the 3D tool state
      name: EVALUATORS.threeDTool,
      evaluate: ({ toolName }) => {
        const { target, activeTool, busy } = get3DToolState();
        if (!target) {
          return disabled(i18n.t('The 3D surface is not available yet.', { ns: 'SegmentationEditor' }));
        }
        if (target.disabledReason) {
          return disabled(target.disabledReason);
        }
        return { disabled: busy, isActive: activeTool === toolName };
      },
    },
    {
      // Labelmap palette Pointer: active while no labelmap tool holds the left mouse button
      name: EVALUATORS.pointer2D,
      evaluate: () => {
        const toolGroup = getSegEditorToolContext()?.toolGroup;
        if (!toolGroup) {
          return disabled(i18n.t('The editor is not ready', { ns: 'SegmentationEditor' }));
        }
        return {
          disabled: false,
          isActive: !LABELMAP_TOOL_NAMES.includes(toolGroup.getActivePrimaryMouseButtonTool()),
        };
      },
    },
    {
      // 3D palette Pointer: active while no 3D tool is
      name: EVALUATORS.pointer3D,
      evaluate: () => ({ disabled: get3DToolState().busy, isActive: !get3DToolState().activeTool }),
    },
    {
      // Keep the Selection tool's removal depth option in step with the 3D tool state (Remove and
      // Clear do nothing while no points are selected)
      name: EVALUATORS.synchronizeSelectionOptions,
      evaluate: ({ button }) => {
        const { removalDepth } = get3DToolState();
        (button?.props?.options ?? button?.options ?? []).forEach(option => {
          if (option.id === 'removal-depth') {
            option.value = removalDepth;
          }
        });
      },
    },
    {
      // Keep the radius option in step with the brush size shared by the brush-based tools
      name: EVALUATORS.synchronizeDrawingRadius,
      evaluate: ({ button, radiusOptionId }) => {
        const toolGroupId = getSegEditorToolContext()?.toolGroupId;
        if (!toolGroupId) {
          return;
        }

        const brushSize = c3dToolsUtilities.segmentation.getBrushSizeForToolGroup(toolGroupId);
        const option = brushSize ? toolbarService().getOptionById(button, radiusOptionId) : null;
        if (option) {
          option.value = brushSize;
        }
      },
    },
  ];
}
