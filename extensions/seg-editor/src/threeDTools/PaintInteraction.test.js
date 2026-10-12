// Pointer and keyboard handling of the 3D Paint tool

import PaintInteraction from './PaintInteraction';


// Minimal DOM stand-ins (jest runs these tests in node)
class FakeTarget {
  constructor() {
    this.listeners = {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] = this.listeners[type] || new Set()).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  dispatch(type, event = {}) {
    const full = { type, preventDefault: jest.fn(), ...event };
    [...(this.listeners[type] || [])].forEach(listener => listener(full));
    return full;
  }
}

class FakeElement extends FakeTarget {
  constructor() {
    super();
    this.style = {};
  }

  getBoundingClientRect() {
    return { left: 100, top: 50, width: 200, height: 100 };
  }

  setPointerCapture = jest.fn();

  releasePointerCapture = jest.fn();
}

function setup() {
  const element = new FakeElement();
  const keyTarget = new FakeTarget();
  const callbacks = {
    onPaint: jest.fn(), onHover: jest.fn(), onLeave: jest.fn(), onStrokeEnd: jest.fn(),
    onClear: jest.fn(), onDelete: jest.fn(),
  };
  const paint = new PaintInteraction({ element, keyTarget, ...callbacks });
  paint.enable();
  return { element, keyTarget, paint, ...callbacks };
}

describe('PaintInteraction', () => {
  it('paints along a left-button drag, in view coordinates', () => {
    const { element, onPaint, onStrokeEnd } = setup();

    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    element.dispatch('pointermove', { pointerId: 1, clientX: 250, clientY: 100 });
    element.dispatch('pointermove', { pointerId: 1, clientX: 251, clientY: 100 }); // too close: skipped
    element.dispatch('pointerup', { pointerId: 1 });

    expect(onPaint).toHaveBeenCalledTimes(2);
    // (200, 100) is the centre of the 200 x 100 element at (100, 50)
    expect(onPaint.mock.calls[0]).toEqual([[0, 0], { erase: false }]);
    expect(onPaint.mock.calls[1][0][0]).toBeCloseTo(0.5);
    expect(onStrokeEnd).toHaveBeenCalledTimes(1);
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('erases while Ctrl is held at the start of the stroke', () => {
    const { element, onPaint } = setup();

    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 150, clientY: 80, ctrlKey: true });
    element.dispatch('pointermove', { pointerId: 1, clientX: 180, clientY: 80 });

    expect(onPaint).toHaveBeenCalledTimes(2);
    onPaint.mock.calls.forEach(([, options]) => expect(options).toEqual({ erase: true }));
  });

  it('reports the pointer hovering over the canvas, and leaving it', () => {
    const { element, onHover, onLeave, onPaint } = setup();

    element.dispatch('pointermove', { pointerId: 7, clientX: 130, clientY: 70 });
    expect(onHover).toHaveBeenCalledWith([-0.7, 0.6]);
    expect(onPaint).not.toHaveBeenCalled();

    element.dispatch('pointerleave', {});
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('leaves the other buttons alone, and ignores a second pointer', () => {
    const { element, onPaint } = setup();

    const right = element.dispatch('pointerdown', { button: 2, pointerId: 1, clientX: 200, clientY: 100 });
    expect(right.preventDefault).not.toHaveBeenCalled();
    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    element.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 210, clientY: 100 });
    element.dispatch('pointermove', { pointerId: 2, clientX: 260, clientY: 100 });

    expect(onPaint).toHaveBeenCalledTimes(1);
  });

  it('clears on Escape, deletes on Delete and Backspace, and ends a stroke on Escape', () => {
    const { element, keyTarget, onClear, onDelete, onStrokeEnd } = setup();

    keyTarget.dispatch('keydown', { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);

    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    keyTarget.dispatch('keydown', { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onStrokeEnd).toHaveBeenCalledTimes(1);

    const del = keyTarget.dispatch('keydown', { key: 'Delete' });
    keyTarget.dispatch('keydown', { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(del.preventDefault).toHaveBeenCalled();

    keyTarget.dispatch('keydown', { key: 'Delete', target: { tagName: 'INPUT' } });
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('stops listening when disabled, and tells the canvas the pointer is gone', () => {
    const { element, keyTarget, paint, onPaint, onClear, onLeave } = setup();

    paint.disable();
    expect(element.style.cursor).toBe('');
    expect(onLeave).toHaveBeenCalledTimes(1);
    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    keyTarget.dispatch('keydown', { key: 'Escape' });
    expect(onPaint).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();

    paint.enable();
    expect(element.style.cursor).toBe('crosshair');
    paint.dispose();
    expect(paint.enabled).toBe(false);
  });
});
