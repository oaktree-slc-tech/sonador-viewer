/**
 * @jest-environment ./jest.jsdom.environment.js
 */
// The Layout widget by keyboard: the trigger is a focusable button, a preset is a tab stop that
// Enter or Space activates, Escape dismisses the popover and focus returns to the trigger.
// Rendered with react-dom into jsdom against the real Radix Popover.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The package's exports map covers only its index; the component is reached by path
import { LayoutSelector } from '../../../../platform/ui-next/src/components/LayoutSelector/LayoutSelector';

// Radix Popper positions through floating-ui, which observes the anchor
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let onSelectionChange;

function Widget() {
  return (
    <LayoutSelector onSelectionChange={onSelectionChange}>
      <LayoutSelector.Trigger>
        <button type="button" className="toolbar-button">Layout</button>
      </LayoutSelector.Trigger>
      <LayoutSelector.Content>
        <LayoutSelector.PresetSection title="Layouts">
          <LayoutSelector.Preset title="MPR" icon="layout-advanced-mpr" commandOptions={{ layoutId: 'mpr' }} isPreset />
          <LayoutSelector.Preset title="3D Only" icon="layout-advanced-3d-only" commandOptions={{ layoutId: 'only3D' }} isPreset />
        </LayoutSelector.PresetSection>
      </LayoutSelector.Content>
    </LayoutSelector>
  );
}

const trigger = () => container.querySelector('button.toolbar-button');
const presets = () => [...document.querySelectorAll('[role="dialog"] [role="button"]')];
const keydown = (element, key) =>
  act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
const open = () => act(() => { trigger().click(); });

beforeEach(() => {
  onSelectionChange = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Widget />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('Layout widget keyboard operation', () => {
  it('has a focusable button trigger that opens the presets', () => {
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger().tabIndex).toBe(0);
    act(() => { trigger().focus(); });
    expect(document.activeElement).toBe(trigger());

    open();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(presets().map(el => el.textContent)).toEqual(['MPR', '3D Only']);
  });

  it('presets are tab stops that Enter and Space activate, closing the popover', () => {
    open();
    const [mpr, only3D] = presets();
    expect(mpr.tabIndex).toBe(0);
    act(() => { mpr.focus(); });
    expect(document.activeElement).toBe(mpr);

    keydown(mpr, 'Enter');
    expect(onSelectionChange).toHaveBeenCalledWith({ layoutId: 'mpr' }, true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    open();
    keydown(presets()[1], ' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith({ layoutId: 'only3D' }, true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(only3D).toBeDefined();
  });

  it('Escape dismisses the popover and returns focus to the trigger', async () => {
    act(() => { trigger().focus(); });
    open();
    const [mpr] = presets();
    act(() => { mpr.focus(); });
    expect(document.activeElement).toBe(mpr);

    keydown(document.activeElement, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Radix restores focus from the closed content on the next macrotask
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(trigger());
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
