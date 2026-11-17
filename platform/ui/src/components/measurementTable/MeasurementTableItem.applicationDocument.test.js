/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row of a measurement read from an application document: read-only, marked by a document in place
// of the lock, with no actions menu or row actions, selected or not.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { MeasurementApi: { Instance: {} }, refreshCornerstoneViewports: () => {} },
    DicomMetadataStore: {},
    utils: {
      // The study's series 2.25.2 is loaded; any other is not
      referenceIdentifiers: (store, { SeriesInstanceUID }) => (SeriesInstanceUID === '2.25.2'
        ? { SeriesNumber: 5, SeriesDescription: 'Synthetic CT', Modality: 'CT', InstanceNumber: undefined } : null),
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
  // The row menu as its items, each a button
  DataRowActions: ({ actions }) => (
    <div data-row-actions={actions.length}>
      {actions.map(action => <button key={action.id} type="button" data-cy={action.dataCY} onClick={action.onClick}>{action.label}</button>)}
    </div>
  ),
  Icons: { Hide: () => null, Show: () => null, Lock: props => <span data-icon="lock" {...props} /> },
  // The note's card, rendered in place: its trigger marked, its content beside it
  HoverCard: ({ children }) => <div data-hover-card>{children}</div>,
  HoverCardTrigger: ({ children }) => <div data-hover-trigger>{children}</div>,
  HoverCardPortal: ({ children }) => children,
  HoverCardContent: ({ children, side, align, ...props }) => <div data-side={side} {...props}>{children}</div>,
  // A landmark set's card, closed
  Popover: ({ children }) => children,
  PopoverAnchor: ({ children }) => children,
  PopoverPortal: () => null,
  PopoverContent: () => null,
  Tooltip: ({ children }) => children,
  TooltipContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  TooltipProvider: ({ children }) => children,
  TooltipTrigger: ({ children }) => children,
}), { virtual: true });
jest.mock('./metadataEventConcerns', () => ({ subscribeSeriesMetadata: () => () => {} }));
// The warning note of other rows (not used by these)
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children, overlay }) => <>{children}<div data-warning>{overlay}</div></> }));
jest.mock('../tooltip', () => ({ Tooltip: ({ children, className }) => <div className={className}>{children}</div> }));
jest.mock('./../../elements/Icon', () => ({ Icon: ({ name }) => <span data-legacy-icon={name} /> }));

import { MeasurementTableItem } from './MeasurementTableItem';

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
  container.remove();
});

const row = (extra = {}) => ({
  measurementId: 'm-1', toolType: 'Length', isVisible: true, isReadOnly: true, isLocked: true, isPending: false,
  data: [{ displayText: '31.20 mm' }], refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2', ...extra,
});
const render = (measurementData, props = {}) => act(() => root.render(
  <MeasurementTableItem itemIndex={1} onItemClick={() => {}} onToggleLock={jest.fn()} onLineTextColor={jest.fn()}
    measurementData={measurementData} {...props} />));

it('keeps the lock, named for assistive technology, with a hover that shows a document and says where the row comes from', () => {
  render(row({ fromApplicationDocument: true }));
  const lock = container.querySelector('[data-cy="measurement-application-document"]');
  expect(lock.querySelector('[data-cy="measurement-locked"]')).not.toBeNull();
  expect(lock.getAttribute('aria-label')).toBe('Read-only: from an application document');
  // Reached by the pointer and the keyboard
  expect(lock.getAttribute('tabindex')).toBe('0');
  const hover = container.querySelector('[data-cy="measurement-application-document-tooltip"]');
  expect(hover.querySelector('[data-cy="measurement-application-document-icon"]')).not.toBeNull();
  expect(hover.textContent).toBe('Read-only: from an application document');
});

it('has no actions menu or row actions, selected or not', () => {
  render(row({ fromApplicationDocument: true }), { isSelected: true });
  expect(container.querySelector('[data-row-actions]')).toBeNull();
  expect(container.querySelector('.rowActions .btnAction')).toBeNull();
});

it('a measurement read from an exchange report keeps its lock (control)', () => {
  render(row());
  expect(container.querySelector('[data-cy="measurement-locked"]')).not.toBeNull();
  expect(container.querySelector('[data-cy="measurement-application-document"]')).toBeNull();
  expect(container.querySelector('[data-cy="measurement-application-document-tooltip"]')).toBeNull();
});

it('a landmark set of an application document is marked the same way', () => {
  render(row({ toolType: 'SonadorLandmarkSet', fromApplicationDocument: true, data: [{ displayText: 'Pelvic landmarks' }],
    landmarkSet: {
      key: 'doc::set', name: 'Pelvic landmarks', count: 1, domain: 'patient', documentKind: 'application', placed: true,
      colors: { line: '#FFFF00', text: '#FFFF00' }, landmarks: [], position: null, types: [], appearance: null,
    } }));
  expect(container.querySelector('[data-cy="measurement-application-document"] [data-cy="measurement-locked"]')).not.toBeNull();
  expect(container.querySelector('[data-cy="measurement-application-document-icon"]')).not.toBeNull();
});
