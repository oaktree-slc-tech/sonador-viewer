// Pointer and keyboard handling for the 3D Paint tool (ohif-viewers#142, §13), after three-mesh-bvh's
// triangle-painting example.
//
// While enabled, the pointer's position over the canvas is reported as it moves (the canvas shows
// the brush on the surface under it), and a left-button drag paints: the position is reported at
// the start of the stroke and along it, with whether Ctrl/Cmd was held when the stroke started
// (an erase stroke). Escape asks to clear the selection and Delete/Backspace to delete it. The
// other mouse buttons and the wheel are left to the camera controls.

const MIN_POINT_SPACING_PX = 2;

function _isTextInput(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}

export default class PaintInteraction {
  /**
   * @param {Object} params
   * @param {HTMLElement} params.element - the canvas (receives the pointer events)
   * @param {Function} params.onPaint - (ndc: number[], { erase: boolean }) => void, per brush position
   * @param {Function} [params.onHover] - (ndc: number[]) => void: the pointer moved without painting
   * @param {Function} [params.onLeave] - () => void: the pointer left the canvas
   * @param {Function} [params.onStrokeEnd] - () => void
   * @param {Function} params.onClear - () => void
   * @param {Function} params.onDelete - () => void
   * @param {Window} [params.keyTarget] - receives the keyboard shortcuts (default: window)
   */
  constructor({ element, onPaint, onHover, onLeave, onStrokeEnd, onClear, onDelete, keyTarget }) {
    this.element = element;
    this.onPaint = onPaint;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onStrokeEnd = onStrokeEnd;
    this.onClear = onClear;
    this.onDelete = onDelete;
    this.keyTarget = keyTarget || (typeof window !== 'undefined' ? window : null);

    this.enabled = false;
    this._erase = false;
    this._pointerId = null;
    this._last = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContextMenu = event => event.preventDefault();
  }

  enable() {
    if (this.enabled || !this.element) {
      return;
    }
    this.enabled = true;
    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('pointermove', this._onPointerMove);
    this.element.addEventListener('pointerleave', this._onPointerLeave);
    this.element.addEventListener('contextmenu', this._onContextMenu);
    this.keyTarget?.addEventListener('keydown', this._onKeyDown);
    this.element.style.cursor = 'crosshair';
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this._endStroke();
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerleave', this._onPointerLeave);
    this.element.removeEventListener('contextmenu', this._onContextMenu);
    this.keyTarget?.removeEventListener('keydown', this._onKeyDown);
    this.element.style.cursor = '';
    this._last = null;
    this.onLeave?.();
  }

  dispose() {
    this.disable();
  }

  // ---------------------------------------------------------------------------------------------

  _clientToLocal(event) {
    const rect = this.element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  _toNdc([x, y]) {
    const rect = this.element.getBoundingClientRect();
    return [(x / rect.width) * 2 - 1, -((y / rect.height) * 2 - 1) || 0];
  }

  _paintAt(local) {
    this._last = local;
    this.onPaint?.(this._toNdc(local), { erase: this._erase });
  }

  _endStroke() {
    if (this._pointerId === null) {
      return;
    }
    try {
      this.element.releasePointerCapture?.(this._pointerId);
    } catch (err) {
      // capture already released
    }
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('pointercancel', this._onPointerUp);
    this._pointerId = null;
    this._erase = false;
    this.onStrokeEnd?.();
  }

  _onPointerDown(event) {
    if (event.button !== 0 || this._pointerId !== null) {
      return;
    }
    event.preventDefault();
    this._pointerId = event.pointerId;
    this._erase = !!(event.ctrlKey || event.metaKey);
    this.element.setPointerCapture?.(event.pointerId);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointercancel', this._onPointerUp);
    this._paintAt(this._clientToLocal(event));
  }

  _onPointerMove(event) {
    const local = this._clientToLocal(event);
    if (this._pointerId === null || event.pointerId !== this._pointerId) {
      this._last = local;
      this.onHover?.(this._toNdc(local));
      return;
    }
    const last = this._last;
    if (!last || Math.hypot(local[0] - last[0], local[1] - last[1]) >= MIN_POINT_SPACING_PX) {
      this._paintAt(local);
    }
  }

  _onPointerUp(event) {
    if (event.pointerId !== this._pointerId) {
      return;
    }
    this._endStroke();
  }

  _onPointerLeave() {
    if (this._pointerId === null) {
      this._last = null;
      this.onLeave?.();
    }
  }

  _onKeyDown(event) {
    if (event.defaultPrevented || _isTextInput(event.target)) {
      return;
    }
    if (event.key === 'Escape') {
      if (this._pointerId !== null) {
        this._endStroke();
      } else {
        this.onClear?.();
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.onDelete?.();
    }
  }
}
