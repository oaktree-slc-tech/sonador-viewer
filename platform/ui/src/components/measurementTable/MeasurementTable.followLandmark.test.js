/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// "Follow selected landmark" in the Annotations panel's settings drawer: the fourth switch, in the
// row form of the others, off by default; it sets its own general preference, which a remount of the
// panel and a new session in this browser read back, and follows a change made elsewhere.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApi = { toggleVisibilityMeasurement: jest.fn(), setAllMeasurementsVisibility: jest.fn(), getMeasurementsBySeries: () => new Map() };
jest.mock('@ohif/core', () => {
  const preferences = jest.requireActual('../../../../core/src/services/UserPreferencesService/UserPreferencesService');
  return {
    __esModule: true,
    LANDMARKS_FOLLOW_SELECTION_DEFAULT: preferences.LANDMARKS_FOLLOW_SELECTION_DEFAULT,
    LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY: preferences.LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY,
    ANNOTATIONS_REGION_LEAD_VALUE_DEFAULT: preferences.ANNOTATIONS_REGION_LEAD_VALUE_DEFAULT,
    ANNOTATIONS_REGION_LEAD_VALUE_PREFERENCE_KEY: preferences.ANNOTATIONS_REGION_LEAD_VALUE_PREFERENCE_KEY,
    UserPreferencesServiceEvents: preferences.UserPreferencesServiceEvents,
    // This browser's storage, as the Viewer's
    UserPreferencesService: new preferences.UserPreferencesServiceClass({ storage: global.localStorage }),
    default: {
      log: { info: () => {}, warn: () => {} },
      DicomMetadataStore: { getSeries: () => ({ instances: [] }) },
      utils: { referenceIdentifiers: () => null },
      measurements: {
        refreshCornerstoneViewports: () => {},
        MeasurementApi: { get Instance() { return mockApi; }, getConfiguration: () => ({ measurementTools: [] }) },
      },
    },
  };
}, { virtual: true });
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

import { UserPreferencesService } from '@ohif/core';
import { UserPreferencesServiceClass, LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY as KEY } from '../../../../core/src/services/UserPreferencesService/UserPreferencesService';
import MeasurementTable from './MeasurementTable';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const mount = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(
    <MeasurementTable
      server={{}}
      measurementCollection={[]}
      servicesManager={{ services: {} }}
      viewports={{ viewportSpecificData: {}, activeViewportIndex: 0 }}
      timepoints={[]}
      overallWarnings={{ warningList: [] }}
    />));
  act(() => container.querySelector('[data-cy="annotations-settings-toggle"]').click());
};
const unmount = () => {
  act(() => root.unmount());
  container.remove();
};
const $ = selector => container.querySelector(selector);
const followSwitch = () => $('#annotations-follow-selected-landmark');

afterEach(() => {
  unmount();
  UserPreferencesService.setGeneral(KEY, false);
  window.localStorage.clear();
});


it('is the fourth switch of the settings drawer, in the row form of the others, off by default', () => {
  mount();
  const rows = [...$('[data-cy="annotations-settings"]').children];
  expect(rows).toHaveLength(4);
  expect(rows[3].className).toBe(rows[2].className);
  expect(rows[3].querySelector('label').textContent).toBe('Follow selected landmark');
  expect(rows[3].querySelector('label').getAttribute('for')).toBe('annotations-follow-selected-landmark');
  expect(followSwitch().checked).toBe(false);
});

it('sets its own preference, which a remount and a new session in this browser read back', () => {
  mount();
  act(() => followSwitch().click());
  expect(followSwitch().checked).toBe(true);
  expect(UserPreferencesService.getGeneral(KEY)).toBe(true);

  // The panel remounted in this session
  unmount();
  mount();
  expect(followSwitch().checked).toBe(true);
  // A new session: the preference is read from this browser
  expect(new UserPreferencesServiceClass({ storage: window.localStorage }).getGeneral(KEY)).toBe(true);

  act(() => followSwitch().click());
  expect(UserPreferencesService.getGeneral(KEY)).toBe(false);
});

it('follows the preference set elsewhere', () => {
  mount();
  act(() => { UserPreferencesService.setGeneral(KEY, true); });
  expect(followSwitch().checked).toBe(true);
});
