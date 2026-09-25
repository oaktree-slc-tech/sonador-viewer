// Pointer and keyboard handling of the 3D Selection tool

import LassoInteraction from './LassoInteraction';
import { SELECTION_MODES } from './lassoSelection';


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
    this.children = [];
    this.attributes = {};
    this.ownerDocument = {
      createElementNS: () => new FakeElement(),
    };
  }

  getBoundingClientRect() {
    return { left: 100, top: 50, width: 200, height: 100 };
  }

  setPointerCapture = jest.fn();

  releasePointerCapture = jest.fn();

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  appendChild(child) {
    this.children.push(child);
  }

  remove() {}
}

function setup() {
  const element = new FakeElement();
  const overlayParent = new FakeElement();
  const keyTarget = new FakeTarget();
  const handlers = { onLasso: jest.fn(), onClear: jest.fn(), onDelete: jest.fn() };
  const lasso = new LassoInteraction({ element, overlayParent, keyTarget, ...handlers });
  lasso.enable();
  return { element, overlayParent, keyTarget, lasso, ...handlers };
}

function drag(element, points, { button = 0, ...modifiers } = {}) {
  const [first, ...rest] = points;
  element.dispatch('pointerdown', { button, pointerId: 1, clientX: first[0], clientY: first[1], ...modifiers });
  rest.forEach(([clientX, clientY]) => element.dispatch('pointermove', { pointerId: 1, clientX, clientY }));
  const last = points[points.length - 1];
  element.dispatch('pointerup', { pointerId: 1, clientX: last[0], clientY: last[1] });
}

describe('LassoInteraction', () => {
  it('reports a left-drag lasso in normalized device coordinates', () => {
    const { element, onLasso } = setup();

    // Canvas at (100, 50), 200 x 100: corners of the canvas
    drag(element, [[100, 50], [300, 50], [300, 150], [100, 150]]);

    expect(onLasso).toHaveBeenCalledWith([-1, 1, 1, 1, 1, -1, -1, -1], SELECTION_MODES.replace);
  });

  it('takes the selection mode from the keys held when the drag started', () => {
    const { element, onLasso } = setup();

    drag(element, [[100, 50], [300, 50], [300, 150]], { shiftKey: true });
    drag(element, [[100, 50], [300, 50], [300, 150]], { ctrlKey: true });

    expect(onLasso.mock.calls.map(([, mode]) => mode)).toEqual([SELECTION_MODES.add, SELECTION_MODES.subtract]);
  });

  it('draws the lasso outline while dragging and clears it after', () => {
    const { element, overlayParent } = setup();

    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 110, clientY: 60 });
    element.dispatch('pointermove', { pointerId: 1, clientX: 150, clientY: 60 });
    const outline = overlayParent.children[0].children[0];
    expect(outline.attributes.points).toBe('10,10 50,10 10,10');

    element.dispatch('pointerup', { pointerId: 1, clientX: 150, clientY: 60 });
    expect(outline.attributes.points).toBe('');
  });

  it('ignores other buttons, and too-short drags', () => {
    const { element, onLasso } = setup();

    drag(element, [[100, 50], [300, 50], [300, 150]], { button: 2 });
    drag(element, [[100, 50], [101, 50]]);

    expect(onLasso).not.toHaveBeenCalled();
  });

  it('maps Escape to clear and Delete / Backspace to delete', () => {
    const { keyTarget, onClear, onDelete } = setup();

    keyTarget.dispatch('keydown', { key: 'Escape' });
    keyTarget.dispatch('keydown', { key: 'Delete' });
    keyTarget.dispatch('keydown', { key: 'Backspace' });

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('leaves keys typed into text fields alone', () => {
    const { keyTarget, onDelete } = setup();

    keyTarget.dispatch('keydown', { key: 'Backspace', target: { tagName: 'INPUT' } });

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('Escape during a drag cancels the lasso instead of clearing the selection', () => {
    const { element, keyTarget, onClear, onLasso } = setup();

    element.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 110, clientY: 60 });
    keyTarget.dispatch('keydown', { key: 'Escape' });
    element.dispatch('pointermove', { pointerId: 1, clientX: 150, clientY: 60 });
    element.dispatch('pointerup', { pointerId: 1, clientX: 150, clientY: 90 });

    expect(onClear).not.toHaveBeenCalled();
    expect(onLasso).not.toHaveBeenCalled();
  });

  it('stops listening when disabled', () => {
    const { element, keyTarget, lasso, onLasso, onDelete } = setup();

    lasso.disable();
    drag(element, [[100, 50], [300, 50], [300, 150]]);
    keyTarget.dispatch('keydown', { key: 'Delete' });

    expect(onLasso).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(element.style.cursor).toBe('');
  });
});
