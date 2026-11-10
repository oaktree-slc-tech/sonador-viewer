/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The MPR pane's Inspector control: a named button for its view, with a help tag that says which
// view opens and what it shows; it opens by pointer, Enter (key down) and Space (key up), once per
// press.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('@ohif/ui', () => ({ Icon: () => <span data-icon="search-plus" /> }), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  TooltipProvider: ({ children }) => children,
  Tooltip: ({ children }) => <div data-tooltip>{children}</div>,
  TooltipTrigger: ({ children }) => children,
  TooltipContent: ({ children, ...props }) => <div role="tooltip" {...props}>{children}</div>,
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ getRenderingEngine: () => undefined }), { virtual: true });
// The strings go through the translation path: "[...]" marks a translated string
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values = {}) => `[${key.replace(/{{(\w+)}}/g, (_, name) => values[name])}]` }),
}));

import InspectButton from './InspectButton';

global.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let onOpen;
const mount = (orientation) => {
  onOpen = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<InspectButton orientation={orientation} onOpen={onOpen} />));
};
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const button = () => document.querySelector('[data-cy="mpr-inspect-button"]');
const key = (type, value, init = {}) => act(() => {
  button().dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...init }));
});

it.each([['axial', 'Axial'], ['sagittal', 'Sagittal'], ['coronal', 'Coronal']])(
  'names the %s view it opens, and says what the Inspector shows', (orientation, view) => {
    mount(orientation);
    expect(button().getAttribute('role')).toBe('button');
    expect(button().tabIndex).toBe(0);
    expect(button().getAttribute('aria-label')).toBe(`[Open [${view}] Inspector]`);
    const tip = document.querySelector('[data-cy="mpr-inspect-tooltip"]');
    expect(tip.textContent).toBe(`[Open [${view}] Inspector][Shows this slice full screen for measuring and annotating.]`);
  });

it('opens once per click, Enter (key down, not repeated) and Space (key up)', () => {
  mount('axial');
  act(() => button().click());
  expect(onOpen).toHaveBeenCalledTimes(1);
  key('keydown', 'Enter');
  key('keydown', 'Enter', { repeat: true });
  expect(onOpen).toHaveBeenCalledTimes(2);
  key('keydown', ' ');
  expect(onOpen).toHaveBeenCalledTimes(2);
  key('keyup', ' ');
  expect(onOpen).toHaveBeenCalledTimes(3);
});
