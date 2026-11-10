/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// A toolbar button that follows an attribute of the active viewport's display set keeps working
// while the active viewport has no display set. Before any display set loads it takes its default
// state; during a study reload (such as after removing a series) it keeps the state of the display
// set it follows; it takes the state of the display set the viewport shows next. The display-set
// service throws for a UID that is not a string, as the real one does.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockState = { viewportSpecificData: {}, activeViewportIndex: 0 };
const mockDisplaySets = {};
jest.mock('react-redux', () => ({ useSelector: selector => selector() }));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  redux: { selectors: { getActiveViewportData: () => mockState } },
  default: {
    display: {
      DisplaySetApi: {
        Instance: {
          displaySetService: {
            EVENTS: { DISPLAY_SET_CHANGED: 'changed' },
            getDisplaySetByUID: (uid) => {
              if (typeof uid !== 'string') {
                throw new Error(`getDisplaySetByUID: displaySetInstanceUid must be a string, you passed ${uid}`);
              }
              return mockDisplaySets[uid];
            },
            subscribe: () => ({ unsubscribe: () => {} }),
          },
        },
      },
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui', () => ({
  ToolbarButton: ({ id, isActive }) => <button type="button" data-id={id} data-active={String(isActive)} />,
  viewerbaseGetDisplaySet: (data, index) => {
    const entry = (data || {})[index] || {};
    return { displaySet: mockDisplaySets[entry.displaySetInstanceUID] };
  },
}), { virtual: true });

import DisplaySetAttributeActiveToolbarButton from './DisplaySetAttributeActiveToolbarButton';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  mockState.viewportSpecificData = {};
  Object.keys(mockDisplaySets).forEach(key => delete mockDisplaySets[key]);
  mockDisplaySets['ds-1'] = { displaySetInstanceUID: 'ds-1', annotationsVisible: false };
  mockDisplaySets['ds-2'] = { displaySetInstanceUID: 'ds-2', annotationsVisible: true };
});
afterEach(() => act(() => root.unmount()));

const render = () => act(() => root.render(
  <DisplaySetAttributeActiveToolbarButton
    toolbarClickCallback={() => {}} button={{ id: 'Annotations', label: 'Annotations', icon: 'x' }}
    isActiveDisplaySetAttr="annotationsVisible" isActiveDefault
  />));
const active = () => container.querySelector('[data-id="Annotations"]').getAttribute('data-active');
const show = uid => { mockState.viewportSpecificData = uid ? { 0: { displaySetInstanceUID: uid } } : {}; };

it('takes the default state before any display set is shown', () => {
  render();
  expect(active()).toBe('true');
});

it('keeps its display set through a reload that leaves the viewport without one', () => {
  show('ds-1');
  render();
  expect(active()).toBe('false');
  show(undefined);
  render();
  expect(active()).toBe('false');
  show('ds-1');
  render();
  expect(active()).toBe('false');
});

it('takes the state of a different display set the viewport shows next', () => {
  render();
  show('ds-1');
  render();
  expect(active()).toBe('false');
  show('ds-2');
  render();
  expect(active()).toBe('true');
});
