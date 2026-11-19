/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Annotations search across the panel's lifecycle, rendered with the real ui-next section,
// accordion and search box: collapsing and reopening the Annotations section shows the search in
// effect again; closing the side panel (which keeps the table mounted) clears the search reason
// reported to the visibility rule, and reopening it reports the rows again. The user's global
// choices (Show all, Hide all) are the rule's own reasons: the table reports the search only.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockListeners = new Set();
const mockApi = {
  toggleVisibilityMeasurement: jest.fn(),
  setSearchVisibility: jest.fn(),
  setAllMeasurementsVisibility: jest.fn((visibility) => mockListeners.forEach(listener => listener(visibility))),
  getMeasurementsBySeries: jest.fn(() => new Map()),
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { info: () => {}, warn: () => {} },
    DicomMetadataStore: { getSeries: () => undefined },
    utils: { referenceIdentifiers: () => null },
    measurements: {
      refreshCornerstoneViewports: () => {},
      MeasurementApi: {
        get Instance() { return mockApi; },
        getConfiguration: () => ({ measurementTools: [] }),
        addAllVisibilityListener: (listener) => {
          mockListeners.add(listener);
          return () => mockListeners.delete(listener);
        },
      },
    },
  },
}), { virtual: true });
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('../../../../ui-next/src/components/Icons/Icons', () => ({
  Icons: new Proxy({}, { get: () => () => null }),
}));
jest.mock('@ohif/ui-next', () => {
  const pass = ({ children }) => <>{children}</>;
  const accordion = jest.requireActual('../../../../ui-next/src/components/Accordion/Accordion');
  return {
    ...accordion,
    ...jest.requireActual('../../../../ui-next/src/components/PanelSection/PanelSection'),
    ...jest.requireActual('../../../../ui-next/src/components/InputFilter/InputFilter'),
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    Icons: new Proxy({}, { get: () => () => null }),
    Label: ({ children, ...props }) => <label {...props}>{children}</label>,
    ScrollArea: pass,
    Switch: ({ id, checked, onCheckedChange }) => (
      <input type="checkbox" id={id} checked={checked} onChange={event => onCheckedChange(event.target.checked)} />
    ),
    Tooltip: pass,
    TooltipContent: () => null,
    TooltipProvider: pass,
    TooltipTrigger: pass,
  };
}, { virtual: true });
jest.mock('./MeasurementTableItem', () => ({
  MeasurementTableItem: ({ measurementData }) => <div data-row={measurementData.measurementId} />,
}));
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children }) => children }));
jest.mock('../tooltip', () => ({ Tooltip: () => null }));
jest.mock('./../../elements/Icon', () => ({ Icon: () => null }));

import MeasurementTable from './MeasurementTable';
import { SEARCH_DEBOUNCE_MS } from './AnnotationsVisibilityRow';

global.IS_REACT_ACT_ENVIRONMENT = true;

const row = (id, extra = {}) => ({ measurementId: id, toolType: 'Length', isVisible: true, isReadOnly: true, data: [], ...extra });
const COLLECTION = [
  { groupId: 'measurements', groupName: 'Measurements', measurements: [row('l1', { label: 'Femur' }), row('l2', { label: 'Tibia' })] },
];

let container;
let root;
const render = (props = {}) => act(() => root.render(
  <MeasurementTable
    server={{}}
    measurementCollection={COLLECTION}
    servicesManager={{ services: {} }}
    viewports={{ viewportSpecificData: {}, activeViewportIndex: 0 }}
    timepoints={[]}
    overallWarnings={{ warningList: [] }}
    {...props}
  />));
beforeEach(() => {
  jest.useFakeTimers();
  mockListeners.clear();
  Object.values(mockApi).forEach(fn => fn.mockClear());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const $ = selector => container.querySelector(selector);
const input = () => $('[data-cy="annotations-search"]');
const listed = () => [...container.querySelectorAll('[data-row]')].map(element => element.getAttribute('data-row'));
const type = (value) => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
};
const toggleSection = () => act(() => $('[data-panel-header], button[data-state]').click());
const filterViews = () => {
  act(() => $('[data-cy="annotations-settings-toggle"]').click());
  act(() => $('#annotations-search-in-views').click());
};
// The rows last reported to the visibility rule as left out by the search
const searchHidden = () => {
  const { calls } = mockApi.setSearchVisibility.mock;
  return calls.length ? calls[calls.length - 1][0].slice().sort() : undefined;
};

it('shows the search in effect again when the Annotations section is reopened', () => {
  type('femur');
  expect(listed()).toEqual(['l1']);

  toggleSection();
  expect(input()).toBeNull();
  toggleSection();
  expect(input().value).toBe('femur');
  expect(listed()).toEqual(['l1']);
  // Cleared from the reopened box, the search and the list are cleared together
  type('');
  expect(listed()).toEqual(['l1', 'l2']);
});

it('reports what the search leaves out when the side panel closes and reopens', () => {
  type('femur');
  filterViews();
  expect(searchHidden()).toEqual(['l2']);

  render({ isOpen: false });
  expect(searchHidden()).toEqual([]);

  render({ isOpen: true });
  expect(searchHidden()).toEqual(['l2']);
});

it('leaves a later Show All or Hide All to the rule: the search reason stands until the search clears', () => {
  type('femur');
  filterViews();
  expect(searchHidden()).toEqual(['l2']);
  mockApi.setSearchVisibility.mockClear();

  // The global choices are the user's reason, applied by the rule: the table reports nothing new
  act(() => mockApi.setAllMeasurementsVisibility(false));
  act(() => mockApi.setAllMeasurementsVisibility(true));
  expect(mockApi.setSearchVisibility).not.toHaveBeenCalled();
  expect(mockApi.toggleVisibilityMeasurement).not.toHaveBeenCalled();

  type('');
  expect(searchHidden()).toEqual([]);
});
