/**
 * @jest-environment jsdom
 */
// The palette's menu, status block and Repair surface card rendered with the REAL @ohif/ui-next
// kit (Radix tooltips, hover card, dropdown menu), driven by tool-state updates: no loop
// ("Maximum update depth exceeded"), no ref warning.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@ohif/ui-next';

import { reset3DToolState, set3DPreview, set3DRepairPanel, set3DSurfaceHealth, set3DToolTarget, set3DUnsynchronizedEdits } from '../threeDTools/threeDToolState';

import { WholeSurfaceMenu, WholeSurfaceStatus } from './WholeSurface';

jest.mock('../toolbox/constants', () => ({ SEG_EDITOR_COMMAND_CONTEXT: 'SEG_EDITOR_TEST' }));
jest.mock('../utils/previewColor', () => ({ usePreviewColor: () => '#ff00ff', setPreviewColor: jest.fn() }));
jest.mock('../utils/meshColor', () => ({
  MESH_COLOR_AUTO: 'auto', getMeshColor: () => 'auto', isMeshColorAuto: () => true, setMeshColor: jest.fn(), subscribeMeshColor: () => () => {}, useMeshColor: () => 'auto',
}));
const mockDialogService = { show: jest.fn(), dismiss: jest.fn() };
jest.mock('@ohif/core', () => ({
  useSystem: () => ({ servicesManager: { services: { UIDialogService: mockDialogService } }, commandsManager: { runCommand: jest.fn() } }),
}), { virtual: true });
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o = {}) => String(key).replace(/{{(\w+)}}/g, (_m, n) => String(o[n])) }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.DOMRect = window.DOMRect || class { constructor() { this.x = 0; this.y = 0; this.width = 0; this.height = 0; } };

const liver = { segmentIndex: 1, label: 'Liver', color: [255, 0, 0] };
const damaged = { boundaryEdgeCount: 38, nonManifoldEdgeCount: 2, inconsistentEdgeCount: 0, degenerate: 0, duplicate: 0, closed: false, triangles: 12480 };

const mounted = [];
const render = element => {
  const container = document.createElement('div');
  container.setAttribute('data-seg-editor-theme', 'true');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
};
afterEach(() => {
  while (mounted.length) {
    mounted.pop()();
  }
  reset3DToolState();
});

let consoleError;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

const errors = () => consoleError.mock.calls.map(call => String(call[0]));

it('the Repair surface card renders with the real kit and survives state churn and a preview', () => {
  act(() => { set3DToolTarget(liver); set3DSurfaceHealth(damaged); set3DRepairPanel(true); });
  const container = render(React.createElement(TooltipProvider, null, React.createElement(WholeSurfaceStatus)));
  expect(container.querySelector('[data-cy="seg-editor-repair-surface"]')).not.toBeNull();
  for (let i = 0; i < 20; i++) {
    act(() => { set3DSurfaceHealth({ ...damaged, boundaryEdgeCount: 38 + i }); });
  }
  act(() => { set3DPreview({ kind: 'remove', repair: true, holes: 2 }); });
  expect(container.querySelector('[data-cy="seg-editor-apply-repair"]')).not.toBeNull();
  act(() => { set3DPreview(null); });
  expect(errors().filter(message => /Maximum update depth|Function components cannot be given refs/.test(message))).toEqual([]);
});

it('the menu and status block render with the real kit and survive state churn', () => {
  act(() => { set3DToolTarget(liver); set3DSurfaceHealth(damaged); set3DUnsynchronizedEdits(2, 1); });
  const container = render(React.createElement(TooltipProvider, null,
    React.createElement(WholeSurfaceMenu), React.createElement(WholeSurfaceStatus)));
  expect(container.querySelector('[data-cy="seg-editor-surface-health"]')).not.toBeNull();
  // Open the "⋯" menu as a pointer does (Radix opens on pointerdown), then churn the state
  const trigger = container.querySelector('[data-cy="seg-editor-whole-surface-menu"]');
  act(() => { trigger.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })); });
  act(() => { trigger.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true })); });
  expect(document.querySelector('[data-cy="seg-editor-whole-surface-items"]')).not.toBeNull();
  for (let i = 0; i < 20; i++) {
    act(() => { set3DSurfaceHealth({ ...damaged, boundaryEdgeCount: 38 + i }); set3DUnsynchronizedEdits(i % 3, 0); });
  }
  expect(errors().filter(message => /Maximum update depth|Function components cannot be given refs/.test(message))).toEqual([]);
});
