// A saved (locked or read-only) measurement cannot be selected, moved or translated with the
// pointer; other measurements behave as the tool defines.

const mockToolState = { data: [] };
const mockUpdateImage = jest.fn();
jest.mock('cornerstone-tools', () => ({
  getToolState: () => mockToolState,
  importInternal: () => (handle, coords) => Boolean(handle.boundingBox) && coords.x >= handle.boundingBox.left
    && coords.x <= handle.boundingBox.left + handle.boundingBox.width,
  external: { cornerstone: { updateImage: (...args) => mockUpdateImage(...args) } },
}), { virtual: true });

import { isLockedToolData, lockable } from './lockableMeasurementTool';

class StockTool {
  pointNearTool() { return true; }
  handleSelectedCallback() { return 'handle-selected'; }
  toolSelectedCallback() { return 'tool-selected'; }
}

const Tool = lockable(StockTool);
const tool = new Tool();
const LOCKED = [
  { isLocked: true }, { isReadOnly: true }, { metadata: { isReadOnly: true } }, { metadata: { isLocked: true } },
  { measurementData: { isReadOnly: true } }, { measurementData: { metadata: { isLocked: true } } },
];

it('keeps the class name the extension keys its tool configuration by', () => {
  expect(Tool.name).toBe('StockTool');
});

it.each(LOCKED)('declines pointer input on locked data %j', data => {
  expect(isLockedToolData(data)).toBe(true);
  expect(tool.pointNearTool('element', data, {})).toBe(false);
  expect(tool.handleSelectedCallback({}, data, {})).toBe(false);
  expect(tool.toolSelectedCallback({}, data)).toBe(false);
});

it('leaves other measurements to the tool', () => {
  const data = { metadata: { isLocked: false }, handles: {} };
  expect(isLockedToolData(data)).toBe(false);
  expect(tool.pointNearTool('element', data, {})).toBe(true);
  expect(tool.handleSelectedCallback({}, data, {})).toBe('handle-selected');
  expect(tool.toolSelectedCallback({}, data)).toBe('tool-selected');
});


describe("the arrow's text edit (double-click, touch press)", () => {
  // As cornerstone-tools 6.0.10 ArrowAnnotateTool: the edit looks up the annotation under the
  // pointer (its line, or its text box) and asks changeTextCallback for the new text
  class StockArrow {
    constructor() {
      this.name = 'ArrowAnnotate';
      this.configuration = { changeTextCallback: jest.fn((data, eventData, done) => done('Changed text')) };
    }
    pointNearTool(element, data, coords) { return coords.x === data.lineAt; }
    doubleClickCallback(evt) { return this._updateTextForNearbyAnnotation(evt); }
    touchPressCallback(evt) { return this._updateTextForNearbyAnnotation(evt); }
    _updateTextForNearbyAnnotation() { throw new Error('the stock edit is replaced'); }
    _doneChangingTextCallback(element, data, text) { data.text = text; this.modified = (this.modified || 0) + 1; }
  }
  const Arrow = lockable(StockArrow);
  const event = x => ({
    detail: { element: 'element', currentPoints: { canvas: { x, y: 0 } } },
    stopImmediatePropagation: jest.fn(), preventDefault: jest.fn(), stopPropagation: jest.fn(),
  });
  const arrow = (extra = {}) => ({ text: 'Stored text', lineAt: 10, handles: { textBox: { boundingBox: { left: 50, width: 20 } } }, ...extra });

  it.each(['doubleClickCallback', 'touchPressCallback'])('%s on a saved arrow (line or text box) opens no editor and changes nothing', callback => {
    const tool = new Arrow();
    const saved = arrow({ metadata: { isReadOnly: true, isLocked: true } });
    mockToolState.data = [saved];
    [10, 55].forEach(x => {
      const evt = event(x);
      expect(tool[callback](evt)).toBe(true);
      expect(evt.stopPropagation).toHaveBeenCalled();
    });
    expect(tool.configuration.changeTextCallback).not.toHaveBeenCalled();
    expect(saved.text).toBe('Stored text');
    expect(tool.modified).toBeUndefined();
  });

  it.each(['doubleClickCallback', 'touchPressCallback'])('%s on a pending arrow edits its text', callback => {
    const tool = new Arrow();
    const pending = arrow();
    mockToolState.data = [pending];
    expect(tool[callback](event(55))).toBe(true);
    expect(tool.configuration.changeTextCallback).toHaveBeenCalledTimes(1);
    expect(pending.text).toBe('Changed text');
    expect(tool.modified).toBe(1);
  });

  it('takes the first annotation under the pointer: a saved one in front keeps its text, nothing else is edited', () => {
    const tool = new Arrow();
    const saved = arrow({ isLocked: true });
    const pending = arrow();
    mockToolState.data = [saved, pending];
    tool.doubleClickCallback(event(55));
    expect(saved.text).toBe('Stored text');
    expect(pending.text).toBe('Stored text');
  });

  it('ignores a pointer away from every arrow', () => {
    const tool = new Arrow();
    mockToolState.data = [arrow()];
    expect(tool.doubleClickCallback(event(99))).toBe(false);
  });
});
