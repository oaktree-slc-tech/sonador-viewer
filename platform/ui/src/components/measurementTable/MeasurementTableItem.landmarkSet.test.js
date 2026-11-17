/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row of a landmark set (one row per set, read-only): its name, its series and modality, the
// number of its landmarks and the lock; no visibility toggle or actions of a measurement. A held set
// has a note on its index cell naming why it is not shown and the series it was made on.

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

const row = (landmarkSet, extra = {}) => ({
  measurementId: 'doc::set', toolType: 'SonadorLandmarkSet', isVisible: true, isReadOnly: true, isLocked: true, isPending: false,
  data: [{ displayText: 'Pelvic landmarks' }], label: 'Pelvis (planning) / Points picked',
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2',
  landmarkSet: { key: 'doc::set', count: 10, domain: 'patient', documentKind: 'exchange', placed: true, ...landmarkSet },
  ...extra,
});
const onItemClick = jest.fn();
const render = (measurementData, props = {}) => act(() => root.render(
  <MeasurementTableItem itemIndex={1} onItemClick={onItemClick} onDelete={jest.fn()} onRelabel={jest.fn()} measurementData={measurementData} {...props} />));

it('shows the name, the series, the modality and the number of landmarks, locked, with no image number', () => {
  render(row({}));
  expect(container.querySelector('.measurementDisplayText').textContent).toBe('Pelvic landmarks');
  expect(container.querySelector('.refSxNum').textContent).toBe('S:5');
  expect(container.querySelector('.refSxModality').textContent).toBe('Modality:CT');
  expect(container.querySelector('.refImgNum')).toBeNull();
  expect(container.querySelector('[data-cy="landmark-set-count"]').textContent).toBe('10 landmarks');
  expect(container.querySelector('.measurementLabel').textContent).toBe('Pelvis (planning) / Points picked');
  expect(container.querySelector('[data-cy="measurement-locked"]')).not.toBeNull();
  render(row({ count: 1 }));
  expect(container.querySelector('[data-cy="landmark-set-count"]').textContent).toBe('1 landmark');
});

it('has no visibility toggle, actions menu or row actions of a measurement, selected or not', () => {
  render(row({}), { isSelected: true });
  expect(container.querySelector('[data-cy="measurement-visibility-toggle"]')).toBeNull();
  expect(container.querySelector('[data-row-actions]')).toBeNull();
  expect(container.querySelector('.rowActions .btnAction')).toBeNull();
});

it('a placed set has no note on its index cell', () => {
  render(row({}));
  expect(container.querySelector('[data-cy="landmark-set-held-note"]')).toBeNull();
});

it('a held set: the note on its index cell, focusable, with the sentence of its state and its stored series', () => {
  render(row({ placed: false, note: "No loaded series shares this measurement's frame of reference.", sourceSeries: '2.25.2' }));
  const note = container.querySelector('[data-cy="landmark-set-held-note"]');
  expect(note.querySelector('.warningTitle').textContent).toBe('Landmark set not shown');
  expect(note.querySelector('.warningContent p').textContent).toBe("No loaded series shares this measurement's frame of reference.");
  expect(note.querySelector('.outOfPlaneNoteItem').textContent).toBe('Series: 5 Synthetic CT');
  expect(container.querySelector('.itemIndex').getAttribute('tabindex')).toBe('0');

  // A stored series that is not loaded, or none: Unknown
  render(row({ placed: false, note: 'The image this landmark set was placed on is not loaded.', sourceSeries: '2.25.9' }));
  expect(container.querySelector('[data-cy="landmark-set-held-note"] .outOfPlaneNoteItem').textContent).toBe('Series: Unknown');
  render(row({ placed: false, note: 'The image this landmark set was placed on is not loaded.' }));
  expect(container.querySelector('[data-cy="landmark-set-held-note"] .outOfPlaneNoteItem').textContent).toBe('Series: Unknown');
});

it('keeps the count on a row with no series (Series Unavailable), with no S: or Modality', () => {
  render(row({ placed: false, note: "No loaded series shares this measurement's frame of reference." }, { refSeriesInstanceUID: undefined }));
  expect(container.querySelector('[data-cy="landmark-set-count"]').textContent).toBe('10 landmarks');
  expect(container.querySelector('.refSxNum')).toBeNull();
  expect(container.querySelector('.refSxModality')).toBeNull();
  // The control: with its series, S: and Modality beside the count
  render(row({}));
  expect(container.querySelector('.refSxNum').textContent).toBe('S:5');
  expect(container.querySelector('[data-cy="landmark-set-count"]').textContent).toBe('10 landmarks');
});
