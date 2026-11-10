/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Toolbar buttons are keyboard controls: a tab stop, activated once per press of Enter or Space,
// named by their translated label, with their on/off or menu state exposed. The "More" menu moves a
// keyboard user into its portaled items and back to its trigger when Escape closes it.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('../elements/Icon', () => ({ Icon: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => `t:${key}` }) }));

import ToolbarButton from './ToolbarButton';
import ExpandableToolMenu from './ExpandableToolMenu';

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
  document.body.innerHTML = '';
});

const render = element => act(() => root.render(element));
const key = (target, value, init = {}) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }));
});
const keyUp = (target, value) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true, cancelable: true }));
});
const buttonOf = label => document.querySelector(`[aria-label="t:${label}"]`);


describe('ToolbarButton', () => {
  it('is a named tab stop', () => {
    render(<ToolbarButton label="Angles" />);
    const button = buttonOf('Angles');
    expect(button.getAttribute('role')).toBe('button');
    expect(button.tabIndex).toBe(0);
  });

  it('activates once per press as a native button: Enter on keydown, Space on keyup; repeats and other keys ignored', () => {
    const onClick = jest.fn();
    render(<ToolbarButton label="Angles" onClick={onClick} />);
    const button = buttonOf('Angles');

    key(button, 'Enter');
    key(button, 'Enter', { repeat: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].type).toBe('keydown');

    key(button, ' ');
    key(button, ' ', { repeat: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    keyUp(button, ' ');
    expect(onClick).toHaveBeenCalledTimes(2);

    key(button, 'a');
    keyUp(button, 'a');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is presentational inside a wrapper that is the control: no role, tab stop or key handling', () => {
    const onClick = jest.fn();
    render(<ToolbarButton label="Adjust" isToggle isActive presentational onClick={onClick} />);
    const button = document.querySelector('.toolbar-button');

    expect(button.hasAttribute('role')).toBe(false);
    expect(button.hasAttribute('tabindex')).toBe(false);
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    key(button, 'Enter');
    keyUp(button, ' ');
    expect(onClick).not.toHaveBeenCalled();
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes the state of a toggle as aria-pressed, and only for a toggle', () => {
    render(<ToolbarButton label="Angles" isToggle isActive />);
    expect(buttonOf('Angles').getAttribute('aria-pressed')).toBe('true');
    render(<ToolbarButton label="Angles" isToggle isActive={false} />);
    expect(buttonOf('Angles').getAttribute('aria-pressed')).toBe('false');
    render(<ToolbarButton label="Angles" isActive />);
    expect(buttonOf('Angles').hasAttribute('aria-pressed')).toBe(false);
  });
});


describe('ExpandableToolMenu', () => {
  const Item = ({ toolbarClickCallback, button }) => (
    <ToolbarButton label={button.label} isToggle onClick={evt => toolbarClickCallback(button, evt)} />
  );
  const renderMenu = onItem => render(
    <ExpandableToolMenu label="More" toolbarClickCallback={onItem}
      buttons={[{ id: 'a', label: 'Angles', CustomComponent: Item }, { id: 'b', label: 'Segmentations', CustomComponent: Item }]} />
  );

  it('opens from the keyboard, moves focus to its first item, and activates items by keyboard', async () => {
    jest.useFakeTimers();
    const onItem = jest.fn();
    renderMenu(onItem);
    const trigger = buttonOf('More');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    key(trigger, 'Enter');
    act(() => jest.runAllTimers());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(buttonOf('Angles'));

    key(document.activeElement, ' ');
    keyUp(document.activeElement, ' ');
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(onItem.mock.calls[0][0].id).toBe('a');
    jest.useRealTimers();
  });

  it('returns focus to the trigger when Escape closes it', () => {
    jest.useFakeTimers();
    renderMenu(jest.fn());
    const trigger = buttonOf('More');
    key(trigger, 'Enter');
    act(() => jest.runAllTimers());
    expect(document.activeElement).toBe(buttonOf('Angles'));

    act(() => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    });
    act(() => jest.runAllTimers());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    jest.useRealTimers();
  });

  it('leaves focus alone when opened with the pointer', () => {
    jest.useFakeTimers();
    renderMenu(jest.fn());
    const trigger = buttonOf('More');
    act(() => trigger.click());
    act(() => jest.runAllTimers());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).not.toBe(buttonOf('Angles'));
    jest.useRealTimers();
  });
});
