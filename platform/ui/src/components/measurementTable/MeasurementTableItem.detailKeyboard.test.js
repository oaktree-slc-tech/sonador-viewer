/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The detail card with the real Radix popover, portalled to the end of the body: the keyboard
// path from the tool icon into the card's controls and on past it, and Escape from inside the card.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values = {}) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  displayAttributes: { ANNOTATION_PALETTE: [{ name: 'Primary', hex: '#348CFD' }] },
  default: {
    measurements: { MeasurementApi: { Instance: {} }, refreshCornerstoneViewports: () => {} },
    DicomMetadataStore: { getSeries: () => ({ instances: new Array(160) }) },
    utils: {
      referenceIdentifiers: () => ({ SeriesNumber: 3, SeriesDescription: 'PD TSE Sag', Modality: 'MR', InstanceNumber: 93 }),
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui-next', () => {
  const PopoverPrimitive = jest.requireActual('@radix-ui/react-popover');
  return {
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    DataRowActions: ({ actions }) => <div data-row-actions={actions.length} />,
    Icons: { Hide: () => null, Show: () => null, Lock: props => <span data-icon="lock" {...props} /> },
    HoverCard: ({ children }) => children,
    HoverCardTrigger: ({ children }) => children,
    HoverCardPortal: ({ children }) => children,
    HoverCardContent: ({ children }) => children,
    Popover: PopoverPrimitive.Root,
    PopoverAnchor: PopoverPrimitive.Anchor,
    PopoverPortal: PopoverPrimitive.Portal,
    PopoverContent: PopoverPrimitive.Content,
    Tooltip: ({ children }) => children,
    TooltipContent: () => null,
    TooltipProvider: ({ children }) => children,
    TooltipTrigger: ({ children }) => children,
  };
}, { virtual: true });
jest.mock('./metadataEventConcerns', () => ({ subscribeSeriesMetadata: () => () => {} }));
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children }) => <div data-warning>{children}</div> }));
jest.mock('../tooltip', () => ({ Tooltip: ({ children, className }) => <div className={className}>{children}</div> }));
jest.mock('./../../elements/Icon', () => ({ Icon: ({ name, ...props }) => <span data-legacy-icon={name} {...props} /> }));

import { MeasurementTableItem } from './MeasurementTableItem';

global.IS_REACT_ACT_ENVIRONMENT = true;
// Radix measures the anchor and the content
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

let container;
let root;
beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const circleRow = () => ({
  measurementId: 'c-1', _measurementServiceId: 'c-1', toolType: 'CircleRoi', isVisible: true, isPending: true, isReadOnly: false,
  data: [{ displayText: '16.84 mm' }], label: 'Cartilage / Lesion', location: 'Cartilage', description: 'Lesion',
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2', refSOPInstanceUID: '2.25.3',
  detailSource: {
    measurement: { data: { cachedStats: { radius: 16.84, area: 890.81, perimeter: 105.81, mean: 412.6, stdDev: 58.31, max: 611 } } },
    context: { calibrated: true },
  },
});

const render = () => act(() => root.render(<MeasurementTableItem itemIndex={11} onItemClick={() => {}} measurementData={circleRow()} />));
const icon = () => container.querySelector('[data-cy="measurement-tool-icon"]');
const card = () => document.querySelector('[data-cy="measurement-detail-card"]');
const controls = () => [...card().querySelectorAll('button:not([disabled])')];
const key = (node, name, init = {}) => act(() => {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
});
const advance = ms => act(() => jest.advanceTimersByTime(ms));

it('is portalled after the row, outside the row\'s container', () => {
  render();
  act(() => icon().focus());
  expect(card()).not.toBeNull();
  expect(container.contains(card())).toBe(false);
});

it('is entered with Tab from the tool icon, left with Shift+Tab back to it, and stays open meanwhile', () => {
  render();
  act(() => icon().focus());
  key(icon(), 'Tab');
  const [first] = controls();
  expect(document.activeElement).toBe(first);
  advance(500);
  expect(card()).not.toBeNull();

  // Its controls work from the keyboard
  first.click();
  expect(card()).not.toBeNull();

  key(first, 'Tab', { shiftKey: true });
  expect(document.activeElement).toBe(icon());
  advance(500);
  expect(card()).not.toBeNull();
});

it('continues past the icon after the last control, and closes', () => {
  render();
  act(() => icon().focus());
  key(icon(), 'Tab');
  const last = controls()[controls().length - 1];
  act(() => last.focus());
  key(last, 'Tab');
  expect(card()).toBeNull();
  // The next control of the row: its visibility toggle
  expect(document.activeElement).toBe(container.querySelector('[data-cy="measurement-visibility-toggle"]'));
});

it('closes on Escape in the card, returning focus to the icon without reopening, and reopens on Enter', () => {
  render();
  act(() => icon().focus());
  key(icon(), 'Tab');
  key(document.activeElement, 'Escape');
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(icon());
  advance(500);
  expect(card()).toBeNull();

  key(icon(), 'Enter');
  expect(card()).not.toBeNull();
  key(icon(), 'Escape');
  expect(card()).toBeNull();
  key(icon(), ' ');
  expect(card()).not.toBeNull();
});

it('opens on a whole tap of the icon, and closes on a tap outside', () => {
  render();
  const pointerdown = (node) => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    act(() => node.dispatchEvent(event));
  };
  pointerdown(icon());
  act(() => icon().focus());
  act(() => icon().click());
  expect(card()).not.toBeNull();
  // Radix listens for outside presses once the layer has mounted; a touch press is taken at its click
  advance(10);
  pointerdown(document.body);
  act(() => document.body.click());
  expect(card()).toBeNull();
});
