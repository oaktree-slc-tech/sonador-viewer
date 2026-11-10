// cornerstone-tools annotation tools that leave a locked measurement alone. A measurement read from
// a stored report, or saved, is locked and read-only: it is drawn, and shown or hidden, but the
// pointer neither selects it, moves its handles, nor translates it. cornerstone-tools v4 has no
// lock of its own; its pointer dispatch selects a handle (handleSelectedCallback) or the whole
// annotation (pointNearTool, then toolSelectedCallback), and both are declined here. The arrow's
// text edit (double-click or touch press on the arrow or its text box) is declined too.

import csTools from 'cornerstone-tools';

/** Whether cornerstone-tools tool data belongs to a locked or read-only measurement */
function isLockedToolData(data) {
  if (!data) {
    return false;
  }
  const sections = [data, data.metadata, data.measurementData, data.measurementData && data.measurementData.metadata];
  return sections.some(section => section && (section.isLocked === true || section.isReadOnly === true));
}

/** A subclass of a cornerstone-tools annotation tool that declines pointer input on locked data */
function lockable(ToolClass) {
  class LockableTool extends ToolClass {
    pointNearTool(element, data, ...args) {
      return isLockedToolData(data) ? false : super.pointNearTool(element, data, ...args);
    }

    handleSelectedCallback(evt, data, ...args) {
      if (isLockedToolData(data)) {
        return false;
      }
      return super.handleSelectedCallback(evt, data, ...args);
    }

    toolSelectedCallback(evt, data, ...args) {
      if (isLockedToolData(data)) {
        return false;
      }
      return super.toolSelectedCallback(evt, data, ...args);
    }
  }

  // The arrow edits the text of the first annotation whose line or text box is under the pointer
  // (cornerstone-tools 6.0.10 `_updateTextForNearbyAnnotation`, for double-click and touch press).
  // The same lookup here: a locked annotation found first takes the event and is left unchanged.
  if (typeof ToolClass.prototype._updateTextForNearbyAnnotation === 'function') {
    LockableTool.prototype._updateTextForNearbyAnnotation = function updateTextForNearbyAnnotation(evt) {
      const { element } = evt.detail;
      const coords = evt.detail.currentPoints.canvas;
      const toolState = csTools.getToolState(element, this.name);
      if (!toolState) {
        return false;
      }
      const pointInsideBoundingBox = csTools.importInternal('util/pointInsideBoundingBox');
      const hit = toolState.data.find(data => ToolClass.prototype.pointNearTool.call(this, element, data, coords)
        || Boolean(data.handles && data.handles.textBox && pointInsideBoundingBox(data.handles.textBox, coords)));
      if (!hit) {
        return false;
      }
      evt.stopImmediatePropagation();
      evt.preventDefault();
      evt.stopPropagation();
      if (isLockedToolData(hit)) {
        return true;
      }
      hit.active = true;
      csTools.external.cornerstone.updateImage(element);
      this.configuration.changeTextCallback(hit, evt.detail, this._doneChangingTextCallback.bind(this, element, hit));
      return true;
    };
  }

  // The extension keys its tool configuration by class name (init.js)
  Object.defineProperty(LockableTool, 'name', { value: ToolClass.name });
  return LockableTool;
}


export default lockable;
export { isLockedToolData, lockable };
