/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row actions menu (ui-next DataRowActions) by keyboard: the trigger shows while it has
// keyboard focus, Enter opens the menu, Escape closes it and returns focus to the trigger, and
// choosing an item leaves focus to the action (which may open a dialog).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { DataRowActions } from '../../../../ui-next/src/components/DataRow/DataRowActions';

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

const trigger = () => container.querySelector('[data-cy="actionsMenuTrigger"]');
const menu = () => document.querySelector('[role="menu"]');
const key = (element, name) => act(() => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
});

// Radix returns focus once the menu has unmounted, on a timer
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)));

const render = (onLock = jest.fn()) => {
  act(() => root.render(
    <DataRowActions actions={[{ id: 'Lock', label: 'Lock', icon: null, onClick: onLock, dataCY: 'LockToggle' }]} />));
  return onLock;
};

it('shows the trigger of an unselected row while it has keyboard focus', () => {
  render();
  expect(trigger().className).toMatch(/(^|\s)opacity-0(\s|$)/);
  expect(trigger().className).toMatch(/(^|\s)focus-visible:opacity-100(\s|$)/);
});

it('opens with Enter, and returns focus to the trigger when closed with Escape', async () => {
  render();
  act(() => trigger().focus());
  key(trigger(), 'Enter');
  expect(menu()).not.toBeNull();

  key(menu(), 'Escape');
  await settle();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('leaves focus to the action when an item is chosen', async () => {
  const onLock = render();
  act(() => trigger().focus());
  key(trigger(), 'Enter');
  const item = document.querySelector('[role="menuitem"]');
  act(() => item.click());
  await settle();

  expect(onLock).toHaveBeenCalled();
  expect(menu()).toBeNull();
  expect(document.activeElement).not.toBe(trigger());
});
