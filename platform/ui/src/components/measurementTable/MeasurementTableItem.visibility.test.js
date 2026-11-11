/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// A measurement row's controls are the Segmentations panel's: the ui-next Hide icon while the
// measurement is shown and the Show icon while it is hidden (the toggle then stays in view), a
// ui-next Lock icon after it for a locked measurement, and a click toggling the
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
  // The row menu as its items, each a button
  DataRowActions: ({ actions }) => (
    <div data-row-actions={actions.length}>
      {actions.map(action => <button key={action.id} type="button" data-cy={action.dataCY} onClick={action.onClick}>{action.label}</button>)}
    </div>
  ),
  Icons: {
    Hide: () => <span data-icon="hide" />,
    Show: () => <span data-icon="show" />,
    Lock: props => <span data-icon="lock" {...props} />,
  },
  Tooltip: ({ children }) => children,
  TooltipContent: ({ children, ...props }) => <div role="tooltip" {...props}>{children}</div>,
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
  expect(toggle().hasAttribute('title')).toBe(false);
  expect(container.querySelector('[data-cy="measurement-visibility-tooltip"]').textContent).toBe('Hide');

  act(() => toggle().click());
  expect(mockApi.toggleVisibilityMeasurement).toHaveBeenCalledWith('m1', false);
  expect(onItemClick).not.toHaveBeenCalled();
});

it('shows the Show icon for a hidden measurement, kept in view', () => {
  render({ isVisible: false });
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().classList.contains('isHidden')).toBe(true);
  expect(container.querySelector('[data-cy="measurement-visibility-tooltip"]').textContent).toBe('Show');
  act(() => toggle().click());
  expect(mockApi.toggleVisibilityMeasurement).toHaveBeenCalledWith('m1', true);
});

it('shows the ui-next Lock icon after the toggle for a locked measurement, and no lock otherwise', () => {
  render({ isVisible: true, isLocked: true, isReadOnly: true });
  const lock = container.querySelector('.measurementLock [data-icon="lock"]');
  expect(lock).not.toBeNull();
  expect(container.querySelector('[data-legacy-icon="lock"]')).toBeNull();
  // A saved measurement: the lock is the last control
  expect(container.querySelector('.measurementStatus').lastElementChild).toBe(lock.parentElement);

  render({ isVisible: true, isLocked: false, isReadOnly: true });
  expect(container.querySelector('.measurementLock')).toBeNull();
});
