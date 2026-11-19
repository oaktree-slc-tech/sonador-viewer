/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The timepoint selector of the Annotations panel: the Segmentations panel's dropdown (CustomSelect)
// in the Study Date item's place once a defined timepoint exists, laid out as that panel is: the
// Annotations section header first, then the Study Date item or the selector, then the search row.
// Study Date/Time first with the header's date, each defined timepoint with its label and detail, the
// active one shown; a choice is reported once. With Study Date/Time alone the Study Date item shows
// as before. A defined timepoint is shown for review only: no save button.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApi = {
  toggleVisibilityMeasurement: jest.fn(),
  setSearchVisibility: jest.fn(),
  setAllMeasurementsVisibility: jest.fn(),
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
      MeasurementApi: { get Instance() { return mockApi; }, getConfiguration: () => ({ measurementTools: [] }) },
    },
  },
}), { virtual: true });
// A translation that changes the generated labels, so that a defined timepoint's own text can be seen
// to stay as written even when it matches a key
const TRANSLATIONS = { 'Study Date/Time': 'Studiendatum', Timepoint: 'Zeitpunkt' };
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values) => {
      const text = TRANSLATIONS[key] || key;
      return values ? text.replace(/{{(\w+)}}/g, (_, name) => values[name]) : text;
    },
  }),
}));
jest.mock('../../../../ui-next/src/components/Icons/Icons', () => ({ Icons: new Proxy({}, { get: () => () => null }) }));
jest.mock('@ohif/ui-next', () => {
  const pass = ({ children }) => <>{children}</>;
  return {
    ...jest.requireActual('../../../../ui-next/src/components/Accordion/Accordion'),
    ...jest.requireActual('../../../../ui-next/src/components/PanelSection/PanelSection'),
    ...jest.requireActual('../../../../ui-next/src/components/InputFilter/InputFilter'),
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    Icons: new Proxy({}, { get: () => () => null }),
    Label: ({ children, ...props }) => <label {...props}>{children}</label>,
    ScrollArea: pass,
    Switch: ({ id, checked, onCheckedChange }) => (
      <input type="checkbox" id={id} checked={checked} onChange={event => onCheckedChange(event.target.checked)} />
    ),
    Tooltip: pass, TooltipContent: () => null, TooltipProvider: pass, TooltipTrigger: pass,
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

const DEFAULT = { timepointId: 'TimepointId', isDefault: true, label: 'Study Date/Time', date: 'November 04, 2026' };
const POSTOP = { timepointId: 'timepoint:1:2.25.7', isDefault: false, label: 'Post-operative review, 6 weeks', date: 'November 04, 2026', time: '09:30' };
// A defined timepoint whose description happens to be a translation key
const KEYLIKE = { timepointId: 'timepoint:1:2.25.9', isDefault: false, label: 'Timepoint', date: 'January 01, 2026' };
const PREOP = { timepointId: 'timepoint:1:2.25.8', isDefault: false, label: 'TP-PREOP', date: 'September 01, 2026', study: 'Pelvis MR' };
const row = { measurementId: 'l1', toolType: 'Length', isVisible: true, isReadOnly: false, isPending: true, data: [] };
const COLLECTION = [{ groupId: 'pending', groupName: 'Pending', measurements: [row] }];

let container;
let root;
const render = (props = {}) => act(() => root.render(
  <MeasurementTable
    server={{ perms: { upload: true } }}
    measurementCollection={COLLECTION}
    servicesManager={{ services: {} }}
    viewports={{ viewportSpecificData: {}, activeViewportIndex: 0 }}
    timepoints={[{ key: 'StudyDate', label: 'Study Date', date: 'November 04, 2026' }]}
    overallWarnings={{ warningList: [] }}
    saveFunction={() => Promise.resolve({})}
    eventTimeout={0}
    {...props}
  />));
beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});
const $ = selector => container.querySelector(selector);
const $$ = selector => [...container.querySelectorAll(selector)];
// The dropdown's shown value, its open menu and the text of an entry (title and description)
const shownTitle = () => $('.timepointSelect .customSelectControl .customSelectOptionTitle').textContent;
const shownDescription = () => ($('.timepointSelect .customSelectControl .customSelectOptionDescription') || {}).textContent;
const open = () => act(() => $('.timepointSelect .customSelectControl').click());
const entries = () => $$('.timepointSelect .customSelectOption');
const textOf = entry => [...entry.querySelectorAll('p')].map(p => p.textContent).join('|');

// The order of the panel's parts: the section heading, the Study Date item or the selector, the search row
const order = () => [...container.querySelectorAll('h3, .measurementTableHeader, .measurementTableVisibilityRow, [data-cy="annotations-search"]')]
  .map(element => (element.tagName === 'H3' ? 'heading' : element.className.split(' ')[0] || element.getAttribute('data-cy')));

it('shows the Study Date item under the Annotations heading, before the search row, and no selector, without a defined timepoint', () => {
  render({ timepointOptions: [DEFAULT], activeTimepointId: DEFAULT.timepointId });
  expect($('.timepointLabel').textContent).toBe('Study Date');
  expect($('.timepointDate').textContent).toBe('November 04, 2026');
  expect($('[data-cy="timepoint-selector"]')).toBeNull();
  expect(order().slice(0, 3)).toEqual(['heading', 'measurementTableHeader', 'measurementTableVisibilityRow']);
  // The heading is the panel's first element
  expect(container.firstChild.firstChild.className).toBe('measurementTableAnnotations');
});

it('places the selector where the Study Date item was, under the heading and above the search row, and collapses with the section', () => {
  render({ timepointOptions: [DEFAULT, POSTOP], activeTimepointId: POSTOP.timepointId, activeTimepointIsDefined: true });
  expect(order().slice(0, 3)).toEqual(['heading', 'measurementTableHeader', 'measurementTableVisibilityRow']);
  expect($('.measurementTableHeader.timepointSelect .customSelectControl')).not.toBeNull();
  act(() => $('h3 button').click());
  expect($('.measurementTableHeader')).toBeNull();
  expect($('[data-cy="annotations-search"]')).toBeNull();
  act(() => $('h3 button').click());
  expect($('.measurementTableHeader.timepointSelect')).not.toBeNull();
});

it('lists Study Date/Time first, then the defined timepoints with their detail, the active one shown, and reports a choice once', () => {
  const onTimepointChange = jest.fn();
  render({ timepointOptions: [DEFAULT, PREOP, POSTOP], activeTimepointId: POSTOP.timepointId, onTimepointChange, activeTimepointIsDefined: true });
  expect($('[data-cy="timepoint-selector"]')).not.toBeNull();
  // The selector sits in the header's place, in the header element, without the Study Date item
  expect($('.measurementTableHeader.timepointSelect')).not.toBeNull();
  expect($('.measurementTableHeaderItem')).toBeNull();
  expect(shownTitle()).toBe('Post-operative review, 6 weeks');
  expect(shownDescription()).toBe('November 04, 2026 · 09:30');

  open();
  expect(entries().map(textOf)).toEqual([
    'Studiendatum|November 04, 2026',
    'TP-PREOP|September 01, 2026 · Pelvis MR',
    'Post-operative review, 6 weeks|November 04, 2026 · 09:30',
  ]);
  expect(entries()[2].classList.contains('active')).toBe(true);

  // Choosing the shown timepoint again reports nothing; another one is reported once
  act(() => entries()[2].click());
  expect(onTimepointChange).not.toHaveBeenCalled();
  open();
  act(() => entries()[0].click());
  expect(onTimepointChange).toHaveBeenCalledTimes(1);
  expect(onTimepointChange).toHaveBeenCalledWith(DEFAULT.timepointId);
  expect(entries()).toHaveLength(0);
});

it('translates the generated labels only: a defined description that matches a key is shown as written, shown or listed', () => {
  render({ timepointOptions: [DEFAULT, KEYLIKE], activeTimepointId: KEYLIKE.timepointId, activeTimepointIsDefined: true });
  expect(shownTitle()).toBe('Timepoint');
  open();
  expect(entries().map(textOf)).toEqual(['Studiendatum|November 04, 2026', 'Timepoint|January 01, 2026']);

  render({ timepointOptions: [DEFAULT, KEYLIKE], activeTimepointId: DEFAULT.timepointId, activeTimepointIsDefined: false });
  expect(shownTitle()).toBe('Studiendatum');
  expect(shownDescription()).toBe('November 04, 2026');
});

it('keeps the criteria warning beside the selector as beside the header, with Study Date/Time or a defined timepoint active', () => {
  const overallWarnings = { warningList: ['Measurement outside the criteria'] };
  render({ overallWarnings, timepointOptions: [DEFAULT, POSTOP], activeTimepointId: DEFAULT.timepointId });
  expect($('.measurementTableHeader.timepointSelect.withWarning .warning-status')).not.toBeNull();
  expect(shownTitle()).toBe('Studiendatum');

  render({ overallWarnings, timepointOptions: [DEFAULT, POSTOP], activeTimepointId: POSTOP.timepointId, activeTimepointIsDefined: true });
  expect($('.measurementTableHeader.timepointSelect.withWarning .warning-status')).not.toBeNull();

  render({ overallWarnings, timepointOptions: [DEFAULT], activeTimepointId: DEFAULT.timepointId });
  expect($('.measurementTableHeader:not(.timepointSelect) .warning-status')).not.toBeNull();
  expect($('.timepointLabel').textContent).toBe('Study Date');
});

it('is operated with the keyboard and named for assistive technology', () => {
  const onTimepointChange = jest.fn();
  render({ timepointOptions: [DEFAULT, PREOP, POSTOP], activeTimepointId: DEFAULT.timepointId, onTimepointChange });
  const control = $('.timepointSelect .customSelectControl');
  expect(control.getAttribute('role')).toBe('combobox');
  // The accessible name is the generated label, translated
  expect(control.getAttribute('aria-label')).toBe('Zeitpunkt');
  expect(control.tabIndex).toBe(0);
  const key = (key) => act(() => { control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

  act(() => control.focus());
  expect(document.activeElement).toBe(control);
  key('Enter');
  expect(control.getAttribute('aria-expanded')).toBe('true');
  expect($('.timepointSelect [role="listbox"]')).not.toBeNull();
  expect(entries()[0].classList.contains('highlighted')).toBe(true);
  // The control keeps focus and names the highlighted entry
  expect(document.activeElement).toBe(control);
  expect(control.getAttribute('aria-activedescendant')).toBe(entries()[0].id);
  key('ArrowDown');
  key('ArrowDown');
  expect(entries()[2].classList.contains('highlighted')).toBe(true);
  expect(entries()[2].getAttribute('role')).toBe('option');
  expect(control.getAttribute('aria-activedescendant')).toBe(entries()[2].id);
  expect(entries()[2].id).toBeTruthy();
  key('Enter');
  expect(control.getAttribute('aria-activedescendant')).toBeNull();
  expect(onTimepointChange).toHaveBeenCalledWith(POSTOP.timepointId);
  expect(entries()).toHaveLength(0);
  expect(document.activeElement).toBe(control);

  key('ArrowDown');
  expect(entries()).toHaveLength(3);
  key('Escape');
  expect(entries()).toHaveLength(0);
  expect(control.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(control);
  expect(onTimepointChange).toHaveBeenCalledTimes(1);
});

it('offers no save while a defined timepoint is active, and the save of a pending row otherwise', () => {
  render({ timepointOptions: [DEFAULT, POSTOP], activeTimepointId: DEFAULT.timepointId, activeTimepointIsDefined: false });
  act(() => jest.advanceTimersByTime(10));
  expect($('[data-cy="save-measurements-btn"]')).not.toBeNull();

  render({ timepointOptions: [DEFAULT, POSTOP], activeTimepointId: POSTOP.timepointId, activeTimepointIsDefined: true });
  act(() => jest.advanceTimersByTime(10));
  expect($('[data-cy="save-measurements-btn"]')).toBeNull();
});
