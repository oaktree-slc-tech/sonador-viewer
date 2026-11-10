/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// A measurement row's controls are the Segmentations panel's: the ui-next Hide icon while the
// measurement is shown and the Show icon while it is hidden (the toggle then stays in view), a
// lock slot holding the ui-next Lock icon for a locked measurement, and a click toggling the
// measurement's visibility without selecting the row.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApi = { toggleVisibilityMeasurement: jest.fn() };
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { MeasurementApi: { get Instance() { return mockApi; } }, refreshCornerstoneViewports: () => {} },
    DicomMetadataStore: {},
    utils: { referenceIdentifiers: () => null },
  },
}), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
  Icons: {
    Hide: () => <span data-icon="hide" />,
    Show: () => <span data-icon="show" />,
    Lock: props => <span data-icon="lock" {...props} />,
  },
  Tooltip: ({ children }) => children,
  TooltipContent: () => null,
  TooltipProvider: ({ children }) => children,
  TooltipTrigger: ({ children }) => children,
}), { virtual: true });
jest.mock('./metadataEventConcerns', () => ({ subscribeSeriesMetadata: () => () => {} }));
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children }) => children }));
jest.mock('../tooltip', () => ({ Tooltip: () => null }));
jest.mock('./../../elements/Icon', () => ({ Icon: ({ name }) => <span data-legacy-icon={name} /> }));

import { MeasurementTableItem } from './MeasurementTableItem';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  mockApi.toggleVisibilityMeasurement.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (measurement, onItemClick = jest.fn()) => {
  act(() => root.render(
    <MeasurementTableItem
      itemIndex={1}
      onItemClick={onItemClick}
      measurementData={{ measurementId: 'm1', data: [{ displayText: '12 mm' }], ...measurement }}
    />));
  return onItemClick;
};
const toggle = () => container.querySelector('[data-cy="measurement-visibility-toggle"]');

it('shows the Hide icon for a shown measurement, and hides it on click without selecting the row', () => {
  const onItemClick = render({ isVisible: true });
  expect(toggle().querySelector('[data-icon="hide"]')).not.toBeNull();
  expect(toggle().className).toBe('annotationVisibilityToggle ');
  expect(container.querySelector('[data-legacy-icon="eye"]')).toBeNull();

  act(() => toggle().click());
  expect(mockApi.toggleVisibilityMeasurement).toHaveBeenCalledWith('m1', false);
  expect(onItemClick).not.toHaveBeenCalled();
});

it('shows the Show icon for a hidden measurement, kept in view', () => {
  render({ isVisible: false });
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().classList.contains('isHidden')).toBe(true);
  act(() => toggle().click());
  expect(mockApi.toggleVisibilityMeasurement).toHaveBeenCalledWith('m1', true);
});

it('holds the ui-next Lock icon in the lock slot for a locked measurement, and an empty slot otherwise', () => {
  render({ isVisible: true, isLocked: true });
  expect(container.querySelector('.measurementLockSlot [data-icon="lock"]')).not.toBeNull();
  expect(container.querySelector('[data-legacy-icon="lock"]')).toBeNull();

  render({ isVisible: true, isLocked: false });
  expect(container.querySelector('.measurementLockSlot')).not.toBeNull();
  expect(container.querySelector('.measurementLockSlot').children).toHaveLength(0);
});
