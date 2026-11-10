/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The Rendering Presets row of the volume rendering menu: its icon and label on one line, apart,
// and a click opening the presets dialog.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockDialog = { show: jest.fn(), dismiss: jest.fn() };
jest.mock('@ohif/core', () => ({
  useSystem: () => ({ servicesManager: { services: { UIDialogService: mockDialog } } }),
}), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  AllInOneMenu: {
    Item: ({ label, icon, rightIcon, onClick }) => (
      <div data-cy="item" onClick={onClick}>
        {icon && <div data-cy="icon-slot">{icon}</div>}
        <span>{label}</span>
        {rightIcon}
      </div>
    ),
  },
  Icons: { VolumeRendering: props => <img data-cy="presets-icon" alt="" {...props} />, ByName: () => null },
}), { virtual: true });
jest.mock('./VolumeRenderingPresetsContent', () => ({ VolumeRenderingPresetsContent: () => null }));

import { VolumeRenderingPresets } from './VolumeRenderingPresets';

global.IS_REACT_ACT_ENVIRONMENT = true;

let root;
beforeEach(() => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<VolumeRenderingPresets viewportId="vp" volumeRenderingPresets={[]} />));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

it('keeps the icon and label together on one line, with space between them', () => {
  const icon = document.querySelector('[data-cy="presets-icon"]');
  const row = icon.parentElement;
  expect(document.querySelector('[data-cy="icon-slot"]')).toBeNull();
  expect(row.textContent).toBe('Rendering Presets');
  expect(row.className).toEqual(expect.stringContaining('whitespace-nowrap'));
  expect(row.className).toEqual(expect.stringContaining('gap-[10px]'));
});

it('opens the presets dialog for the viewport', () => {
  act(() => document.querySelector('[data-cy="item"]').click());
  expect(mockDialog.show).toHaveBeenCalledWith(expect.objectContaining({
    id: 'volume-rendering-presets',
    contentProps: expect.objectContaining({ viewportId: 'vp' }),
  }));
});
