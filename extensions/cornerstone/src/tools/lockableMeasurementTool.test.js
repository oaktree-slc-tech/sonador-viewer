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

describe('stored line and text colors', () => {
  // A tool that draws every measurement of the image in one call, its line in the data's color and
  // its text through the context
  class DrawingTool {
    renderToolData(evt) {
      mockToolState.data.forEach((data) => {
        evt.drawn.push({ id: data.id, line: data.color || 'tool' });
        const context = evt.detail.canvasContext.canvas.getContext('2d');
        context.fillStyle = data.color || 'tool';
        context.fillText(data.id);
      });
    }
  }
  const ColorTool = lockable(DrawingTool);

  const renderAll = (data) => {
    mockToolState.data = data;
    const texts = [];
    const context = { fillStyle: null, fillText(id) { texts.push({ id, text: this.fillStyle }); } };
    const evt = { currentTarget: 'element', drawn: [], detail: { canvasContext: { canvas: { getContext: () => context } } } };
    new ColorTool().renderToolData(evt);
    return { lines: evt.drawn, texts, context };
  };

  it('draws a measurement in its stored line and text colors, and the others as the tool does', () => {
    const plain = { id: 'plain', handles: {} };
    const colored = { id: 'colored', measurementData: { displayAttributes: { Color: { Line: '#FF8800', Text: '#00FF00' } } } };
    const { lines, texts, context } = renderAll([plain, colored]);

    expect(lines).toEqual([{ id: 'plain', line: 'tool' }, { id: 'colored', line: '#FF8800' }]);
    expect(texts).toEqual([{ id: 'plain', text: 'tool' }, { id: 'colored', text: '#00FF00' }]);
    // The data, the tool state and the context are left as they were
    expect(colored).not.toHaveProperty('color');
    expect(mockToolState.data).toEqual([plain, colored]);
    expect(Object.prototype.hasOwnProperty.call(context, 'fillText')).toBe(true);
    expect(context.fillText.name).toBe('fillText');
  });

  it('draws the text in the line color without a text color, and the active measurement in the active color', () => {
    const lineOnly = { id: 'line', displayAttributes: { Color: { Line: '#FF8800' } } };
    const active = { id: 'active', active: true, displayAttributes: { Color: { Line: '#FF8800', Text: '#00FF00' } } };
    const { lines, texts } = renderAll([lineOnly, active]);

    expect(lines).toEqual([{ id: 'line', line: '#FF8800' }, { id: 'active', line: 'tool' }]);
    expect(texts).toEqual([{ id: 'line', text: '#FF8800' }, { id: 'active', text: 'tool' }]);
  });
});
