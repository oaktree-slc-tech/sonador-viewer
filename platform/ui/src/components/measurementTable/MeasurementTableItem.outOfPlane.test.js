/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row of an out-of-plane measurement: the index cell marked with a cube named "3D
// measurement", the view in place of the image on the detail line, and a note on the index cell
// only (hover or keyboard focus) naming the plane, then (in the classic viewport) the action that
// opens it in the MPR, then the view and the series; with no loaded series of its Frame of
// Reference, a note saying so and no navigation.

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
      referenceIdentifiers: () => ({ SeriesNumber: 5, SeriesDescription: 'Synthetic CT', Modality: 'CT', InstanceNumber: undefined }),
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
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

const row = (outOfPlane, extra = {}) => ({
  measurementId: 'oop-1', _measurementServiceId: 'oop-1', toolType: 'Length', isVisible: true, isLocked: true, data: [{ displayText: '31.20 mm' }],
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2',
  outOfPlane: { view: 'Sagittal', viewName: 'sagittal', frameOfReferenceLoaded: true, inClassicViewport: false, ...outOfPlane },
  ...extra,
});
const render = (measurementData, onOpenInMpr = jest.fn()) => {
  act(() => root.render(<MeasurementTableItem itemIndex={12} onItemClick={() => {}} onOpenInMpr={onOpenInMpr} measurementData={measurementData} />));
  return onOpenInMpr;
};
const text = selector => [...container.querySelectorAll(selector)].map(node => node.textContent);

it('marks the index cell with a cube named "3D measurement", in the blue of the panel, not as a warning', () => {
  render(row({}));
  const item = container.querySelector('.tableListItem');
  expect(item.className).toContain('isOutOfPlane');
  expect(item.className).not.toContain('hasWarnings');
  expect(container.querySelector('.itemIndex .outOfPlaneIcon svg').getAttribute('aria-label')).toBe('3D measurement');
  expect(container.querySelector('.itemIndex .tableitem-index').textContent).toBe('12');
});

it('shows the view in place of the image on the detail line', () => {
  render(row({}));
  expect(text('.referenceMeta .refItem')).toEqual(['S:5', 'View:Sagittal', 'Modality:CT']);
  expect(container.querySelector('.refImgNum')).toBeNull();
});

it("notes the measurement's plane, view and series, in the warning note, on the index cell only", () => {
  render(row({ view: 'Oblique', viewName: 'oblique' }));
  // The card's trigger is the index cell, focusable; the rest of the row is not in it
  const trigger = container.querySelector('[data-hover-trigger]');
  expect(trigger.children).toHaveLength(1);
  expect(trigger.firstElementChild.className).toContain('itemIndex');
  expect(trigger.firstElementChild.getAttribute('tabindex')).toBe('0');
  expect(trigger.querySelector('.itemContent')).toBeNull();

  // The card places the warning note beside the cell
  const card = container.querySelector('.outOfPlaneNoteCard');
  expect(card.getAttribute('data-side')).toBe('left');
  const note = card.querySelector('.tooltip-warning.tooltip-outOfPlane');
  expect(note.querySelector('.warningTitle').textContent).toBe('3D measurement');
  expect(note.querySelector('.warningContent p').textContent).toBe('Drawn on oblique plane, shown in the MPR and 3D views.');
  expect(text('.tooltip-outOfPlane .outOfPlaneNoteItem')).toEqual(['View: Oblique', 'Series: 5 Synthetic CT']);
  expect(container.querySelector('[data-warning]')).toBeNull();
});

it('in the classic viewport, offers to open it in the MPR in the note, between the message and the details', () => {
  const measurementData = row({ inClassicViewport: true });
  const onOpenInMpr = render(measurementData);
  const content = [...container.querySelector('.tooltip-outOfPlane .warningContent').children]
    .map(node => node.className || node.tagName);
  expect(content).toEqual(['P', 'outOfPlaneNoteLink', 'outOfPlaneNoteItem', 'outOfPlaneNoteItem']);
  // A link, not a button
  const link = container.querySelector('.outOfPlaneNoteLink > a.outOfPlaneOpenMpr');
  expect(link.getAttribute('href')).toBe('#');
  expect(container.querySelector('.tooltip-outOfPlane button')).toBeNull();
  act(() => container.querySelector('.outOfPlaneOpenMpr').click());
  expect(onOpenInMpr).toHaveBeenCalledWith(expect.anything(), measurementData);
  // No line on the row itself
  expect(container.querySelector('.itemContent').textContent).not.toContain('Not shown in this viewport');
  expect(container.querySelector('.itemContent .outOfPlaneOpenMpr')).toBeNull();

  render(row({ inClassicViewport: false }));
  expect(container.querySelector('.outOfPlaneOpenMpr')).toBeNull();
});

it('without a recorded View, states no drawing plane, and keeps the navigation and the series', () => {
  const measurementData = row({ view: '', viewName: '', inClassicViewport: true });
  const onOpenInMpr = render(measurementData);
  expect(container.querySelector('.tooltip-outOfPlane .warningContent p').textContent).toBe('Shown in the MPR and 3D views.');
  expect(container.querySelector('.tooltip-outOfPlane').textContent).not.toMatch(/oblique|Drawn on/);
  expect(text('.tooltip-outOfPlane .outOfPlaneNoteItem')).toEqual(['Series: 5 Synthetic CT']);
  expect(text('.referenceMeta .refItem')).toEqual(['S:5', 'Modality:CT']);
  act(() => container.querySelector('.outOfPlaneOpenMpr').click());
  expect(onOpenInMpr).toHaveBeenCalledWith(expect.anything(), measurementData);
});

it('with points in no common plane, says it is shown in the 3D views only and that the MPR view centres on it', () => {
  const measurementData = row({ view: '', viewName: '', planar: false, inClassicViewport: true });
  const onOpenInMpr = render(measurementData);
  expect(container.querySelector('.tooltip-outOfPlane .warningContent p').textContent)
    .toBe('Its points lie in no common plane: shown in the 3D views only. Selecting it in an MPR view of its frame of reference centres the panes on it.');
  expect(container.querySelector('.tooltip-outOfPlane').textContent).not.toMatch(/MPR and 3D|Drawn on/);
  expect(text('.tooltip-outOfPlane .outOfPlaneNoteItem')).toEqual(['Series: 5 Synthetic CT']);
  act(() => container.querySelector('.outOfPlaneOpenMpr').click());
  expect(onOpenInMpr).toHaveBeenCalledWith(expect.anything(), measurementData);
});

it('with no loaded series of its Frame of Reference, keeps the marker, says so, and offers no navigation', () => {
  render(row({ frameOfReferenceLoaded: false, inClassicViewport: true }));
  expect(container.querySelector('.tableListItem').className).toContain('isOutOfPlane');
  expect(container.querySelector('.tooltip-outOfPlane .warningContent').textContent)
    .toBe("No loaded series shares this measurement's frame of reference.");
  expect(container.querySelector('.outOfPlaneOpenMpr')).toBeNull();
});

it('is locked once saved, as other saved measurements are', () => {
  render(row({}, { isLocked: true }));
  expect(container.querySelector('[data-cy="measurement-locked"]')).not.toBeNull();
  render(row({}, { isLocked: false }));
  expect(container.querySelector('[data-cy="measurement-locked"]')).toBeNull();
});
