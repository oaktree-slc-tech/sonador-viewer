// TrackballRotateTool subclass that tolerates a viewport with nothing in it. The base tool's
// mouse-down handler reads the default actor's mapper unconditionally, which throws on a 3D
// viewport whose volume or surface has not been added yet.

// Configure via: toolGroup.addTool(SonadorTrackballRotateTool.toolName, { onEmptyViewport })
//   onEmptyViewport({ viewportId, toolGroupId }): called once per empty streak (reset when the
//   viewport has an actor again); defaults to a console warning.

import { getEnabledElement } from '@cornerstonejs/core';
import { TrackballRotateTool as C3dTrackballRotateTool } from '@cornerstonejs/tools';


class SonadorTrackballRotateTool extends C3dTrackballRotateTool {

  static toolName = 'SonadorTrackballRotateTool';

  constructor(...args) {
    super(...args);
    this._emptyViewportReported = false;

    // The base class assigns its handler as an instance property, so it is wrapped here rather
    // than overridden as a method
    const preMouseDown = this.preMouseDownCallback;
    this.preMouseDownCallback = (evt) => {
      const viewport = getEnabledElement(evt?.detail?.element)?.viewport;
      if (!viewport?.getDefaultActor?.()?.actor) {
        this._reportEmptyViewport(viewport);
        return true;
      }
      this._emptyViewportReported = false;
      return preMouseDown(evt);
    };
  }

  _reportEmptyViewport(viewport) {
    if (this._emptyViewportReported) {
      return;
    }
    this._emptyViewportReported = true;

    const info = { viewportId: viewport?.id, toolGroupId: this.toolGroupId };
    const { onEmptyViewport } = this.configuration || {};
    if (typeof onEmptyViewport === 'function') {
      onEmptyViewport(info);
    } else {
      console.warn('[SonadorTrackballRotateTool] The viewport has no actor to rotate', info);
    }
  }
}


export default SonadorTrackballRotateTool;
