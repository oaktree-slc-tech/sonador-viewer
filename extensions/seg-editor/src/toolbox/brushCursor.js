// Brush cursor lifecycle for the editor's 2D viewports.
//
// Cornerstone3D's BrushTool (4.22) draws its cursor from hover state that covers only the viewport
// under the pointer, and nothing erases it when the pointer leaves: the viewport left behind keeps
// its last cursor until something else re-renders it. Moving across the Axial, Coronal and
// Sagittal views therefore left a brush circle in each. On leaving a viewport, the brush-based
// tools' hover state for that viewport is dropped and its annotation layer re-rendered, so only
// the viewport under the pointer shows a cursor.

import { utilities as c3dToolsUtilities } from '@cornerstonejs/tools';


/**
 * Remove any brush cursor drawn in a viewport.
 *
 * @param {string} toolGroupId - the editor's 2D tool group
 * @param {string} viewportId - the viewport the pointer left
 */
export function clearBrushCursor(toolGroupId, viewportId) {
  c3dToolsUtilities.segmentation.getBrushToolInstances(toolGroupId).forEach(tool => {
    // Only the viewport being left: if the pointer already reached the next viewport, that
    // viewport's hover state (and cursor) stays. Same reset as BrushTool.disableCursor(), without
    // its preview rejection.
    if (tool._hoverData?.viewport?.id === viewportId) {
      tool._hoverData = undefined;
    }
  });

  c3dToolsUtilities.triggerAnnotationRenderForViewportIds([viewportId]);
}

/**
 * Clear the brush cursor whenever the pointer leaves a viewport's element.
 *
 * @returns {Function} detach
 */
export function attachBrushCursorClearing({ toolGroupId, viewportId, element }) {
  let pendingMouseUp = null;

  const clearAfterStroke = () => {
    pendingMouseUp = null;
    if (!element.matches(':hover')) {
      clearBrushCursor(toolGroupId, viewportId);
    }
  };

  const onMouseLeave = (evt) => {
    // A stroke dragged across the edge is left alone until it ends
    if (evt.buttons) {
      if (!pendingMouseUp) {
        pendingMouseUp = clearAfterStroke;
        document.addEventListener('mouseup', pendingMouseUp, { once: true });
      }
      return;
    }
    clearBrushCursor(toolGroupId, viewportId);
  };

  element.addEventListener('mouseleave', onMouseLeave);
  return () => {
    element.removeEventListener('mouseleave', onMouseLeave);
    if (pendingMouseUp) {
      document.removeEventListener('mouseup', pendingMouseUp);
      pendingMouseUp = null;
    }
  };
}
