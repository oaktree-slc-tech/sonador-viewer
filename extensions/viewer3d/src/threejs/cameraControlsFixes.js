// Corrections to camera-controls (2.10) behaviour used by M3DModelView.

/**
 * Make wheel and pinch zoom of an orthographic camera accumulate.
 *
 * camera-controls zooms an orthographic camera through `_zoomInternal`, which scales the CURRENT,
 * still-smoothing zoom (`_zoom`) rather than the zoom being approached (`_zoomEnd`). A wheel tick
 * that arrives while an earlier one is still animating therefore restarts from a lagging value:
 * several ticks between frames count as one, and continuous scrolling makes the target jump back
 * and forth, which reads as a stuttering zoom. A perspective camera's wheel dolly
 * (`_dollyInternal`) scales the end value (`_sphericalEnd.radius`) and is smooth, which is why only
 * orthographic views were affected.
 *
 * This replaces the controls instance's `_zoomInternal` with the same computation based on
 * `_zoomEnd`. Zoom-to-cursor bookkeeping (`_changedZoom`) is kept consistent: it records the
 * change of the zoom target, which the controls' update loop then consumes frame by frame.
 *
 * @param {Object} controls - a CameraControls instance
 * @returns {boolean} true when the correction was installed
 */
export function accumulateOrthographicZoom(controls) {
  if (!controls || typeof controls._zoomInternal !== 'function' || typeof controls.zoomTo !== 'function') {
    return false;
  }

  controls._zoomInternal = (delta, x, y) => {
    const zoomScale = Math.pow(0.95, delta * controls.dollySpeed);
    const lastZoomEnd = controls._zoomEnd;
    const zoom = lastZoomEnd * zoomScale;

    controls.zoomTo(zoom, true);

    if (controls.dollyToCursor) {
      // zoomTo clamps to minZoom/maxZoom: record the change that was actually applied
      controls._changedZoom += controls._zoomEnd - lastZoomEnd;
      controls._dollyControlCoord.set(x, y);
    }
  };
  return true;
}

export default accumulateOrthographicZoom;
