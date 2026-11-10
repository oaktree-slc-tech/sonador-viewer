/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The volume viewer's segmentation-surface button is shown once its display set has the attribute,
// and falls back to its default (hidden) while the active viewport has no display set, as during a
// study reload: the display-set service, which throws for a UID that is not a string, is not asked.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockState = { viewportSpecificData: {}, activeViewportIndex: 0 };
const mockDisplaySets = { 'ds-1': { displaySetInstanceUID: 'ds-1', segmentationSurfaceEnabled: true } };
jest.mock('react-redux', () => ({ useSelector: selector => selector() }));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  redux: { selectors: { getActiveViewportData: () => mockState } },
  default: {
    display: {
      DisplaySetApi: {
        Instance: {
          displaySetService: {
            getDisplaySetByUID: (uid) => {
              if (typeof uid !== 'string') {
                throw new Error(`getDisplaySetByUID: displaySetInstanceUid must be a string, you passed ${uid}`);
              }
              return mockDisplaySets[uid];
            },
          },
        },
      },
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui', () => ({
  viewerbaseGetDisplaySet: (data, index) => ({ displaySet: mockDisplaySets[((data || {})[index] || {}).displaySetInstanceUID] }),
}), { virtual: true });
jest.mock('@ohif/extension-vtk', () => ({ DisplaySetAttributeActiveToolbarButton: () => <span data-button /> }), { virtual: true });

import ViewerSegmentationSurfaceEnabledToolbarButton from './ViewerSegmentationSurfaceEnabledToolbarButton';

global.IS_REACT_ACT_ENVIRONMENT = true;

it('shows the button for a display set with the attribute, and hides it while there is none', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = () => act(() => root.render(<ViewerSegmentationSurfaceEnabledToolbarButton button={{ id: 'surface' }} />));

  mockState.viewportSpecificData = { 0: { displaySetInstanceUID: 'ds-1' } };
  render();
  expect(container.querySelector('[data-button]')).not.toBeNull();

  mockState.viewportSpecificData = {};
  render();
  expect(container.querySelector('[data-button]')).toBeNull();

  mockState.viewportSpecificData = { 0: { displaySetInstanceUID: 'ds-1' } };
  render();
  expect(container.querySelector('[data-button]')).not.toBeNull();
  act(() => root.unmount());
});
