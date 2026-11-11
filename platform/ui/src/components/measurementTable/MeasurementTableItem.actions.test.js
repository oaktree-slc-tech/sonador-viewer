/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The actions menu of a measurement row: a pending measurement's line and text colors and its
// lock, in the Segmentations panel's row menu (ui-next DataRowActions); a saved one has none.

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
    ColorChange: () => <span data-icon="color" />,
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const handlers = () => ({ onItemClick: jest.fn(), onToggleLock: jest.fn(), onLineTextColor: jest.fn() });
const render = (measurement, props = handlers()) => {
  act(() => root.render(
    <MeasurementTableItem
      itemIndex={1}
      {...props}
      measurementData={{ measurementId: 'm1', data: [{ displayText: '12 mm' }], ...measurement }}
    />));
  return props;
};
// The row's controls in order (the mocked tooltip content is not one)
const controls = () => [...container.querySelector('.measurementStatus').children].map((element) => {
  if (element.getAttribute('data-cy') === 'measurement-visibility-toggle') return 'toggle';
  if (element.classList.contains('measurementLock')) return 'lock';
  if (element.hasAttribute('data-row-actions')) return 'menu';
  if (element.classList.contains('measurementControlSpacer')) return 'spacer';
  return null;
}).filter(Boolean);
const menu = () => container.querySelector('.measurementStatus [data-row-actions]');
const item = dataCY => container.querySelector(`[data-row-actions] [data-cy="${dataCY}"]`);

it('offers a pending measurement its line color, text color and lock, as the last control', () => {
  const props = render({ isVisible: true, isReadOnly: false, isPending: true, isLocked: false });
  expect(menu().getAttribute('data-row-actions')).toBe('3');
  // Unlocked: no lock, the menu beside the visibility toggle
  expect(controls()).toEqual(['toggle', 'menu']);
  expect([...menu().children].map(button => button.textContent)).toEqual(['Line Color', 'Text Color', 'Lock']);

  act(() => item('LineColor').click());
  expect(props.onLineTextColor).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ measurementId: 'm1' }), 'line');
  act(() => item('TextColor').click());
  expect(props.onLineTextColor).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ measurementId: 'm1' }), 'text');
  act(() => item('LockToggle').click());
  expect(props.onToggleLock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ measurementId: 'm1' }));
});

it('offers to unlock a pending measurement the user locked', () => {
  render({ isVisible: true, isReadOnly: false, isPending: true, isLocked: true });
  expect(item('LockToggle').textContent).toBe('Unlock');
  // Locked: the lock between the toggle and the menu, which moves the toggle a column left
  expect(controls()).toEqual(['toggle', 'lock', 'menu']);
});

it('gives a saved measurement, or one read from a report, no menu: its lock is the last control', () => {
  render({ isVisible: true, isReadOnly: true, isLocked: true });
  expect(menu()).toBeNull();
  expect(controls()).toEqual(['toggle', 'lock']);
});

it('gives a measurement of a tool that cannot be saved (no service record) no menu, its toggle in the column of the others', () => {
  render({ isVisible: true, isReadOnly: false, isPending: false });
  expect(menu()).toBeNull();
  expect(controls()).toEqual(['toggle', 'spacer']);
});

it('offers only the actions the panel handles', () => {
  render({ isVisible: true, isReadOnly: false, isPending: true }, { onItemClick: jest.fn(), onToggleLock: jest.fn() });
  expect([...menu().children].map(button => button.textContent)).toEqual(['Lock']);
});

describe('custom color indicator', () => {
  const indicator = () => container.querySelector('.displayTexts [data-cy="measurement-color-indicator"]');

  const halves = () => [...indicator().children].map(half => [half.className, half.style.backgroundColor]);

  it('marks a measurement drawn in its own line color with a dot of that color, before its value', () => {
    render({ isVisible: true, isReadOnly: false, isPending: true, customColor: { line: '#FF8800', text: null } });
    expect(halves()).toEqual([['measurementColorIndicatorLine', 'rgb(255, 136, 0)']]);
    expect(indicator().nextElementSibling.className).toBe('measurementDisplayText');
  });

  it('shows the line color on the left half and the text color on the right', () => {
    render({ isVisible: true, isReadOnly: true, isLocked: true, customColor: { line: '#FF8800', text: '#00FF00' } });
    expect(halves()).toEqual([['measurementColorIndicatorLine', 'rgb(255, 136, 0)'], ['measurementColorIndicatorText', 'rgb(0, 255, 0)']]);
  });

  it('is not shown without custom colors', () => {
    render({ isVisible: true, isReadOnly: false, isPending: true });
    expect(indicator()).toBeNull();
  });
});
