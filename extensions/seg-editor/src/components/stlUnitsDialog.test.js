/**
 * @jest-environment jsdom
 */
// The unit declaration dialog of a model import (ohif-viewers#151 FR-5): what it offers, that
// nothing is pre-selected, its keyboard, and the answer it resolves

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { callStlUnitsDialog, StlUnitsDialog } from './stlUnitsDialog';

jest.mock('@ohif/ui', () => {
  const ReactLib = require('react');
  return {
    SimpleDialogShell: ({ children, headerTitle, componentRef }) => ReactLib.createElement('div', { ref: componentRef, 'data-title': headerTitle }, children),
  };
}, { virtual: true });
jest.mock('@ohif/ui-next', () => {
  const ReactLib = require('react');
  const FooterAction = ({ children }) => ReactLib.createElement('div', { className: 'actions' }, children);
  FooterAction.Primary = ({ children, ...props }) => ReactLib.createElement('button', { type: 'button', ...props }, children);
  FooterAction.Secondary = ({ children, ...props }) => ReactLib.createElement('button', { type: 'button', ...props }, children);
  return { FooterAction };
}, { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: 'mm', label: 'millimetres (mm)' },
  { value: 'in', label: 'inches (in)' },
  { value: 'as-read', label: 'Unknown: import as read' },
];

const mounted = [];
function render(props = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(StlUnitsDialog, {
    headerTitle: 'Declare the model units',
    message: 'Choose the unit.',
    options: OPTIONS,
    confirmText: 'Import',
    cancelText: 'Cancel',
    onConfirm,
    onCancel,
    ...props,
  })));
  mounted.push(() => { act(() => root.unmount()); container.remove(); });
  const radio = value => container.querySelector(`[data-cy="stl-units-${value}"]`);
  const confirm = () => container.querySelector('[data-cy="stl-units-confirm"]');
  return { container, onConfirm, onCancel, radio, confirm };
}
afterEach(() => {
  while (mounted.length) {
    mounted.pop()();
  }
});

const click = element => act(() => { element.click(); });
// A key pressed with nothing focused: the event rises from the body to the window listener (an
// event dispatched on the window itself has no Node for a target, which no browser produces)
const press = key => act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

describe('StlUnitsDialog', () => {
  it('offers every unit with none selected, and keeps Import disabled until one is chosen', () => {
    const { radio, confirm, onConfirm } = render();
    expect(OPTIONS.map(option => radio(option.value).checked)).toEqual([false, false, false]);
    expect(Array.from(document.querySelectorAll('[data-cy="stl-units-options"] label')).map(label => label.textContent))
      .toEqual(['millimetres (mm)', 'inches (in)', 'Unknown: import as read']);
    expect(confirm().disabled).toBe(true);

    click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();

    click(radio('in'));
    expect(radio('in').checked).toBe(true);
    expect(confirm().disabled).toBe(false);
    click(confirm());
    expect(onConfirm).toHaveBeenCalledWith('in');
  });

  it('shows the comparison with the image as notes, and none without', () => {
    const { container } = render({ suggestions: ['femur: looks like metres', 'tibia: looks like metres'] });
    expect(Array.from(container.querySelectorAll('[data-cy="stl-units-suggestions"] li')).map(li => li.textContent))
      .toEqual(['femur: looks like metres', 'tibia: looks like metres']);
    const bare = render();
    expect(bare.container.querySelector('[data-cy="stl-units-suggestions"]')).toBeNull();
  });

  it('cancels on Escape, and imports on Enter only once a unit is chosen', () => {
    const { radio, onConfirm, onCancel } = render();
    press('Enter');
    expect(onConfirm).not.toHaveBeenCalled();
    click(radio('mm'));
    press('Enter');
    expect(onConfirm).toHaveBeenCalledWith('mm');
    press('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('callStlUnitsDialog', () => {
  function service() {
    const uiDialogService = { show: jest.fn(), dismiss: jest.fn() };
    const props = () => uiDialogService.show.mock.calls[0][0].contentProps;
    return { uiDialogService, props };
  }

  it('resolves the chosen unit and dismisses the dialog once', async () => {
    const { uiDialogService, props } = service();
    const answer = callStlUnitsDialog({
      uiDialogService, id: 'units', title: 'Declare', message: 'm', options: OPTIONS, confirmText: 'Import', cancelText: 'Cancel',
    });
    expect(uiDialogService.show.mock.calls[0][0]).toMatchObject({ id: 'units', content: StlUnitsDialog, centralize: true, showOverlay: true });
    expect(props().radioName).toBe('units-unit');
    expect(props().options).toBe(OPTIONS);
    props().onConfirm('in');
    props().onCancel();
    expect(await answer).toBe('in');
    expect(uiDialogService.dismiss).toHaveBeenCalledTimes(1);
    expect(uiDialogService.dismiss).toHaveBeenCalledWith({ id: 'units' });
  });

  it('resolves null on cancel', async () => {
    const { uiDialogService, props } = service();
    const answer = callStlUnitsDialog({
      uiDialogService, id: 'units', title: 'Declare', message: 'm', options: OPTIONS, confirmText: 'Import', cancelText: 'Cancel',
    });
    props().onCancel();
    expect(await answer).toBeNull();
  });
});
