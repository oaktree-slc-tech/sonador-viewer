// Moving a view onto a segment (Follow Selected Segment): the camera arithmetic, and a short
// animation between the camera a view has and the one it should have. A 2D view keeps its zoom
// and is translated so the segment's centre is on its slice and in its middle; a 3D view keeps
// its direction and is moved and zoomed so the segment fills it, as Blender's View Selected
// does. Pure functions over Cornerstone3D-shaped cameras ({ position, focalPoint, viewUp,
// parallelScale, parallelProjection, viewAngle }); the views apply the results.

// Room kept around a framed segment (Cornerstone3D's and the model view's fit margin)
export const FIT_MARGIN = 1.1;
// How long a view takes to move; 0 moves it at once
export const FRAME_DURATION_MS = 250;

const _sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const _scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const _length = v => Math.hypot(v[0], v[1], v[2]);

/**
 * The camera translated so `center` is its focal point: the slice and the pan change, the
 * direction, zoom and distance do not.
 *
 * @returns {{ focalPoint: number[], position: number[] }|null} null without a camera
 */
export function pannedCamera(camera, center) {
  if (!camera?.position || !camera?.focalPoint || !center) {
    return null;
  }
  const delta = _sub(center, camera.focalPoint);
  return { focalPoint: [...center], position: _add(camera.position, delta) };
}

/**
 * The camera moved and zoomed onto an extent, its direction kept: the focal point goes to the
 * extent's centre and the view's half-height to the extent's radius plus the margin (a view
 * narrower than tall is zoomed out by its aspect so the width fits too). A parallel camera
 * keeps its distance; a perspective one is placed where its view angle frames the extent. An
 * extent that carries a `frame` (its bounding sphere, segmentExtent) is framed on that, not on
 * its slice target, so the whole segment is in view.
 *
 * @param {Object} camera
 * @param {{ center: number[], radius: number, frame?: { center: number[], radius: number } }} extent
 * @param {Object} [options]
 * @param {number} [options.aspect=1] - the view's width / height
 * @param {number} [options.margin=FIT_MARGIN]
 * @returns {{ focalPoint: number[], position: number[], parallelScale?: number }|null}
 */
export function framedCamera(camera, extent, { aspect = 1, margin = FIT_MARGIN } = {}) {
  const sphere = extent?.frame?.center ? extent.frame : extent;
  if (!camera?.position || !camera?.focalPoint || !sphere?.center) {
    return null;
  }
  const { center } = sphere;
  const radius = Math.max(sphere.radius || 0, 1e-3);
  const halfHeight = (radius * margin) / Math.min(1, aspect > 0 ? aspect : 1);
  const toCamera = _sub(camera.position, camera.focalPoint);
  const distance = _length(toCamera);
  const direction = distance ? _scale(toCamera, 1 / distance) : [0, 0, 1];

  if (camera.parallelProjection === false) {
    const halfAngle = ((camera.viewAngle || 30) * Math.PI) / 360;
    const fitted = halfHeight / Math.tan(halfAngle) + radius;
    return { focalPoint: [...center], position: _add(center, _scale(direction, fitted)) };
  }
  return {
    focalPoint: [...center],
    position: _add(center, _scale(direction, distance || radius * 3)),
    parallelScale: halfHeight,
  };
}

const _easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/**
 * The camera between two, for the fields `to` carries: numbers and number arrays interpolate,
 * anything else takes `to`'s value.
 */
export function lerpCamera(from, to, t) {
  const result = {};
  Object.keys(to).forEach(key => {
    const a = from?.[key];
    const b = to[key];
    if (Array.isArray(b) && Array.isArray(a) && a.length === b.length) {
      result[key] = b.map((value, i) => a[i] + (value - a[i]) * t);
    } else if (typeof b === 'number' && typeof a === 'number') {
      result[key] = a + (b - a) * t;
    } else {
      result[key] = b;
    }
  });
  return result;
}

/**
 * Move a camera from `from` to `to` over `duration` ms, applying each step; `duration` 0 applies
 * `to` at once. Returns a function that cancels the movement where it is.
 *
 * @param {Object} params
 * @param {Object} params.from
 * @param {Object} params.to
 * @param {Function} params.apply - (camera) => void
 * @param {number} [params.duration=FRAME_DURATION_MS]
 * @param {Function} [params.onDone] - called after the last step, not after a cancel
 * @param {Function} [params.raf] - requestAnimationFrame, for tests
 * @param {Function} [params.now] - a clock in ms, for tests
 * @returns {Function} cancel
 */
export function animateCamera({
  from, to, apply, duration = FRAME_DURATION_MS, onDone,
  raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimeout(() => callback(Date.now()), 16),
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
}) {
  if (!to) {
    return () => {};
  }
  if (!(duration > 0) || !from) {
    apply(to);
    onDone?.();
    return () => {};
  }
  let cancelled = false;
  const start = now();
  const step = () => {
    if (cancelled) {
      return;
    }
    const t = Math.min(1, (now() - start) / duration);
    apply(t >= 1 ? to : lerpCamera(from, to, _easeInOut(t)));
    if (t >= 1) {
      onDone?.();
      return;
    }
    raf(step);
  };
  raf(step);
  return () => {
    cancelled = true;
  };
}
