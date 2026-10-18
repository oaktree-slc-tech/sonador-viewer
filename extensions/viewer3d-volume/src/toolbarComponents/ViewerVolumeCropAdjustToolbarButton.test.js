/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// Crop Adjust toolbar button (ohif-viewers#155 §3.3, §3.4): keyboard reachable, help tag on hover
// and focus in every state, focus kept across state changes. Rendered with the real
// OverlayTrigger, Tooltip, and ToolbarButton.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { CROP_ADJUST } from '../enums';
import ViewerVolumeCropAdjustToolbarButton from './ViewerVolumeCropAdjustToolbarButton';

const UID = 'ds-1';

const displaySets = {};
const listeners = [];
const displaySetService = {
  EVENTS: { DISPLAY_SET_CHANGED: 'changed' },
  getDisplaySetByUID: (uid) => displaySets[uid],
  subscribe: (event, handler) => {
    listeners.push(handler);
    return { unsubscribe: () => listeners.splice(listeners.indexOf(handler), 1) };
  },
};

jest.mock('react-redux', () => ({
  useSelector: () => ({ viewportSpecificData: { 0: { displaySetInstanceUID: 'ds-1' } }, activeViewportIndex: 0 }),
}));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (text) => text }) }));

jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { display: { DisplaySetApi: { Instance: { get displaySetService() { return displaySetService; } } } } },
  redux: { selectors: { getActiveViewportData: () => ({}) } },
}), { virtual: true });

jest.mock('../../../../platform/ui/src/elements/Icon', () => {
  const React = require('react');
  return { Icon: ({ name }) => React.createElement('svg', { 'data-icon': name }) };
});

jest.mock('@ohif/ui', () => ({
  OverlayTrigger: jest.requireActual('../../../../platform/ui/src/components/overlayTrigger').OverlayTrigger,
  Tooltip: jest.requireActual('../../../../platform/ui/src/components/tooltip').Tooltip,
  ToolbarButton: jest.requireActual('../../../../platform/ui/src/viewer/ToolbarButton.js').default,
  viewerbaseGetDisplaySet: (viewportSpecificData, index) => ({ displaySet: viewportSpecificData[index] }),
}), { virtual: true });


global.IS_REACT_ACT_ENVIRONMENT = true;

const BUTTON = { id: 'CTVolumeCropSelect', label: 'Adjust', icon: 'dot-circle' };
const HELP_TAGS = {
  [CROP_ADJUST.ACTIVE]: 'Hide crop box',
  [CROP_ADJUST.PAUSED]: 'Resume adjusting the crop box',
  [CROP_ADJUST.OFF]: 'Show and adjust crop box',
};

function publish(adjustState, volumeCroppingEnabled = true) {
  displaySets[UID] = { displaySetInstanceUID: UID, volumeCroppingEnabled, volumeCropAdjustState: adjustState };
  act(() => listeners.forEach((handler) => handler({ displaySetInstanceUID: UID, displaySet: displaySets[UID] })));
}

const mounted = [];

function render(adjustState, onClick = jest.fn()) {
  displaySets[UID] = { displaySetInstanceUID: UID, volumeCroppingEnabled: true, volumeCropAdjustState: adjustState };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(ViewerVolumeCropAdjustToolbarButton, {
    toolbarClickCallback: onClick, button: BUTTON,
  })));
  mounted.push(root);
  return { onClick, control: () => container.querySelector('[role="button"]') };
}

const helpTag = () => document.querySelector('[role="tooltip"] .tooltip-inner')?.textContent;
// Past the show delay and the Fade transition
const settle = () => act(() => { jest.advanceTimersByTime(1000); });
const key = (target, type, name, init = {}) => act(() => {
  target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init }));
});


beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()));
  jest.useRealTimers();
  document.body.innerHTML = '';
});


describe('crop Adjust toolbar button', () => {
  it('is a focusable toggle button in the tab order', () => {
    const { control } = render(CROP_ADJUST.ACTIVE);

    expect(control().tabIndex).toBe(0);
    expect(control().getAttribute('aria-label')).toBe('Adjust');
    expect(control().getAttribute('aria-pressed')).toBe('true');
  });

  it.each(Object.values(CROP_ADJUST))('shows the %s help tag on focus and on hover', (state) => {
    const { control } = render(state);

    act(() => control().focus());
    settle();
    expect(helpTag()).toBe(HELP_TAGS[state]);
    expect(control().getAttribute('aria-describedby')).toBe('CTVolumeCropSelect-help-tag');

    act(() => control().blur());
    settle();
    expect(helpTag()).toBeUndefined();

    act(() => {
      control().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    settle();
    expect(helpTag()).toBe(HELP_TAGS[state]);
  });

  it('uses the paused icon only while paused', () => {
    const { control } = render(CROP_ADJUST.PAUSED);
    expect(control().querySelector('svg').dataset.icon).toBe('dot-circle-paused');
    expect(control().getAttribute('aria-pressed')).toBe('false');

    publish(CROP_ADJUST.ACTIVE);
    expect(control().querySelector('svg').dataset.icon).toBe('dot-circle');
  });

  it('activates on Enter keydown and Space keyup, once per press', () => {
    const { control, onClick } = render(CROP_ADJUST.PAUSED);
    act(() => control().focus());

    key(control(), 'keydown', 'Enter');
    key(control(), 'keydown', 'Enter', { repeat: true });
    expect(onClick).toHaveBeenCalledTimes(1);

    key(control(), 'keydown', ' ');
    expect(onClick).toHaveBeenCalledTimes(1);
    key(control(), 'keyup', ' ');
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenLastCalledWith(BUTTON, expect.anything());
  });

  it('keeps focus and dismisses the help tag when the state changes', () => {
    const { control } = render(CROP_ADJUST.PAUSED);
    act(() => control().focus());
    settle();
    expect(helpTag()).toBe(HELP_TAGS[CROP_ADJUST.PAUSED]);

    const focused = control();
    publish(CROP_ADJUST.ACTIVE);
    expect(control()).toBe(focused);
    expect(document.activeElement).toBe(focused);
    settle();
    expect(helpTag()).toBeUndefined();
    expect(control().getAttribute('aria-pressed')).toBe('true');

    // A pending help tag is cancelled too
    act(() => control().blur());
    act(() => control().focus());
    publish(CROP_ADJUST.OFF);
    settle();
    expect(helpTag()).toBeUndefined();
    expect(document.activeElement).toBe(control());
  });

  it('is hidden while cropping is off', () => {
    const { control } = render(CROP_ADJUST.ACTIVE);
    publish(CROP_ADJUST.OFF, false);
    expect(control()).toBeNull();
  });
});
