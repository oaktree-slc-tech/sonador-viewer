/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Landmarks group of the Annotations panel: the global toggle covers the sets as it covers the
// other annotations (its icon reads them, and it shows or hides them with the rest, or the matching
// ones while a search is active); no group header has a toggle of its own. The search matches a set
// by its name, its description, its landmarks' names and the word "landmark"; a set found only
// through its landmarks says what matched.

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
const mockSetOne = jest.fn();
const mockSeries = {
  '2.25.21': { SeriesNumber: 12, Modality: 'MR', SeriesDescription: 'Sag T2 FSE' },
  '2.25.22': { SeriesNumber: 3, Modality: 'CT', SeriesDescription: 'Axial Bone' },
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { info: () => {}, warn: () => {} },
    DICOMSR: { landmarks: { setLandmarkSetVisible: (...args) => mockSetOne(...args) } },
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
    Icons: new Proxy({}, { get: (target, name) => () => <span data-icon={String(name)} /> }),
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
  MeasurementTableItem: ({ measurementData, landmarkMatch, onLandmarkClick }) => (
    <div data-row={measurementData.measurementId} data-match={landmarkMatch || ''}
      onClick={() => onLandmarkClick && onLandmarkClick(null, measurementData, 0)} />
  ),
}));
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children }) => children }));
jest.mock('../tooltip', () => ({ Tooltip: () => null }));
jest.mock('./../../elements/Icon', () => ({ Icon: () => null }));

import MeasurementTable from './MeasurementTable';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const onLandmarkClick = jest.fn();
const landmark = (name, index) => ({ index, ordinal: index + 1, name });
const set = (id, name, landmarks, extra = {}) => ({
  measurementId: id, toolType: 'SonadorLandmarkSet', trackingIdentifier: 'cornerstoneTools@^4.0.0:SonadorLandmarkSet',
  isVisible: true, isReadOnly: true, data: [{ displayText: name || 'Landmark set' }], label: '',
  landmarkSet: { key: id, name, landmarks, count: landmarks.length, placed: true },
  ...extra,
});
const COLLECTION = [
  { groupId: 'measurements', groupName: 'Measurements', measurements: [
    { measurementId: 'l1', toolType: 'Length', isVisible: true, isReadOnly: true, data: [], label: 'Femur' },
  ] },
  { groupId: 'landmarks', groupName: 'Landmarks', measurements: [
    set('s1', 'Pelvic landmarks', [landmark('Pubic symphysis', 0), landmark('Tear drop', 1), landmark('Tear drop', 2), landmark(null, 3)],
      { label: 'Pelvis (planning)', description: 'Points picked on the planning model' }),
    set('s2', 'Femoral head points', [landmark('Head centre', 0)]),
  ] },
];
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
      onLandmarkClick={onLandmarkClick}
    />));
};
beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  Object.values(mockApi).forEach(fn => fn.mockClear());
  mockApi.getMeasurementsBySeries.mockImplementation(mockBySeries);
  mockSetOne.mockClear();
  onLandmarkClick.mockClear();
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
const matchOf = id => $(`[data-row="${id}"]`).getAttribute('data-match');
const search = (value) => act(() => {
  const input = $('[data-cy="annotations-search"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});


describe('the global toggle', () => {
  it('is the only toggle for every set: no group header has one of its own', () => {
    expect($$('[data-cy="landmark-group-visibility-toggle"]')).toHaveLength(0);
    expect($$('[data-cy="all-annotations-visibility-toggle"]')).toHaveLength(1);
  });

  it('reads the sets: the Show icon while a set is hidden, even with every measurement shown', () => {
    act(() => root.unmount());
    container.remove();
    COLLECTION[1].measurements[0].isVisible = false;
    mount();
    expect($('[data-cy="all-annotations-visibility-toggle"] [data-icon="Show"]')).not.toBeNull();
    COLLECTION[1].measurements[0].isVisible = true;
  });

  it('shows or hides every annotation at once, the sets following the global visibility', () => {
    act(() => $('[data-cy="all-annotations-visibility-toggle"]').click());
    expect(mockApi.setAllMeasurementsVisibility).toHaveBeenCalledWith(false);
    // The sets follow the global visibility themselves (their store registers with the visibility rule)
    expect(mockSetOne).not.toHaveBeenCalled();
  });

  it('while searching, acts on the matching annotations, matching sets included, through the one API call', () => {
    search('e');
    act(() => $('[data-cy="all-annotations-visibility-toggle"]').click());
    expect(mockApi.toggleVisibilityMeasurement.mock.calls).toEqual([['l1', false], ['s1', false], ['s2', false]]);
    expect(mockSetOne).not.toHaveBeenCalled();
    expect(mockApi.setAllMeasurementsVisibility).not.toHaveBeenCalled();
  });
});


describe('search', () => {
  it('finds a set by its name, its description, "landmark", and the names of its landmarks', () => {
    search('femoral');
    expect(listed()).toEqual(['s2']);
    search('planning');
    expect(listed()).toEqual(['s1']);
    search('landmark');
    expect(listed()).toEqual(['s1', 's2']);
    search('centre');
    expect(listed()).toEqual(['s2']);
  });

  it('says what matched when only a landmark\'s name did, with how many landmarks bear it', () => {
    search('tear');
    expect(listed()).toEqual(['s1']);
    expect(matchOf('s1')).toBe('Tear drop (2)');
    expect($$('.numberOfItems').map(element => element.textContent)).toEqual(['1 of 2']);
    search('pelvic');
    expect(matchOf('s1')).toBe('');
  });

});


it('passes a landmark chosen from a card to the Viewer', () => {
  act(() => $('[data-row="s1"]').click());
  expect(onLandmarkClick).toHaveBeenCalledWith(null, expect.objectContaining({ measurementId: 's1' }), 0);
});
