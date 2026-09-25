import _ from 'lodash';

import {
  getEnabledElementByViewportId,
  utilities as c3dUtilities,
  VolumeViewport,
} from '@cornerstonejs/core';
import {
  Enums as c3dToolsEnums,
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import { cache as c3dCache } from '@cornerstonejs/core';
import OHIF from '@ohif/core';
import i18n from '@ohif/i18n';
import { cornerstone3dUtils, createViewportToggleFeatureCommand } from '@ohif/extension-vtk';

import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';

import { callConfirmDialog } from './components/confirmDialog';

import { Enums as SegEditEnums } from './enums';
import { IMAGING_TOOLS, STACK_SCROLL_TOOL } from './toolbox/constants';
import { getSegEditorToolContext } from './toolbox/segEditorToolContext';
import { redoSegEditorEdit, undoSegEditorEdit } from './toolbox/segEditorHistory';
import { LABELMAP_TOOL_NAMES } from './toolbox/segEditorTools';
import {
  get3DToolState,
  request3DToolAction,
  setActive3DTool,
  setRemovalDepth,
} from './threeDTools/threeDToolState';

import setSegmentationEditorLayout from './utils/setSegmentationEditorLayout.js';


const { DisplaySetApi } = OHIF.display;

const PRIMARY_BINDING = [{ mouseButton: c3dToolsEnums.MouseBindings.Primary }];
const BRUSH_SIZE_STEP = 3;


// Whether a segmentation's voxels include any segment (the working copy's display volume when it
// has one, else the stored voxels). Unknown counts as painted, so nothing is discarded unasked.
export function segmentationHasContent(segmentationId, {
  getSegmentation = id => c3dSegmentations.state.getSegmentation(id),
  getVolume = id => c3dCache.getVolume(id),
  getVoxels = id => cornerstone3dUtils.getSegmentationVoxels(id),
} = {}) {
  const volumeId = getSegmentation(segmentationId)?.representationData?.Labelmap?.volumeId;
  const voxels = (volumeId && getVolume(volumeId)?.voxelManager?.getCompleteScalarDataArray())
    || getVoxels(segmentationId);
  if (!voxels) {
    return true;
  }
  for (let i = 0; i < voxels.length; i++) {
    if (voxels[i]) {
      return true;
    }
  }
  return false;
}

const commandsModule = ({ servicesManager, commandsManager, appConfig }) => {

  // Reference cache for segmentation editor API instances
  let apis = {};

  // Tool palette commands (ohif-viewers#142), adapted from the OHIF v3 cornerstone extension.
  // They act on the editor's own 2D tool group, published through the editor tool context.

  function _toolGroup() {
    return getSegEditorToolContext()?.toolGroup;
  }

  function _refreshToolbar() {
    servicesManager.services.toolbarService?.refreshToolbarState({});
  }

  function _scrollActiveViewport(delta) {
    // Step the editor's active 2D viewport through its slices
    const viewportId = getSegEditorToolContext()?.activeViewportId;
    const viewport = viewportId && getEnabledElementByViewportId(viewportId)?.viewport;
    if (!viewport) {
      return;
    }
    const volumeId = viewport instanceof VolumeViewport ? viewport.getVolumeId() : undefined;
    c3dUtilities.scroll(viewport, { delta, volumeId });
  }

  function _changeBrushSize(delta) {
    const toolGroupId = getSegEditorToolContext()?.toolGroupId;
    const brushSize = toolGroupId && c3dToolsUtilities.segmentation.getBrushSizeForToolGroup(toolGroupId);
    if (brushSize) {
      c3dToolsUtilities.segmentation.setBrushSizeForToolGroup(toolGroupId, brushSize + delta);
      _refreshToolbar();
    }
  }

  const toolActions = {
    setToolActive({ toolName, bindings = PRIMARY_BINDING }) {
      // Bind the tool to the primary mouse button, releasing the tool that held it. Tools with
      // other bindings (Zoom on right-click, Pan on middle-click) keep them.
      const toolGroup = _toolGroup();
      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();
      if (activeToolName && activeToolName !== toolName) {
        toolGroup.getToolConfiguration(activeToolName)?.disableOnPassive
          ? toolGroup.setToolDisabled(activeToolName)
          : toolGroup.setToolPassive(activeToolName);
      }

      toolGroup.setToolActive(toolName, { bindings });
    },

    setToolActiveToolbar({ value, itemId, toolName, bindings }) {
      // Tools with options pass the tool as `value`; toolbar buttons pass it as `itemId`
      toolActions.setToolActive({ toolName: toolName || itemId || value, bindings });
    },

    deactivateLabelmapTools() {
      // Leaving the Labelmap palette: return the primary binding to Window/Level if a labelmap
      // tool holds it. An imaging tool the user chose (Zoom, Pan) is left in place.
      const toolGroup = _toolGroup();
      if (!toolGroup) {
        return;
      }

      if (LABELMAP_TOOL_NAMES.includes(toolGroup.getActivePrimaryMouseButtonTool())) {
        toolActions.setToolActive({ toolName: IMAGING_TOOLS.WindowLevel });
      }
      _refreshToolbar();
    },

    restoreSegEditor2DNavigation() {
      // Labelmap palette Pointer: the 2D views' default navigation, as the editor sets it up
      // (Window/Level on the left button, Zoom right, Pan middle, scrolling on the wheel)
      const toolGroup = _toolGroup();
      if (!toolGroup) {
        return;
      }
      toolActions.setToolActive({ toolName: IMAGING_TOOLS.WindowLevel });
      [
        [IMAGING_TOOLS.Zoom, c3dToolsEnums.MouseBindings.Secondary],
        [IMAGING_TOOLS.Pan, c3dToolsEnums.MouseBindings.Auxiliary],
        [STACK_SCROLL_TOOL, c3dToolsEnums.MouseBindings.Wheel],
      ].forEach(([toolName, mouseButton]) => {
        if (toolGroup.hasTool(toolName)) {
          toolGroup.setToolActive(toolName, { bindings: [{ mouseButton }] });
        }
      });
      _refreshToolbar();
    },

    activateSelectedSegmentationOfType() {
      // Labelmap tools paint the viewport's active segmentation: make sure that is the editor's
      // working copy on every 2D view (never the source segmentation).
      const { segmentationId, viewportIds = [] } = getSegEditorToolContext() ?? {};
      if (!segmentationId) {
        return;
      }

      viewportIds.forEach(viewportId => {
        const active = c3dSegmentations.activeSegmentation.getActiveSegmentation(viewportId);
        if (active?.segmentationId !== segmentationId) {
          c3dSegmentations.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
        }
      });
    },

    setBrushSize({ value }) {
      // One radius is shared by the brush-based tools (Brush, Eraser, Threshold), as in v3
      const toolGroupId = getSegEditorToolContext()?.toolGroupId;
      if (toolGroupId) {
        c3dToolsUtilities.segmentation.setBrushSizeForToolGroup(toolGroupId, Number(value));
      }
    },

    increaseBrushSize() {
      _changeBrushSize(BRUSH_SIZE_STEP);
    },

    decreaseBrushSize() {
      _changeBrushSize(-BRUSH_SIZE_STEP);
    },

    // Image scrolling on the active 2D viewport. The names match the viewer's hotkey commands, so
    // the configured Up / Down hotkeys drive the editor while it is the active viewport; the
    // editor's own A / D keys run them too (toolbox/segEditorKeyboard.js). Up is the previous
    // image, as in OHIF v3.
    nextImage() {
      _scrollActiveViewport(1);
    },

    previousImage() {
      _scrollActiveViewport(-1);
    },

    // Undo / redo the editor's labelmap and 3D edits (one shared history)
    undoSegEditor() {
      // An edit the active tool is still recording is committed first, as the tools' own undo does
      const toolGroup = _toolGroup();
      const activeTool = toolGroup?.getToolInstance?.(toolGroup.getActivePrimaryMouseButtonTool());
      activeTool?.doneEditMemo?.();
      undoSegEditorEdit();
    },

    redoSegEditor() {
      redoSegEditorEdit();
    },

    toggleSegEditor3DTool({ toolName }) {
      // 3D tools act on the 3D editing canvas; clicking the active one releases it (the left
      // button goes back to rotating the view)
      setActive3DTool(get3DToolState().activeTool === toolName ? null : toolName);
      _refreshToolbar();
    },

    deactivate3DTools() {
      setActive3DTool(null);
      _refreshToolbar();
    },

    setSegEditor3DRemovalDepth({ value }) {
      setRemovalDepth(value);
    },

    requestSegEditor3DAction({ request }) {
      // Palette buttons acting on the 3D editing canvas (delete / clear the selection)
      return request3DToolAction(request);
    },

    setThresholdRange({ value, toolNames = [] }) {
      const toolGroup = _toolGroup();
      toolNames.forEach(toolName => {
        if (toolGroup?.hasTool(toolName)) {
          toolGroup.setToolConfiguration(toolName, { threshold: { range: value } });
        }
      });
    },
  };

  const actions = {
    async closeSegEditor({ viewports } = {}) {
      // Exit Segmentation Editor. A segmentation created in the viewer exists only in memory, so
      // closing on one with painted voxels asks first (ohif-viewers#143, FR-10).
      const { activeViewportIndex, viewportSpecificData } = viewports || {};
      const displaySetInstanceUID = viewportSpecificData?.[activeViewportIndex]?.displaySetInstanceUID;
      const _ds = displaySetInstanceUID
        && DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      const workingSegmentationId = _ds?.segmentationId;

      if (workingSegmentationId
          && cornerstone3dUtils.getInMemorySegmentationInfo(workingSegmentationId)
          && segmentationHasContent(workingSegmentationId)) {
        const t = key => i18n.t(key, { ns: 'SegmentationEditor' });
        const discard = await callConfirmDialog({
          uiDialogService: servicesManager.services.UIDialogService,
          id: 'seg-editor-discard-confirm',
          title: t('Discard Segmentation?'),
          message: t('This segmentation has not been saved. Closing the editor discards it.'),
          confirmText: t('Discard'),
          cancelText: t('Cancel'),
        });
        if (!discard) {
          // The Exit button shows the layout button as it is clicked; the editor stays open
          useLayoutButton.getState().setIsDisplayedLayoutButton(false);
          return false;
        }
      }

      // Enable default (Cornerstone) layout for the viewer
      commandsManager.runCommand('setCornerstoneLayout');
      return true;
    },

    segmentationEditor: async ({ viewports }) => {
      // Open segmentation editor

      // Retrieve currently active display set
      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];

      // Set layout of viewport for CT volume viewer
      try {
        // Retrieve Segmentation editor API reference
        apis = await setSegmentationEditorLayout(displaySet, [{}]);
      } catch (err) {
        throw new Error(err);
      }
    },
  };


  const definitions = {
    // Tool palettes
    ...Object.fromEntries(
      Object.entries(toolActions).map(([name, commandFn]) => [name, { commandFn, options: {} }])
    ),

    closeSegEditor: {
      commandFn: actions.closeSegEditor,
      storeContexts: ['viewports'],
      options: {},
    },
    segmentationEditor: {
      commandFn: actions.segmentationEditor,
      storeContexts: ['viewports'],
      options: {},
      context: 'VIEWER',
    },

    // 3D-viewport rendering toggles: flip the editor-scoped displaySet attributes and republish
    // (same pattern as toggleVolumeRendering / toggleSegmentationSurface in the volume viewer).
    // The attributes are initialized during editor load (OHIFSegmentationEditorViewport) and are
    // deliberately distinct from the volume viewer's imageVolumeRenderingEnabled /
    // segmentationSurfaceEnabled, which carry panel-visibility semantics elsewhere.
    toggleSegEditorVolumeRendering: {
      commandFn: createViewportToggleFeatureCommand('segEditorVolumeRenderingEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
    // 3D tab: Three.js editing canvas (on while the tool palette's 3D tab is selected). Sets rather
    // than toggles the editor-scoped displaySet attribute; like the toggles above, it only acts
    // once the editor has initialized the attribute.
    setSegEditor3DEditing: {
      commandFn: ({ viewports, enabled }) => {
        const { activeViewportIndex, viewportSpecificData } = viewports || {};
        const displaySetInstanceUID = viewportSpecificData?.[activeViewportIndex]?.displaySetInstanceUID;
        const _ds = displaySetInstanceUID
          && DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);

        if (_ds && !_.isNil(_ds.segEditor3dEditingEnabled) && _ds.segEditor3dEditingEnabled !== !!enabled) {
          _ds.segEditor3dEditingEnabled = !!enabled;
          DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
        }
      },
      storeContexts: ['viewports'],
      options: {},
    },
    toggleSegEditorSurfaceRendering: {
      commandFn: createViewportToggleFeatureCommand('segEditorSurfaceRenderingEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
  };

  return {
    definitions,
    defaultContext: SegEditEnums.ACTIVE_VIEWPORT,
  };
};


export default commandsModule;
