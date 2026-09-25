// The Segmentation Editor's tool context: which Cornerstone3D tool group, 2D viewports and working
// segmentation the palette's commands and evaluators act on. The editor layout publishes it once
// its tool group exists and clears it on unmount; while it is unset, every palette tool is disabled.
//
// OHIF v3 resolves this through the ToolGroupService and the active viewport. The Sonador viewer
// has no ToolGroupService, and the editor's working copy is hidden from the SegmentationService
// roster, so the editor supplies its own context instead.

import { ToolGroupManager } from '@cornerstonejs/tools';


let _context = null;
const _listeners = new Set();

function _notify() {
  _listeners.forEach(listener => {
    try {
      listener(_context);
    } catch (err) {
      console.error('[segEditorToolContext] listener failed', err);
    }
  });
}

/**
 * Publish (or update) the editor's tool context.
 *
 * @param {Object} context
 * @param {string} context.toolGroupId - the editor's 2D tool group
 * @param {string[]} [context.viewportIds] - the 2D (Axial/Coronal/Sagittal) viewport ids
 * @param {string} [context.segmentationId] - the editor's working segmentation
 */
export function setSegEditorToolContext({ toolGroupId, viewportIds, segmentationId }) {
  _context = {
    ...(_context?.toolGroupId === toolGroupId ? _context : {}),
    toolGroupId,
    ...(viewportIds ? { viewportIds: [...viewportIds] } : {}),
    ...(segmentationId ? { segmentationId } : {}),
  };
  _notify();
}

/**
 * Record the editor's active 2D viewport: the one keyboard commands (image scrolling) act on. Not
 * a palette change, so listeners are not notified.
 */
export function setSegEditorActiveViewport(viewportId) {
  if (_context && viewportId) {
    _context.activeViewportId = viewportId;
  }
}

/** Clear the context, if it still belongs to the given tool group. */
export function clearSegEditorToolContext(toolGroupId) {
  if (_context && (!toolGroupId || _context.toolGroupId === toolGroupId)) {
    _context = null;
    _notify();
  }
}

/**
 * @returns {{ toolGroupId: string, toolGroup: Object|undefined, viewportIds: string[],
 *   segmentationId: string|undefined, activeViewportId: string|undefined }|null} the active
 *   viewport defaults to the first 2D viewport
 */
export function getSegEditorToolContext() {
  if (!_context) {
    return null;
  }

  return {
    toolGroupId: _context.toolGroupId,
    toolGroup: ToolGroupManager.getToolGroup(_context.toolGroupId),
    viewportIds: _context.viewportIds ?? [],
    segmentationId: _context.segmentationId,
    activeViewportId: _context.activeViewportId ?? _context.viewportIds?.[0],
  };
}

/** Subscribe to context changes; returns an unsubscribe function. */
export function subscribeSegEditorToolContext(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
