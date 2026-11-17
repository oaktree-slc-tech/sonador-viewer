// cornerstone-tools adds a classic arrow before its label is typed and sets the label when the
// measurement completes: the panel refreshes its copy of an arrow then, so a later edit made from it
// (a location) keeps the label. Other tools' completions are left as they were.

const mockEventTarget = { listeners: {} };
const mockOnModified = jest.fn();
const mockSources = [];
jest.mock('cornerstone-core', () => ({
  EVENTS: { ELEMENT_ENABLED: 'enabled', ELEMENT_DISABLED: 'disabled' },
  events: { addEventListener: (name, fn) => { mockEventTarget.listeners[name] = fn; } },
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  EVENTS: {
    MEASUREMENT_ADDED: 'added', MEASUREMENT_REMOVED: 'removed', MEASUREMENT_MODIFIED: 'modified',
    MEASUREMENT_COMPLETED: 'completed', LABELMAP_MODIFIED: 'labelmap', TOUCH_PRESS: 'press', MOUSE_CLICK: 'click', TOUCH_START: 'touch',
  },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      MeasurementHandlers: { onAdded: () => {}, onRemoved: () => {}, onModified: (...args) => mockOnModified(...args) },
      MeasurementApi: { addAnnotationVisibilitySource: (source) => { mockSources.push(source); return () => {}; } },
    },
    DICOMSR: { landmarks: { getLandmarkSets: () => [], isLandmarkSetVisible: () => true, setLandmarkSetsVisible: () => {} } },
  },
}));
jest.mock('@ohif/ui', () => ({ workflow: {} }), { virtual: true });
jest.mock('../../connectedComponents/ToolContextMenu', () => () => null);

import init from './init';

function enabledElement() {
  const listeners = {};
  const element = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: (name, fn) => { if (listeners[name] === fn) delete listeners[name]; },
  };
  mockEventTarget.listeners.enabled({ detail: { element } });
  return { element, listeners };
}

beforeAll(() => init({ servicesManager: { services: {} }, commandsManager: {} }));
beforeEach(() => mockOnModified.mockClear());

it("refreshes the panel's copy of an arrow when it completes, with the label set", () => {
  const { listeners } = enabledElement();
  const event = { detail: { toolName: 'ArrowAnnotate', measurementData: { _id: 'arrow-1', text: 'Lesion margin' } } };
  listeners.completed(event);
  expect(mockOnModified).toHaveBeenCalledWith(event);
});

it("leaves another tool's completion as it was", () => {
  const { listeners } = enabledElement();
  listeners.completed({ detail: { toolName: 'Length', measurementData: { _id: 'length-1' } } });
  expect(mockOnModified).not.toHaveBeenCalled();
});

it('stops listening when the element is disabled', () => {
  const { element, listeners } = enabledElement();
  mockEventTarget.listeners.disabled({ detail: { element } });
  expect(listeners.completed).toBeUndefined();
});

it('registers the landmark sets with the global visibility when the panel is initialised, before any panel is built', () => {
  expect(mockSources).toHaveLength(1);
  expect(typeof mockSources[0].setVisibility).toBe('function');
});

