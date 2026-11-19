// When a defined timepoint becomes active (shown for review only), the classic viewport gives up
// its annotation tools: a drawing in progress is cancelled through cornerstone-tools' manipulator
// state (the tool removes the cancelled annotation and its record), an unfinished multi-stage
// annotation left between its stages (a Cobb angle between its two lines, `complete: false`, with no
// manipulator registered) is discarded with its record and the tool's pending flag, every active
// annotation tool is set passive, and the window/level tool is active again. Completed annotations
// are not touched.

import cornerstone from 'cornerstone-core';
import csTools from 'cornerstone-tools';
import OHIF from '@ohif/core';

const measurements = () => OHIF.measurements || {};
const isAnnotationTool = name => typeof measurements().isAnnotationTool === 'function' && measurements().isAnnotationTool(name);

/** Cancel the manipulation in progress in every enabled element; returns the number of elements cancelled */
function cancelDrawings() {
  const manipulators = typeof csTools.getModule === 'function' ? csTools.getModule('manipulatorState') : undefined;
  const cancel = manipulators && manipulators.setters && manipulators.setters.cancelActiveManipulatorsForElement;
  if (typeof cancel !== 'function' || typeof cornerstone.getEnabledElements !== 'function') {
    return 0;
  }
  let cancelled = 0;
  (cornerstone.getEnabledElements() || []).forEach(({ element }) => {
    if (!element) {
      return;
    }
    try {
      cancel(element);
      cancelled += 1;
    } catch (error) {
      console.warn('[cornerstone:releaseAnnotationTools] drawing not cancelled', error);
    }
  });
  return cancelled;
}

/** Whether a tool-state entry is a drawing not yet finished: a stage still to come, or a handle being moved */
const isUnfinished = data => Boolean(data) && (data.complete === false
  || Object.values(data.handles || {}).some(handle => handle && typeof handle === 'object' && handle.moving === true));

/**
 * Discard every unfinished annotation of the annotation tools from the classic tool state, with its
 * Measurements API representation and service record; returns the discarded entries as
 * [{ toolType, _id }]
 */
function discardUnfinishedAnnotations() {
  const manager = csTools.globalImageIdSpecificToolStateManager;
  const toolState = manager && typeof manager.saveToolState === 'function' ? manager.saveToolState() : undefined;
  const { MeasurementHandlers } = measurements();
  const discarded = [];
  Object.entries(toolState || {}).forEach(([imageId, tools]) => {
    Object.entries(tools || {}).forEach(([toolName, entry]) => {
      if (!isAnnotationTool(toolName) || !entry || !Array.isArray(entry.data)) {
        return;
      }
      const unfinished = entry.data.filter(isUnfinished);
      if (!unfinished.length) {
        return;
      }
      const kept = entry.data.filter(data => !isUnfinished(data));
      if (typeof manager.setImageIdToolState === 'function') {
        manager.setImageIdToolState(imageId, toolName, { ...entry, data: kept });
      } else {
        entry.data = kept;
      }
      unfinished.forEach((data) => {
        data.cancelled = true;
        discarded.push({ toolType: toolName, _id: data._id });
        if (MeasurementHandlers && typeof MeasurementHandlers.onRemoved === 'function') {
          try {
            MeasurementHandlers.onRemoved({ detail: { toolType: toolName, measurementData: data } });
          } catch (error) {
            console.warn('[cornerstone:releaseAnnotationTools] record of an unfinished annotation not removed', toolName, error);
          }
        }
      });
    });
  });
  return discarded;
}

/**
 * Cancel a drawing in progress, discard unfinished annotations, set every active classic annotation
 * tool passive and make window/level the active tool. Returns { cancelled, discarded, released }: the
 * elements cancelled, the entries discarded and the tools released.
 */
export default function releaseAnnotationTools() {
  const cancelled = cancelDrawings();
  const discarded = discardUnfinishedAnnotations();
  const state = csTools.store && csTools.store.state;
  const tools = ((state && state.tools) || []).filter(tool => tool && isAnnotationTool(tool.name));
  // A multi-stage tool waiting for its next stage starts a new drawing afresh
  tools.forEach((tool) => {
    if (tool.hasIncomplete) {
      tool.hasIncomplete = false;
    }
  });
  const released = tools.filter(tool => tool.mode === 'active').map(tool => tool.name);
  if (released.length) {
    released.forEach(name => csTools.setToolPassive(name));
    csTools.setToolActive('Wwwc', { mouseButtonMask: 1 });
  }
  if ((discarded.length || released.length) && typeof measurements().refreshCornerstoneViewports === 'function') {
    measurements().refreshCornerstoneViewports();
  }
  return { cancelled, discarded, released };
}
