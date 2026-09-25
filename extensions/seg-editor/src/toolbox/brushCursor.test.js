// Brush cursor clearing on viewport leave (ohif-viewers#142)

import { attachBrushCursorClearing, clearBrushCursor } from './brushCursor';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/tools', () => require('./testing/cornerstoneToolsMock'), { virtual: true });

const cstMock = require('./testing/cornerstoneToolsMock');
const { triggerAnnotationRenderForViewportIds } = cstMock.utilities;

const TOOL_GROUP_ID = 'sonadorSegViewer';

// A viewport element: an EventTarget whose :hover state the test controls
function createElement() {
  const element = new EventTarget();
  element.hovered = false;
  element.matches = selector => selector === ':hover' && element.hovered;
  return element;
}

const leave = (element, buttons = 0) => {
  const evt = new Event('mouseleave');
  evt.buttons = buttons;
  element.dispatchEvent(evt);
};

let brush;
let eraser;

beforeEach(() => {
  cstMock.__testing.reset();
  triggerAnnotationRenderForViewportIds.mockClear();
  const toolGroup = cstMock.__testing.createToolGroup(TOOL_GROUP_ID);
  brush = { _hoverData: { viewport: { id: 'Axial' } } };
  eraser = { _hoverData: undefined };
  toolGroup.brushInstances = [brush, eraser];
  global.document = new EventTarget();
});

describe('clearBrushCursor', () => {
  it('drops the hover state of the viewport left and re-renders it', () => {
    clearBrushCursor(TOOL_GROUP_ID, 'Axial');

    expect(brush._hoverData).toBeUndefined();
    expect(triggerAnnotationRenderForViewportIds).toHaveBeenCalledWith(['Axial']);
  });

  it('keeps the cursor of a viewport the pointer has already entered', () => {
    brush._hoverData = { viewport: { id: 'Coronal' } };

    clearBrushCursor(TOOL_GROUP_ID, 'Axial');

    expect(brush._hoverData.viewport.id).toBe('Coronal');
    expect(triggerAnnotationRenderForViewportIds).toHaveBeenCalledWith(['Axial']);
  });

  it('does nothing harmful when the tool group is gone', () => {
    expect(() => clearBrushCursor('closed', 'Axial')).not.toThrow();
  });
});

describe('attachBrushCursorClearing', () => {
  it('clears the cursor when the pointer leaves the viewport', () => {
    const element = createElement();
    attachBrushCursorClearing({ toolGroupId: TOOL_GROUP_ID, viewportId: 'Axial', element });

    leave(element);

    expect(brush._hoverData).toBeUndefined();
  });

  it('waits for a stroke dragged out of the viewport to end', () => {
    const element = createElement();
    attachBrushCursorClearing({ toolGroupId: TOOL_GROUP_ID, viewportId: 'Axial', element });

    leave(element, 1);
    expect(brush._hoverData).toBeDefined();

    document.dispatchEvent(new Event('mouseup'));
    expect(brush._hoverData).toBeUndefined();
  });

  it('keeps the cursor if the stroke ends back over the viewport', () => {
    const element = createElement();
    attachBrushCursorClearing({ toolGroupId: TOOL_GROUP_ID, viewportId: 'Axial', element });

    leave(element, 1);
    element.hovered = true;
    document.dispatchEvent(new Event('mouseup'));

    expect(brush._hoverData).toBeDefined();
  });

  it('stops listening once detached', () => {
    const element = createElement();
    const detach = attachBrushCursorClearing({ toolGroupId: TOOL_GROUP_ID, viewportId: 'Axial', element });

    leave(element, 1);
    detach();
    document.dispatchEvent(new Event('mouseup'));
    leave(element);

    expect(brush._hoverData).toBeDefined();
  });
});
