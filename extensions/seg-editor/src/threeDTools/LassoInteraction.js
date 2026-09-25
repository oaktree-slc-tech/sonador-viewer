// Pointer and keyboard handling for the 3D Selection tool (ohif-viewers#142, FR-18/FR-19).
//
// While enabled, a left-button drag on the canvas draws a lasso (shown as an SVG outline over the
// canvas) and reports it in normalized device coordinates with the selection mode from the
// modifier keys held when the drag started (Shift adds, Ctrl/Cmd subtracts). Escape asks to clear
// the selection and Delete/Backspace to delete it. The other mouse buttons and the wheel are left
// to the camera controls, which the caller rebinds (right rotates, middle pans).

import { selectionModeForEvent } from './lassoSelection.js';


const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_POINT_SPACING_PX = 2;

function _isTextInput(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}

export default class LassoInteraction {
  /**
   * @param {Object} params
   * @param {HTMLElement} params.element - the canvas (receives the pointer events)
   * @param {HTMLElement} params.overlayParent - positioned element the lasso outline is drawn in
   * @param {Function} params.onLasso - (lassoNdc: number[], mode: string) => void
   * @param {Function} params.onClear - () => void
   * @param {Function} params.onDelete - () => void
   * @param {Window} [params.keyTarget] - receives the keyboard shortcuts (default: window)
   */
  constructor({ element, overlayParent, onLasso, onClear, onDelete, keyTarget }) {
    this.element = element;
    this.overlayParent = overlayParent;
    this.onLasso = onLasso;
    this.onClear = onClear;
    this.onDelete = onDelete;
    this.keyTarget = keyTarget || (typeof window !== 'undefined' ? window : null);

    this.enabled = false;
    this._points = null;
    this._mode = null;
    this._pointerId = null;
    this._svg = null;
    this._outline = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContextMenu = event => event.preventDefault();
  }

  enable() {
    if (this.enabled || !this.element) {
      return;
    }
    this.enabled = true;
    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('contextmenu', this._onContextMenu);
    this.keyTarget?.addEventListener('keydown', this._onKeyDown);
    this.element.style.cursor = 'crosshair';
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this._cancelDrag();
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('contextmenu', this._onContextMenu);
    this.keyTarget?.removeEventListener('keydown', this._onKeyDown);
    this.element.style.cursor = '';
  }

  dispose() {
    this.disable();
    this._svg?.remove();
    this._svg = null;
    this._outline = null;
  }

  // ---------------------------------------------------------------------------------------------

  _clientToLocal(event) {
    const rect = this.element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  _ensureOutline() {
    if (this._outline || !this.overlayParent) {
      return;
    }
    const doc = this.overlayParent.ownerDocument;
    this._svg = doc.createElementNS(SVG_NS, 'svg');
    Object.assign(this._svg.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none',
    });
    this._outline = doc.createElementNS(SVG_NS, 'polyline');
    this._outline.setAttribute('fill', 'rgba(255, 214, 0, 0.12)');
    this._outline.setAttribute('stroke', '#ffd600');
    this._outline.setAttribute('stroke-width', '1.5');
    this._outline.setAttribute('stroke-dasharray', '4 3');
    this._svg.appendChild(this._outline);
    this.overlayParent.appendChild(this._svg);
  }

  _drawOutline() {
    this._ensureOutline();
    if (!this._outline) {
      return;
    }
    const points = this._points || [];
    const text = [];
    for (let i = 0; i < points.length; i += 2) {
      text.push(`${points[i]},${points[i + 1]}`);
    }
    if (points.length) {
      text.push(`${points[0]},${points[1]}`);
    }
    this._outline.setAttribute('points', text.join(' '));
  }

  _cancelDrag() {
    if (this._pointerId !== null) {
      try {
        this.element.releasePointerCapture?.(this._pointerId);
      } catch (err) {
        // capture already released
      }
    }
    this._pointerId = null;
    this._points = null;
    this._drawOutline();
  }

  _onPointerDown(event) {
    if (event.button !== 0 || this._pointerId !== null) {
      return;
    }
    event.preventDefault();
    this._pointerId = event.pointerId;
    this._mode = selectionModeForEvent(event);
    this._points = this._clientToLocal(event);
    this.element.setPointerCapture?.(event.pointerId);
    this.element.addEventListener('pointermove', this._onPointerMove);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointercancel', this._onPointerUp);
    this._drawOutline();
  }

  _onPointerMove(event) {
    if (event.pointerId !== this._pointerId || !this._points) {
      return;
    }
    const [x, y] = this._clientToLocal(event);
    const n = this._points.length;
    if (Math.hypot(x - this._points[n - 2], y - this._points[n - 1]) >= MIN_POINT_SPACING_PX) {
      this._points.push(x, y);
      this._drawOutline();
    }
  }

  _onPointerUp(event) {
    if (event.pointerId !== this._pointerId) {
      return;
    }
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('pointercancel', this._onPointerUp);

    const points = this._points;
    const mode = this._mode;
    this._cancelDrag();
    if (event.type === 'pointercancel' || !points || points.length < 6) {
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const ndc = new Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      ndc[i] = (points[i] / rect.width) * 2 - 1;
      ndc[i + 1] = -((points[i + 1] / rect.height) * 2 - 1);
    }
    this.onLasso?.(ndc, mode);
  }

  _onKeyDown(event) {
    if (event.defaultPrevented || _isTextInput(event.target)) {
      return;
    }
    if (event.key === 'Escape') {
      if (this._points) {
        this._cancelDrag();
      } else {
        this.onClear?.();
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.onDelete?.();
    }
  }
}
