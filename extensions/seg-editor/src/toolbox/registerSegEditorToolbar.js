// Registers the Segmentation Editor palette buttons and sections with the ToolbarService, and
// keeps their evaluated state (active/disabled) current. Idempotent: the buttons and their option
// values (e.g. the brush radius) persist across editor sessions.

import { eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import { Enums as c3dToolsEnums } from '@cornerstonejs/tools';

import { HISTORY_BUTTONS, POINTER_BUTTONS, SECTIONS } from './constants';
import { subscribeSegEditorToolContext } from './segEditorToolContext';
import { getToolbarButtons } from './toolbarButtons';
import { subscribe3DToolState, THREE_D_TOOLS } from '../threeDTools/threeDToolState';


// Events after which the palette state may have changed: tool bindings, and segments added or
// removed on the working segmentation.
const C3D_REFRESH_EVENTS = [
  c3dToolsEnums.Events.TOOL_ACTIVATED,
  c3dToolsEnums.Events.TOOL_MODE_CHANGED,
  c3dToolsEnums.Events.SEGMENTATION_MODIFIED,
  c3dToolsEnums.Events.SEGMENTATION_REPRESENTATION_ADDED,
  c3dToolsEnums.Events.SEGMENTATION_REPRESENTATION_REMOVED,
  c3dToolsEnums.Events.SEGMENTATION_REMOVED,
];

const _registered = new WeakSet();

/**
 * @param {Object} servicesManager
 * @returns {boolean} true when the palette is (already) registered
 */
export function registerSegEditorToolbar(servicesManager) {
  const toolbarService = servicesManager?.services?.toolbarService;
  if (!toolbarService) {
    return false;
  }
  if (_registered.has(toolbarService)) {
    return true;
  }

  const buttons = getToolbarButtons();
  toolbarService.register(buttons);

  // Resolve named evaluators up front. The ToolbarService otherwise resolves a nested section's
  // evaluators only once that section is rendered, and a refresh before then reads them as absent.
  buttons.forEach(({ id }) => toolbarService.handleEvaluate(toolbarService.getButtonProps(id)));

  toolbarService.updateSection(SECTIONS.labelMapToolbox, [SECTIONS.labelMapTools]);
  toolbarService.updateSection(SECTIONS.labelMapTools, [POINTER_BUTTONS.labelmap, SECTIONS.brushTools, 'Shapes']);
  toolbarService.updateSection(SECTIONS.brushTools, ['Brush', 'Eraser', 'Threshold']);
  toolbarService.updateSection(SECTIONS.imagingTools,
    ['WindowLevel', 'Zoom', 'Pan', HISTORY_BUTTONS.undo, HISTORY_BUTTONS.redo]);
  toolbarService.updateSection(SECTIONS.threeDToolbox, [SECTIONS.threeDTools]);
  toolbarService.updateSection(SECTIONS.threeDTools, [POINTER_BUTTONS.threeD, THREE_D_TOOLS.Selection]);

  toolbarService.registerEventForToolbarUpdate(c3dEventTarget, C3D_REFRESH_EVENTS);
  subscribeSegEditorToolContext(() => toolbarService.refreshToolbarState({}));
  subscribe3DToolState(() => toolbarService.refreshToolbarState({}));

  _registered.add(toolbarService);
  toolbarService.refreshToolbarState({});
  return true;
}

export default registerSegEditorToolbar;
