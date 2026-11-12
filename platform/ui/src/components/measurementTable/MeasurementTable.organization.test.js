/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Annotations drawer's display settings and search, rendered: the settings drawer opens from
// the header's control with Group by series (kept per browser) and Apply search to views (off,
// for the session); grouped by series, each group's rows nest under series headings; a search
// lists only the matching rows with "n of total" counts, or a no-match message; the global toggle
// then acts on the matching rows only; with Apply search to views, the rows the search leaves out
// are hidden in the views and shown again when the search is cleared.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The API's by-series query, as getMeasurementsBySeries returns it for COLLECTION
const mockBySeries = () => {
  const entry = (toolType, pending = false) => ({ toolType, pending, studyInstanceUID: '2.25.1' });
  return new Map([
    ['2.25.22', [entry('Length')]],
    ['2.25.21', [entry('CobbAngle'), entry('DICOMSRSeriesTagTool'), entry('Length', true)]],
    [null, [entry('ArrowAnnotate')]],
  ]);
};
const mockApi = {
  toggleVisibilityMeasurement: jest.fn(), setAllMeasurementsVisibility: jest.fn(), getMeasurementsBySeries: jest.fn(mockBySeries),
};
const mockRefresh = jest.fn();
const mockSeries = {
  '2.25.21': { SeriesNumber: 12, Modality: 'MR', SeriesDescription: 'Sag T2 FSE' },
  '2.25.22': { SeriesNumber: 3, Modality: 'CT', SeriesDescription: 'Axial Bone' },
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { info: () => {}, warn: () => {} },
    DicomMetadataStore: { getSeries: () => ({ instances: [{}, {}] }) },
    utils: { referenceIdentifiers: (store, { SeriesInstanceUID }) => mockSeries[SeriesInstanceUID] || null },
    measurements: {
      refreshCornerstoneViewports: (...args) => mockRefresh(...args),
      MeasurementApi: {
        get Instance() { return mockApi; },
        getConfiguration: () => ({ measurementTools: [] }),
      },
    },
  },
}), { virtual: true });
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('@ohif/ui-next', () => {
  const pass = ({ children }) => <>{children}</>;
  const React = jest.requireActual('react');
  const InputFilter = ({ children, onChange }) => (
    <div data-filter>{React.Children.map(children, child => (child ? React.cloneElement(child, { onFilterChange: onChange }) : child))}</div>
  );
  InputFilter.SearchIcon = () => null;
  InputFilter.Input = ({ onFilterChange, ...props }) => <input {...props} onChange={event => onFilterChange(event.target.value)} />;
  InputFilter.ClearButton = () => null;
  const PanelSection = pass;
  PanelSection.Header = ({ children }) => <div data-panel-header>{children}</div>;
  PanelSection.Content = pass;
  return {
    Accordion: ({ children, className }) => <div className={className}>{children}</div>,
    AccordionItem: ({ children, className }) => <div className={className}>{children}</div>,
    AccordionTrigger: pass,
    AccordionContent: pass,
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    Icons: new Proxy({}, { get: () => () => null }),
    InputFilter,
    Label: ({ children, ...props }) => <label {...props}>{children}</label>,
    PanelSection,
    ScrollArea: pass,
    Switch: ({ id, checked, onCheckedChange }) => (
      <input type="checkbox" id={id} checked={checked} onChange={event => onCheckedChange(event.target.checked)} />
    ),
    Tooltip: pass,
    TooltipContent: ({ children, ...props }) => <div role="tooltip" {...props}>{children}</div>,
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

global.IS_REACT_ACT_ENVIRONMENT = true;

const row = (id, extra = {}) => ({ measurementId: id, toolType: 'Length', isVisible: true, isReadOnly: true, data: [], ...extra });
const COLLECTION = [
  { groupId: 'measurements', groupName: 'Measurements', measurements: [
    row('c1', { toolType: 'CobbAngle', label: 'Lumbar spine', refSeriesInstanceUID: '2.25.21' }),
    row('l1', { label: 'Femur', refSeriesInstanceUID: '2.25.22' }),
    row('a1', { toolType: 'ArrowAnnotate', description: 'Screw tip' }),
  ] },
  { groupId: 'findings', groupName: 'Findings', measurements: [row('t1', { toolType: 'DICOMSRSeriesTagTool', refSeriesInstanceUID: '2.25.21' })] },
  { groupId: 'pendingallTools', groupName: 'Pending Measurements', measurements: [row('p1', { refSeriesInstanceUID: '2.25.21', isReadOnly: false })] },
];

let container;
let root;
const mount = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(
    <MeasurementTable
      server={{}}
      measurementCollection={COLLECTION}
      servicesManager={{ services: {} }}
      viewports={{ viewportSpecificData: {}, activeViewportIndex: 0 }}
      timepoints={[]}
      overallWarnings={{ warningList: [] }}
    />));
};
beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  Object.values(mockApi).forEach(fn => fn.mockClear());
  mockApi.getMeasurementsBySeries.mockImplementation(mockBySeries);
  mount();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const $ = selector => container.querySelector(selector);
const $$ = selector => [...container.querySelectorAll(selector)];
const listed = () => $$('[data-row]').map(element => element.getAttribute('data-row'));
const search = (value) => act(() => {
  const input = $('[data-cy="annotations-search"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const openSettings = () => act(() => $('[data-cy="annotations-settings-toggle"]').click());
const setSwitch = (id, checked) => act(() => {
  const input = $(`#${id}`);
  if (input.checked !== checked) {
    input.click();
  }
});

it('opens the display settings from the header control, off by default', () => {
  expect($('[data-cy="annotations-settings"]')).toBeNull();
  expect($('[data-cy="annotations-settings-toggle"]').getAttribute('aria-label')).toBe('Display Settings');
  openSettings();
  expect($('[data-cy="annotations-settings"]')).not.toBeNull();
  expect($('#annotations-group-by-series').checked).toBe(false);
  expect($('#annotations-search-in-views').checked).toBe(false);
  expect($('label[for="annotations-group-by-series"]').textContent).toBe('Group by series');
  expect($('label[for="annotations-search-in-views"]').textContent).toBe('Filter annotations in imaging viewports');
});

it('nests each group by series in series-number order, Series Unavailable last, and keeps the choice', () => {
  openSettings();
  setSwitch('annotations-group-by-series', true);
  expect($$('.measurementSeriesTitle').map(element => element.textContent))
    .toEqual(['Axial Bone', 'Sag T2 FSE', 'Series Unavailable', 'Sag T2 FSE', 'Sag T2 FSE']);
  // Each heading leads with the series number as the rows write it; Series Unavailable has none
  expect($$('.measurementSeriesHeader').map(header => (header.querySelector('.measurementSeriesNumber') || {}).textContent))
    .toEqual(['S:3', 'S:12', undefined, 'S:12', 'S:12']);
  // Each heading's card: "Series N", the modality and instance count, the number of annotations,
  // the series description; the series' types and counts across every group, the pending ones marked
  const cards = $$('[data-cy="series-group-card"]');
  const text = (card, selector) => (card.querySelector(selector) || {}).textContent;
  const types = card => [...card.querySelectorAll('.seriesCardType')].map(line => [
    line.querySelector('.seriesCardTypeName').textContent, line.querySelector('.seriesCardTypeCount').textContent,
  ]);
  expect(types(cards[0])).toEqual([['Length', '1']]);
  expect([text(cards[1], '.seriesCardName'), text(cards[1], '.seriesCardSub'), text(cards[1], '.seriesCardChip')])
    .toEqual(['Series 12', 'MR \u00B7 2 images', '3']);
  expect(text(cards[1], '.seriesCardDescription')).toBe('Sag T2 FSE');
  expect(types(cards[1])).toEqual([['Cobb Angle', '1'], ['Series Tag', '1'], ['LengthPending', '1']]);
  expect(text(cards[1], '.seriesCardMark.isPending')).toBe('Pending');
  // The same series' card is the same in every group
  expect(types(cards[3])).toEqual(types(cards[1]));
  // Series Unavailable: the reason instead of a description, then its types
  expect(text(cards[2], '.seriesCardName')).toBe('Series Unavailable');
  expect(cards[2].querySelector('.seriesCardSub')).toBeNull();
  expect(text(cards[2], '.seriesCardNote')).toContain("Shows measurements whose series isn't loaded");
  expect(types(cards[2])).toEqual([['Arrow Annotation', '1']]);
  expect(listed()).toEqual(['l1', 'c1', 'a1', 't1', 'p1']);
  // Computed once per change of the measurements, not per heading
  expect(mockApi.getMeasurementsBySeries.mock.calls.length).toBeLessThanOrEqual(2);
  expect(window.localStorage.getItem('sonador-annotations-group-by-series')).toBe('true');

  // Kept per browser
  act(() => root.unmount());
  container.remove();
  mount();
  expect($$('.measurementSeriesGroup')).toHaveLength(5);
});

it('lists the matching rows with "n of total" counts, or says nothing matches', () => {
  search('mr');
  expect(listed()).toEqual(['c1', 't1', 'p1']);
  expect($$('.numberOfItems').map(element => element.textContent)).toEqual(['1 of 3', '1 of 1', '1 of 1']);
  search('screw');
  expect(listed()).toEqual(['a1']);
  expect($$('.measurementGroup')).toHaveLength(1);
  search('no such thing');
  expect(listed()).toEqual([]);
  expect($('[data-cy="annotations-no-match"]').textContent).toBe('No annotations match “no such thing”');
});

it('hides only the matching annotations from the global toggle while searching, every one otherwise', () => {
  search('femur');
  act(() => $('[data-cy="all-annotations-visibility-toggle"]').click());
  expect(mockApi.toggleVisibilityMeasurement.mock.calls).toEqual([['l1', false]]);
  expect(mockApi.setAllMeasurementsVisibility).not.toHaveBeenCalled();

  search('');
  act(() => $('[data-cy="all-annotations-visibility-toggle"]').click());
  expect(mockApi.setAllMeasurementsVisibility).toHaveBeenCalledWith(false);
});

it('with Apply search to views, hides in the views what the search leaves out, and shows it again', () => {
  search('femur');
  expect(mockApi.toggleVisibilityMeasurement).not.toHaveBeenCalled();

  openSettings();
  setSwitch('annotations-search-in-views', true);
  expect(mockApi.toggleVisibilityMeasurement.mock.calls.sort()).toEqual([['a1', false], ['c1', false], ['p1', false], ['t1', false]]);
  expect(mockRefresh).toHaveBeenCalled();

  mockApi.toggleVisibilityMeasurement.mockClear();
  search('');
  expect(mockApi.toggleVisibilityMeasurement.mock.calls.sort()).toEqual([['a1', true], ['c1', true], ['p1', true], ['t1', true]]);
});

it('shows what the search hid in the views when the table is unmounted', () => {
  search('femur');
  openSettings();
  setSwitch('annotations-search-in-views', true);
  mockApi.toggleVisibilityMeasurement.mockClear();
  act(() => root.unmount());
  expect(mockApi.toggleVisibilityMeasurement.mock.calls.sort()).toEqual([['a1', true], ['c1', true], ['p1', true], ['t1', true]]);
  // afterEach unmounts again
  root = createRoot(container);
});
