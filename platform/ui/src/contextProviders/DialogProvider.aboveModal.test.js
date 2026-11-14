/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// A dialog opened over a modal (the 3D Inspector) is stacked above it: OHIFModal's overlay is at
// z-index 1071, an ordinary dialog and its overlay at 999. It is placed inside the open modal, which
// hides the application root from assistive technology and keeps the keyboard focus: its field takes
// the focus, is named by its label, its buttons are reached by keyboard, and closing it returns the
// focus to the modal, which stays open. The dialogs are created through the application's
// UIDialogService, which passes only the props it knows to the provider.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockDialogCount = 0;
jest.mock('@ohif/core', () => ({ utils: { guid: () => `dialog-${mockDialogCount++}` } }), { virtual: true });
jest.mock('./DialogProvider.styl', () => ({}), { virtual: true });

import DialogProvider from './DialogProvider';
import Modal from 'react-modal';

import UIDialogService from '../../../core/src/services/UIDialogService';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('stacks a dialog marked aboveModal, and its overlay, above the modal; others stay below', async () => {
  const service = UIDialogService.create({});
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<DialogProvider service={service}><div /></DialogProvider>));
  const { create } = service;
  const Content = ({ name }) => <span data-dialog={name} />;

  await act(async () => {
    create({ id: 'plain', content: Content, contentProps: { name: 'plain' }, showOverlay: true });
    create({ id: 'over', content: Content, contentProps: { name: 'over' }, showOverlay: true, aboveModal: true });
  });
  const itemOf = name => container.querySelector(`[data-dialog="${name}"]`).closest('.DraggableItem');
  expect(itemOf('plain').style.zIndex).toBe('999');
  expect(itemOf('plain').closest('.Overlay').style.zIndex).toBe('999');
  expect(Number(itemOf('over').style.zIndex)).toBeGreaterThan(1071);
  expect(Number(itemOf('over').closest('.Overlay').style.zIndex)).toBeGreaterThan(1071);
  await act(async () => root.unmount());
});

it('places a dialog over an open modal inside it, with the focus, and gives the focus back on close', async () => {
  const service = UIDialogService.create({});
  const app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  Modal.setAppElement(app);
  const root = createRoot(app);
  // The Inspector: a modal holding a focusable view
  const Inspector = () => (
    <Modal isOpen ariaHideApp contentLabel="Inspector"><button type="button" data-inspector-view>View</button></Modal>
  );
  await act(async () => root.render(<DialogProvider service={service}><Inspector /></DialogProvider>));
  const view = document.querySelector('[data-inspector-view]');
  act(() => view.focus());
  expect(app.getAttribute('aria-hidden')).toBe('true');

  const LabelDialog = ({ onClose }) => (
    <div>
      <label htmlFor="arrow-label">New label</label>
      <input id="arrow-label" type="text" />
      <button type="button" onClick={onClose}>Cancel</button>
      <button type="button">Confirm</button>
    </div>
  );
  let id;
  await act(async () => {
    id = service.create({
      content: LabelDialog, showOverlay: true, aboveModal: true,
      contentProps: { onClose: () => service.dismiss({ id }) },
    });
  });

  const input = document.getElementById('arrow-label');
  // Inside the modal, outside every hidden ancestor
  expect(input.closest('.ReactModal__Content')).not.toBeNull();
  expect(input.closest('[aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.labels[0].textContent).toBe('New label');
  const buttons = [...input.closest('.DraggableItem').querySelectorAll('button')];
  expect(buttons.map(button => [button.textContent, button.tabIndex])).toEqual([['Cancel', 0], ['Confirm', 0]]);

  // Closed with Cancel: the focus is back on the view, and the modal stays open
  jest.useFakeTimers();
  await act(async () => buttons[0].click());
  act(() => jest.runAllTimers());
  jest.useRealTimers();
  expect(document.getElementById('arrow-label')).toBeNull();
  expect(document.activeElement).toBe(view);
  expect(document.querySelector('.ReactModal__Content')).not.toBeNull();
  await act(async () => root.unmount());
  app.remove();
});

it('leaves an ordinary dialog where it was, without moving the focus', async () => {
  const service = UIDialogService.create({});
  const app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  const root = createRoot(app);
  await act(async () => root.render(<DialogProvider service={service}><button type="button" data-page>Page</button></DialogProvider>));
  const page = app.querySelector('[data-page]');
  act(() => page.focus());
  const Content = () => <input data-plain-field />;
  await act(async () => { service.create({ content: Content, showOverlay: true }); });
  const field = document.querySelector('[data-plain-field]');
  expect(app.contains(field)).toBe(true);
  expect(document.activeElement).toBe(page);
  await act(async () => root.unmount());
  app.remove();
});
