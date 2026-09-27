// Trackball rotation for a Three.js view, matching Cornerstone3D's TrackballRotateTool: a
// horizontal drag turns the camera about its own up axis, a vertical drag about its own right
// axis, both through the orbit target and with no clamp, so roll accumulates as it does in the
// VTK 3D viewports. camera-controls' orbit (a fixed up axis, polar angle clamped at the poles) is
// what the M3D viewer keeps; this replaces only the rotate button.

import { Quaternion, Vector3 } from 'three';

// Cornerstone3D's rotateIncrementDegrees (a factor on the drag, despite the name)
export const DEFAULT_ROTATE_SPEED = 2;

// Pointer `button` numbers by camera-controls button name
export const POINTER_BUTTONS = { left: 0, middle: 1, right: 2 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The camera after a drag from `previous` to `current` (positions normalized to the canvas,
 * [0..1] across and down). `position`, `target` and `up` are [x, y, z]; `up` is the screen-up
 * direction. Returns { position, up } or null when the drag is too small to turn.
 */
export function trackballRotate({ position, target, up, previous, current, rotateSpeed = DEFAULT_ROTATE_SPEED }) {
  // Cornerstone3D maps the horizontal drag onto a virtual sphere of radius 1.5 (canvas units)
  const radsq = (1 + 0.5) ** 2;
  const op = previous[0];
  const oe = current[0];
  const lop = op * op > radsq ? 0 : Math.sqrt(radsq - op * op);
  const loe = oe * oe > radsq ? 0 : Math.sqrt(radsq - oe * oe);
  const nop = new Vector3(op, 0, lop).normalize();
  const noe = new Vector3(oe, 0, loe).normalize();
  const dot = nop.dot(noe);
  if (Math.abs(dot) <= 0.0001) {
    return null;
  }

  const angleX = -2 * Math.acos(clamp(dot, -1, 1)) * Math.sign(oe - op) * rotateSpeed;
  const angleY = (previous[1] - current[1]) * rotateSpeed;

  // Axes of the camera before either turn: `at` points from the target toward the camera
  const center = new Vector3(...target);
  const at = new Vector3(...position).sub(center).normalize();
  const upVec = new Vector3(...up).normalize();
  const right = new Vector3().crossVectors(upVec, at).normalize();
  const forward = new Vector3().crossVectors(at, right).normalize();

  const rotation = new Quaternion().setFromAxisAngle(forward, angleX)
    .premultiply(new Quaternion().setFromAxisAngle(right, angleY));

  const newPosition = new Vector3(...position).sub(center).applyQuaternion(rotation).add(center);
  const newUp = upVec.clone().applyQuaternion(rotation).normalize();
  return { position: newPosition.toArray(), up: newUp.toArray() };
}


export class TrackballRotation {
  // Pointer wiring: a drag with the rotate button reports normalized previous / current
  // positions to `onRotate`. Mouse and pen only; touches stay with camera-controls.

  constructor(element, { getButton, onRotate }) {
    this.element = element;
    this.getButton = getButton;
    this.onRotate = onRotate;
    this._pointerId = null;
    this._last = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    element.addEventListener('pointerdown', this._onPointerDown);
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this._endDrag();
  }

  get dragging() {
    return this._pointerId !== null;
  }

  _normalized(event) {
    const rect = this.element.getBoundingClientRect();
    return [
      (event.clientX - rect.left) / (rect.width || 1),
      (event.clientY - rect.top) / (rect.height || 1),
    ];
  }

  _onPointerDown(event) {
    if (event.pointerType === 'touch' || this._pointerId !== null || event.button !== this.getButton()) {
      return;
    }
    event.preventDefault();
    this._pointerId = event.pointerId;
    this._last = this._normalized(event);

    const doc = this.element.ownerDocument || document;
    doc.addEventListener('pointermove', this._onPointerMove);
    doc.addEventListener('pointerup', this._onPointerUp);
    doc.addEventListener('pointercancel', this._onPointerUp);
  }

  _onPointerMove(event) {
    if (event.pointerId !== this._pointerId) {
      return;
    }
    const current = this._normalized(event);
    this.onRotate(this._last, current);
    this._last = current;
  }

  _onPointerUp(event) {
    if (event.pointerId === this._pointerId) {
      this._endDrag();
    }
  }

  _endDrag() {
    if (this._pointerId === null) {
      return;
    }
    this._pointerId = null;
    this._last = null;
    const doc = this.element.ownerDocument || document;
    doc.removeEventListener('pointermove', this._onPointerMove);
    doc.removeEventListener('pointerup', this._onPointerUp);
    doc.removeEventListener('pointercancel', this._onPointerUp);
  }
}
