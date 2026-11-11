/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The picker's content: a palette swatch sets the picker's color, which Save returns as
// { r, g, b, a } (as it returns a color it was given in another form), and Reset clears. The
// palette and the picker share the dialog body; the footer has Cancel on the left and Reset
// beside Save on the right.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-color', () => ({ ChromePicker: ({ color }) => <div data-picker={JSON.stringify(color)} /> }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SimpleDialogShell: ({ children }) => children }), { virtual: true });
jest.mock('@ohif/ui-next', () => {
  const action = name => ({ children, onClick }) => <button type="button" data-action={name} onClick={onClick}>{children}</button>;
  const FooterAction = ({ children }) => <div data-footer="">{children}</div>;
  FooterAction.Left = ({ children }) => <div data-side="left">{children}</div>;
  FooterAction.Right = ({ children }) => <div data-side="right">{children}</div>;
  FooterAction.Primary = action('save');
  FooterAction.Secondary = action('cancel');
  const Button = ({ children, variant, ...props }) => <button type="button" {...props}>{children}</button>;
  const Pass = ({ children }) => <>{children}</>;
  const TooltipContent = ({ children }) => <div role="tooltip">{children}</div>;
  return { Button, FooterAction, Tooltip: Pass, TooltipProvider: Pass, TooltipTrigger: Pass, TooltipContent };
}, { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    displayAttributes: jest.requireActual('../../../../platform/core/src/displayAttributes'),
    utils: { color: jest.requireActual('../../../../platform/core/src/utils/colors').default },
  },
}), { virtual: true });

import { ColorPickerComponent } from './colorPickerDialog';

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

const render = props => {
  const handlers = { hide: jest.fn(), onSave: jest.fn(), ...props };
  act(() => root.render(<ColorPickerComponent {...handlers} />));
  return handlers;
};
const click = selector => act(() => container.querySelector(selector).click());

it('shows the palette above the picker; a swatch becomes the picker color, which Save returns', () => {
  const { onSave } = render({ value: 'rgb(255, 255, 0)', palette: [{ name: 'Primary', hex: '#348CFD' }, { name: 'White', hex: '#FFFFFF' }] });
  const swatches = container.querySelectorAll('.colorPickerPalette .colorPickerSwatch');
  expect([...swatches].map(swatch => swatch.getAttribute('aria-label'))).toEqual(['Primary', 'White']);
  // In the body, before the picker, so it lines up with the title and the picker
  expect(container.querySelector('.content > .colorPickerPalette + [data-picker]')).not.toBeNull();

  click('[aria-label="Primary"]');
  expect(container.querySelector('[aria-label="Primary"]').classList.contains('isSelected')).toBe(true);
  expect(container.querySelector('[aria-label="Primary"]').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('[aria-label="White"]').getAttribute('aria-pressed')).toBe('false');
  expect(JSON.parse(container.querySelector('[data-picker]').getAttribute('data-picker'))).toEqual({ r: 52, g: 140, b: 253, a: 1 });
  click('[data-action="save"]');
  expect(onSave).toHaveBeenCalledWith({ r: 52, g: 140, b: 253, a: 1 });
});

it('returns a color it was given as a string in the { r, g, b, a } form, and has no palette or Reset unless given', () => {
  const { onSave } = render({ value: 'rgb(255, 255, 0)' });
  expect(container.querySelector('.colorPickerPalette')).toBeNull();
  expect(container.querySelector('[data-cy="color-picker-reset"]')).toBeNull();
  expect([...container.querySelectorAll('.footer [data-side] button')].map(button => button.textContent)).toEqual(['Cancel', 'Save']);
  click('[data-action="save"]');
  expect(onSave).toHaveBeenCalledWith({ r: 255, g: 255, b: 0, a: 1 });
});

it('orders the footer Cancel | Reset, Save; Reset is named and explained as Reset to Default', () => {
  render({ value: '#FF8800', onReset: jest.fn() });
  expect([...container.querySelectorAll('.footer [data-side="left"] button')].map(button => button.textContent)).toEqual(['Cancel']);
  expect([...container.querySelectorAll('.footer [data-side="right"] button')].map(button => button.textContent)).toEqual(['Reset', 'Save']);
  const reset = container.querySelector('[data-cy="color-picker-reset"]');
  expect(reset.getAttribute('aria-label')).toBe('Reset to Default');
  expect(container.querySelector('[role="tooltip"]').textContent).toBe('Reset to Default');
});

it('takes the reset label and its hover text from props', () => {
  render({ value: '#FF8800', onReset: jest.fn(), btnResetText: 'Clear', btnResetTooltip: 'Clear the color' });
  const reset = container.querySelector('[data-cy="color-picker-reset"]');
  expect(reset.textContent).toBe('Clear');
  expect(reset.getAttribute('aria-label')).toBe('Clear the color');
  expect(container.querySelector('[role="tooltip"]').textContent).toBe('Clear the color');
});

it('clears the color with Reset', () => {
  const { onReset, onSave, hide } = render({ value: '#FF8800', onReset: jest.fn() });
  click('[data-cy="color-picker-reset"]');
  expect(onReset).toHaveBeenCalled();
  expect(hide).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
