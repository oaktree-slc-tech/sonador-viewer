/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The segmentation editor's Layout and 3D menus follow the active viewport's display set across an
// empty viewport (before one loads, or during a study reload, when the toolbar stays mounted): they
// take the state of the display set shown next, follow its later changes and ignore those of the
// one they followed before. The display-set service throws for a UID that is not a string, as the
// real one does.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockState = { viewportSpecificData: {}, activeViewportIndex: 0 };
const mockDisplaySets = {};
const mockListeners = new Set();
jest.mock('react-redux', () => {
  const React = jest.requireActual('react');
  return { useSelector: selector => selector(), ReactReduxContext: React.createContext({ store: {} }) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
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
            subscribe: (event, listener) => {
              mockListeners.add(listener);
              return { unsubscribe: () => mockListeners.delete(listener) };
            },
          },
        },
      },
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui', () => ({
  ExpandableToolMenu: ({ buttons }) => <div data-menu>{buttons.map(child => <span key={child.id} data-option={child.id} />)}</div>,
  viewerbaseGetDisplaySet: (data, index) => ({ displaySet: mockDisplaySets[((data || {})[index] || {}).displaySetInstanceUID] }),
}), { virtual: true });
jest.mock('@ohif/ui-next', () => {
  const LayoutSelector = ({ children }) => <div>{children}</div>;
  LayoutSelector.Trigger = ({ children }) => children;
  LayoutSelector.Content = ({ children }) => children;
  LayoutSelector.PresetSection = ({ children }) => children;
  LayoutSelector.Preset = ({ commandOptions, className }) => <span data-preset={commandOptions.layoutId} data-current={String(className === 'bg-muted')} />;
  return { Icons: { ByName: () => null }, LayoutSelector };
}, { virtual: true });
jest.mock('../layouts/segEditorLayouts', () => ({ SEG_EDITOR_LAYOUTS: [{ id: 'primary3D', title: 'P' }, { id: 'grid', title: 'G' }] }));

import SegEditor3DOptionsMenu from './SegEditor3DOptionsMenu';
import SegEditorLayoutSelector from './SegEditorLayoutSelector';

global.IS_REACT_ACT_ENVIRONMENT = true;

const MENU = {
  id: 'Seg3D', label: '3D', icon: 'x',
  buttons: [{ id: 'Volume' }, { id: 'Surface' }, { id: 'Reset', uiOptions: { availableWhileEditing3d: true } }],
};

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  mockListeners.clear();
  mockState.viewportSpecificData = {};
  Object.assign(mockDisplaySets, {
    a: { displaySetInstanceUID: 'a', segEditorLayout: 'primary3D', segEditor3dEditingEnabled: false },
    b: { displaySetInstanceUID: 'b', segEditorLayout: 'grid', segEditor3dEditingEnabled: true },
  });
});
afterEach(() => act(() => root.unmount()));

const render = () => act(() => root.render(<>
  <SegEditorLayoutSelector button={{ id: 'Layout' }} toolbarClickCallback={() => {}} />
  <SegEditor3DOptionsMenu button={MENU} toolbarClickCallback={() => {}} />
</>));
const show = (uid) => {
  mockState.viewportSpecificData = uid ? { 0: { displaySetInstanceUID: uid } } : {};
  render();
};
const currentLayout = () => [...container.querySelectorAll('[data-preset]')]
  .filter(preset => preset.getAttribute('data-current') === 'true').map(preset => preset.getAttribute('data-preset'));
const options = () => [...container.querySelectorAll('[data-option]')].map(option => option.getAttribute('data-option'));
const change = (uid, attrs) => act(() => {
  Object.assign(mockDisplaySets[uid], attrs);
  mockListeners.forEach(listener => listener({ displaySetInstanceUID: uid, displaySet: mockDisplaySets[uid] }));
});

it('takes the state of the display set shown after an empty viewport', () => {
  show(undefined);
  expect(currentLayout()).toEqual([]);
  expect(options()).toEqual(['Volume', 'Surface', 'Reset']);
  show('b');
  expect(currentLayout()).toEqual(['grid']);
  expect(options()).toEqual(['Reset']);
});

it('follows the next display set through a reload, and ignores the one it followed before', () => {
  show('a');
  expect(currentLayout()).toEqual(['primary3D']);
  expect(options()).toEqual(['Volume', 'Surface', 'Reset']);
  show(undefined);
  expect(currentLayout()).toEqual(['primary3D']);
  show('b');
  expect(currentLayout()).toEqual(['grid']);
  expect(options()).toEqual(['Reset']);

  // Changes of the current display set are followed; those of the previous one are not
  change('b', { segEditorLayout: 'primary3D', segEditor3dEditingEnabled: false });
  expect(currentLayout()).toEqual(['primary3D']);
  expect(options()).toEqual(['Volume', 'Surface', 'Reset']);
  change('a', { segEditorLayout: 'grid', segEditor3dEditingEnabled: true });
  expect(currentLayout()).toEqual(['primary3D']);
  expect(options()).toEqual(['Volume', 'Surface', 'Reset']);
});
