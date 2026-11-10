/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The Annotations control of the volume viewer (View -> Annotations), rendered through the toolbar
// button, the toggle command's action and the real MeasurementApi visibility methods:
// active unless every annotation is hidden; a press hides every annotation unless all are hidden,
// then shows them all; operable by pointer and keyboard, once per press.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApi = { current: null };
const mockC3dListeners = new Map();
jest.mock('@cornerstonejs/core', () => ({
  eventTarget: {
    addEventListener: (name, fn) => mockC3dListeners.set(name, fn),
    removeEventListener: name => mockC3dListeners.delete(name),
  },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  Enums: { Events: { ANNOTATION_COMPLETED: 'completed', ANNOTATION_REMOVED: 'removed', ANNOTATION_VISIBILITY_CHANGE: 'visibility' } },
}), { virtual: true });
jest.mock('react-redux', () => ({ useSelector: () => undefined }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => `t:${key}` }) }));
jest.mock('../../../../platform/ui/src/elements/Icon', () => ({ Icon: () => null }));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      MeasurementApi: { get Instance() { return mockApi.current; } },
      refreshCornerstoneViewports: () => {},
    },
  },
}), { virtual: true });
// MeasurementApi's own imports
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, setImageIdToolState: () => {} },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../../../platform/core/src/utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../../../platform/core/src/utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../../../platform/core/src/log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../../../../platform/core/src/measurements/configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../../../../platform/core/src/measurements/enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../../../../platform/core/src/measurements/lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../../../platform/core/src/DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
}));
jest.mock('@ohif/ui', () => ({
  ToolbarButton: jest.requireActual('../../../../platform/ui/src/viewer/ToolbarButton').default,
}), { virtual: true });

import ViewerAnnotationsEnabledToolbarButton from './ViewerAnnotationsEnabledToolbarButton';
import MeasurementApi from '../../../../platform/core/src/measurements/classes/MeasurementApi';

global.IS_REACT_ACT_ENVIRONMENT = true;

// A measurement service with the visibility behaviour of MeasurementService (its own suite covers
// it): each changed measurement is broadcast as updated
class MeasurementService {
  EVENTS = { MEASUREMENT_UPDATED: 'updated' };
  measurements = new Map();
  subscribers = [];
  subscribe(event, fn) {
    this.subscribers.push(fn);
    return { unsubscribe: () => this.subscribers.splice(this.subscribers.indexOf(fn), 1) };
  }
  getMeasurements() { return [...this.measurements.values()]; }
  getMeasurement(uid) { return this.measurements.get(uid); }
  toggleVisibilityMeasurement(uid, isVisible) {
    const measurement = this.measurements.get(uid);
    if (measurement.isVisible !== isVisible) {
      measurement.isVisible = isVisible;
      [...this.subscribers].forEach(fn => fn({ measurement }));
    }
  }
  setMeasurementsVisibility(isVisible) {
    [...this.measurements.keys()].forEach(uid => this.toggleVisibilityMeasurement(uid, isVisible));
  }
}

// The visibility methods of MeasurementApi over the measurement service
const apiOver = measurementService => ({
  measurementService,
  tools: {},
  toggleVisibilityMeasurement: jest.fn(),
  onMeasurementsUpdated: jest.fn(),
  setAllMeasurementsVisibility: MeasurementApi.prototype.setAllMeasurementsVisibility,
  areAllMeasurementsHidden: MeasurementApi.prototype.areAllMeasurementsHidden,
});
// The toggleAnnotations command's action (commandsModule.test.js covers its wiring)
const toggle = () => {
  const api = mockApi.current;
  api.setAllMeasurementsVisibility(api.areAllMeasurementsHidden());
};
const button = { id: 'CTVolumeAnnotationsEnabled', label: 'Annotations', icon: 'measure-target' };

let root;
let service;
const mount = (...visibility) => {
  service = new MeasurementService();
  visibility.forEach((isVisible, index) => service.measurements.set(`m${index}`, { uid: `m${index}`, isVisible }));
  mockApi.current = apiOver(service);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ViewerAnnotationsEnabledToolbarButton button={button} toolbarClickCallback={toggle} />));
};
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const control = () => document.querySelector('[aria-label="t:Annotations"]');
const pressed = () => control().getAttribute('aria-pressed');
const visibility = () => [...service.measurements.values()].map(m => m.isVisible);
// A key press as a browser sends it: keydown, then keyup unless the key is held
const press = (value, init = {}) => act(() => {
  control().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }));
  if (!init.repeat) {
    control().dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true, cancelable: true }));
  }
});

it('is a named tab stop, active while annotations are shown', () => {
  mount(true, true);
  expect(control().tabIndex).toBe(0);
  expect(control().getAttribute('role')).toBe('button');
  expect(pressed()).toBe('true');
});

it('stays active while only some annotations are hidden, and hides them all on a press', () => {
  mount(true, false);
  expect(pressed()).toBe('true');
  press('Enter');
  expect(visibility()).toEqual([false, false]);
  expect(pressed()).toBe('false');

  press('Enter', { repeat: true });
  expect(visibility()).toEqual([false, false]);

  press(' ');
  expect(visibility()).toEqual([true, true]);
  expect(pressed()).toBe('true');
});

it('follows visibility set elsewhere (the Measurements panel)', () => {
  mount(true, true);
  act(() => mockApi.current.setAllMeasurementsVisibility(false));
  expect(pressed()).toBe('false');
  act(() => service.toggleVisibilityMeasurement('m0', true));
  expect(pressed()).toBe('true');
});

it('is active without annotations, and toggles with the pointer as well', () => {
  mount();
  expect(pressed()).toBe('true');
  service.measurements.set('m0', { uid: 'm0', isVisible: true });
  act(() => control().click());
  expect(visibility()).toEqual([false]);
  expect(control().classList.contains('active')).toBe(false);
});

// A session-only annotation source, as the Cornerstone3D views register theirs: setting the
// annotations' visibility raises Cornerstone3D's visibility event
const standalone = (...visibility) => {
  const state = [...visibility];
  const remove = MeasurementApi.addAnnotationVisibilitySource({
    visibilities: () => [...state],
    setVisibility: (visible) => {
      state.fill(visible);
      const listener = mockC3dListeners.get('visibility');
      if (listener) {
        listener();
      }
    },
  });
  return { state, remove };
};

it('counts session-only annotations: active while one is shown beside hidden measurements, then hides it too', () => {
  const unsaved = standalone(true);
  try {
    mount(false);
    expect(pressed()).toBe('true');
    press('Enter');
    expect(unsaved.state).toEqual([false]);
    expect(pressed()).toBe('false');
    press('Enter');
    expect(unsaved.state).toEqual([true]);
    expect(visibility()).toEqual([true]);
    expect(pressed()).toBe('true');
  } finally {
    unsaved.remove();
  }
});

it('follows the Cornerstone3D annotation events of a session with only session-only annotations', () => {
  const unsaved = standalone();
  try {
    mount();
    expect(pressed()).toBe('true');
    unsaved.state.push(false);
    act(() => mockC3dListeners.get('completed')());
    expect(pressed()).toBe('false');
    unsaved.state[0] = true;
    act(() => mockC3dListeners.get('visibility')());
    expect(pressed()).toBe('true');
  } finally {
    unsaved.remove();
  }
});
