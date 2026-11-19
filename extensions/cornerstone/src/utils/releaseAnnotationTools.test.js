// When a defined timepoint becomes active, the classic viewport cancels the drawing in progress
// (through the manipulator state, which the tool answers by removing the cancelled annotation),
// discards an unfinished multi-stage annotation left between its stages with its record, resets the
// tool's pending flag, sets the active annotation tools passive and returns to window/level.
// Completed annotations and navigation tools are left alone.

const mockElements = [];
const mockCancel = jest.fn();
const mockTools = [];
let mockToolState = {};
const mockSetToolState = jest.fn((imageId, toolName, state) => { mockToolState[imageId][toolName] = state; });
const mockSetPassive = jest.fn();
const mockSetActive = jest.fn();
const mockOnRemoved = jest.fn();
const mockRefresh = jest.fn();
jest.mock('cornerstone-core', () => ({ getEnabledElements: () => mockElements }), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  getModule: name => (name === 'manipulatorState' ? { setters: { cancelActiveManipulatorsForElement: (...args) => mockCancel(...args) } } : undefined),
  store: { state: { get tools() { return mockTools; } } },
  globalImageIdSpecificToolStateManager: { saveToolState: () => mockToolState, setImageIdToolState: (...args) => mockSetToolState(...args) },
  setToolPassive: (...args) => mockSetPassive(...args),
  setToolActive: (...args) => mockSetActive(...args),
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      isAnnotationTool: name => ['Length', 'Bidirectional', 'ArrowAnnotate', 'CobbAngle'].includes(name),
      MeasurementHandlers: { onRemoved: (...args) => mockOnRemoved(...args) },
      refreshCornerstoneViewports: (...args) => mockRefresh(...args),
    },
  },
}), { virtual: true });

import releaseAnnotationTools from './releaseAnnotationTools';

// A Cobb angle as cornerstone-tools 6 holds it after its first line: complete is false until the second
const cobbBetweenLines = (_id) => ({
  _id, complete: false, visible: true, active: false,
  handles: { start: { x: 1, y: 1 }, end: { x: 9, y: 1 }, start2: { x: 1, y: 5 }, end2: { x: 9, y: 5 }, textBox: {} },
});
const completed = (_id, extra = {}) => ({ _id, complete: true, visible: true, active: true, handles: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }, ...extra });

beforeEach(() => {
  mockElements.length = 0;
  mockTools.length = 0;
  mockToolState = {};
  [mockCancel, mockSetToolState, mockSetPassive, mockSetActive, mockOnRemoved, mockRefresh].forEach(fn => fn.mockClear());
});

it('cancels the drawing in every enabled element, releases the active annotation tools and activates window/level', () => {
  const a = {};
  const b = {};
  mockElements.push({ element: a }, { element: b });
  mockTools.push({ name: 'Length', mode: 'active' }, { name: 'Bidirectional', mode: 'active' }, { name: 'Pan', mode: 'active' }, { name: 'Angle', mode: 'passive' });
  expect(releaseAnnotationTools()).toEqual({ cancelled: 2, discarded: [], released: ['Length', 'Bidirectional'] });
  expect(mockCancel.mock.calls).toEqual([[a], [b]]);
  expect(mockSetPassive.mock.calls).toEqual([['Length'], ['Bidirectional']]);
  expect(mockSetActive).toHaveBeenCalledWith('Wwwc', { mouseButtonMask: 1 });
  expect(mockRefresh).toHaveBeenCalled();
});

it('discards a Cobb angle left between its two lines, with its record and the tool\'s pending flag, and keeps the completed annotations', () => {
  const cobb = { name: 'CobbAngle', mode: 'active', hasIncomplete: true };
  mockTools.push(cobb, { name: 'Wwwc', mode: 'active' });
  const unfinished = cobbBetweenLines('cobb-2');
  mockToolState = {
    'wadors:image-1': {
      CobbAngle: { data: [completed('cobb-1'), unfinished] },
      Length: { data: [completed('len-1')] },
      // A navigation tool's state is not an annotation
      Wwwc: { data: [{ _id: 'w', complete: false }] },
    },
  };
  const result = releaseAnnotationTools();
  expect(result.discarded).toEqual([{ toolType: 'CobbAngle', _id: 'cobb-2' }]);
  expect(result.released).toEqual(['CobbAngle']);
  expect(mockToolState['wadors:image-1'].CobbAngle.data.map(data => data._id)).toEqual(['cobb-1']);
  expect(mockToolState['wadors:image-1'].Length.data.map(data => data._id)).toEqual(['len-1']);
  expect(mockToolState['wadors:image-1'].Wwwc.data).toHaveLength(1);
  expect(unfinished.cancelled).toBe(true);
  expect(mockOnRemoved).toHaveBeenCalledTimes(1);
  expect(mockOnRemoved).toHaveBeenCalledWith({ detail: { toolType: 'CobbAngle', measurementData: unfinished } });
  expect(cobb.hasIncomplete).toBe(false);
  expect(mockSetActive).toHaveBeenCalledWith('Wwwc', { mouseButtonMask: 1 });
});

it('discards an annotation whose handle is still being moved, and leaves the rest', () => {
  mockToolState = { 'wadors:image-1': { Length: { data: [completed('len-1'), completed('len-2', { handles: { start: { x: 0, y: 0 }, end: { x: 3, y: 3, moving: true, active: true } } })] } } };
  expect(releaseAnnotationTools().discarded).toEqual([{ toolType: 'Length', _id: 'len-2' }]);
  expect(mockToolState['wadors:image-1'].Length.data.map(data => data._id)).toEqual(['len-1']);
});

it('cancels a drawing even when no annotation tool is active, and then changes no tool or state', () => {
  mockElements.push({ element: {} });
  mockTools.push({ name: 'Wwwc', mode: 'active' }, { name: 'Length', mode: 'passive' });
  mockToolState = { 'wadors:image-1': { Length: { data: [completed('len-1')] } } };
  expect(releaseAnnotationTools()).toEqual({ cancelled: 1, discarded: [], released: [] });
  expect(mockSetPassive).not.toHaveBeenCalled();
  expect(mockSetActive).not.toHaveBeenCalled();
  expect(mockOnRemoved).not.toHaveBeenCalled();
  expect(mockSetToolState).not.toHaveBeenCalled();
});

it('continues with the other elements and entries when one cannot be cancelled or removed', () => {
  mockElements.push({ element: 'broken' }, { element: {} });
  mockCancel.mockImplementationOnce(() => { throw new Error('no enabled element'); });
  mockOnRemoved.mockImplementationOnce(() => { throw new Error('no record'); });
  mockToolState = { 'wadors:image-1': { CobbAngle: { data: [cobbBetweenLines('cobb-a'), cobbBetweenLines('cobb-b')] } } };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const result = releaseAnnotationTools();
  console.warn.mockRestore();
  expect(result.cancelled).toBe(1);
  expect(result.discarded.map(entry => entry._id)).toEqual(['cobb-a', 'cobb-b']);
  expect(mockToolState['wadors:image-1'].CobbAngle.data).toEqual([]);
});
