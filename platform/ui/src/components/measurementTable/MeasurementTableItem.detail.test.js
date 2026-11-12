/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row's tool icon, reference line and measurement detail card: the icon of the tool that drew
// the measurement leads the value; the reference line is series, image, modality and the count of
// the card's further values; the card opens from the icon, the value and the reference line (mouse
// rest, focus, a tap on the icon), shows the measurement's values with what the viewport label
// draws, and lets a pending measurement change that. Not on a warning row.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The translations of the panel's namespace, with i18next's plural keys (count: _one, _other)
jest.mock('react-i18next', () => {
  const strings = jest.requireActual('../../../../i18n/src/locales/en-US/MeasurementTable.json');
  const t = (key, values = {}) => {
    const plural = 'count' in values ? strings[`${key}_${values.count === 1 ? 'one' : 'other'}`] : undefined;
    return (plural || key).replace(/{{(\w+)}}/g, (_, name) => values[name]);
  };
  return { useTranslation: () => ({ t }) };
});
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
  const React = require('react');
  const Open = React.createContext(false);
  return {
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    DataRowActions: ({ actions }) => <div data-row-actions={actions.length} />,
    Icons: { Hide: () => null, Show: () => null, Lock: props => <span data-icon="lock" {...props} /> },
    HoverCard: ({ children }) => children,
    HoverCardTrigger: ({ children }) => children,
    HoverCardPortal: ({ children }) => children,
    HoverCardContent: ({ children }) => children,
    // The card's popover: its content rendered in place while it is open
    Popover: ({ open, children }) => <Open.Provider value={open}>{children}</Open.Provider>,
    PopoverAnchor: ({ children }) => children,
    PopoverPortal: ({ children }) => children,
    PopoverContent: React.forwardRef(({ children, side, align, sideOffset, collisionPadding, avoidCollisions, onEscapeKeyDown,
      onInteractOutside, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
      const open = React.useContext(Open);
      return open ? <div ref={ref} data-side={side} data-align={align} {...props}>{children}</div> : null;
    }),
    Tooltip: ({ children }) => children,
    TooltipContent: ({ children, ...props }) => <div data-tooltip {...props}>{children}</div>,
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

const CIRCLE_STATS = { radius: 16.84, area: 890.81, perimeter: 105.81, mean: 412.6, stdDev: 58.31, max: 611 };
const circleRow = (extra = {}) => ({
  measurementId: 'c-1', _measurementServiceId: 'c-1', toolType: 'CircleRoi', isVisible: true, isPending: true, isReadOnly: false,
  data: [{ displayText: '16.84 mm' }], label: 'Cartilage / Lesion', location: 'Cartilage', description: 'Lesion',
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2', refSOPInstanceUID: '2.25.3',
  detailSource: { measurement: { data: { cachedStats: CIRCLE_STATS } }, context: { calibrated: true } },
  ...extra,
});
const lengthRow = (extra = {}) => ({
  ...circleRow(), measurementId: 'l-1', toolType: 'Length', data: [{ displayText: '20.40 mm' }], isPending: false, isReadOnly: true,
  isLocked: true, detailSource: { measurement: { length: 20.4, unit: 'mm' }, context: { calibrated: true } }, ...extra,
});

const render = (measurementData, props = {}) => {
  act(() => root.render(
    <MeasurementTableItem itemIndex={11} onItemClick={props.onItemClick || (() => {})} measurementData={measurementData} {...props} />));
};
const $ = selector => container.querySelector(selector);
const $$ = selector => [...container.querySelectorAll(selector)];
const card = () => $('[data-cy="measurement-detail-card"]');

const pointer = (node, type, pointerType = 'mouse') => {
  const event = new Event(type, { bubbles: type === 'pointerdown' });
  event.pointerType = pointerType;
  act(() => node.dispatchEvent(event));
};
// React listens for pointerenter / pointerleave through pointerover / pointerout
const hover = (node) => {
  const event = new MouseEvent('pointerover', { bubbles: true });
  event.pointerType = 'mouse';
  act(() => node.dispatchEvent(event));
};
const unhover = (node, to = document.body) => {
  const event = new MouseEvent('pointerout', { bubbles: true, relatedTarget: to });
  event.pointerType = 'mouse';
  act(() => node.dispatchEvent(event));
};
const advance = ms => act(() => jest.advanceTimersByTime(ms));


describe('the row', () => {
  it('leads the value with the icon of the tool that drew it, named after the tool', () => {
    render(circleRow());
    const icon = $('[data-cy="measurement-tool-icon"]');
    expect(icon.getAttribute('aria-label')).toBe('Circle');
    expect(icon.querySelector('[data-legacy-icon]').getAttribute('data-legacy-icon')).toBe('circle-radius');
    // Icon, then the value
    expect(icon.nextElementSibling.className).toBe('measurementDisplayText');
    expect(icon.nextElementSibling.textContent).toBe('16.84 mm');
  });

  it('puts the custom color dot between the icon and the value', () => {
    render(circleRow({ customColor: { line: '#348CFD', text: null } }));
    const classes = $$('.displayTexts > *').map(node => node.className);
    expect(classes).toEqual(['measurementToolIcon', 'measurementColorIndicator', 'measurementDisplayText']);
  });

  it('shows series, image and modality on the reference line, then the count of the further values', () => {
    render(circleRow());
    expect($$('.referenceMeta > *').map(node => node.textContent)).toEqual(['S:3', 'I:93', 'Modality:MR', '+6']);
    expect($('.refMore').getAttribute('aria-hidden')).toBe('true');
  });

  it('describes the tool icon with the count of the further values, named after the tool', () => {
    render(circleRow());
    const icon = $('[data-cy="measurement-tool-icon"]');
    expect(icon.getAttribute('aria-label')).toBe('Circle');
    const description = document.getElementById(icon.getAttribute('aria-describedby'));
    expect(description.textContent).toBe('6 more values');
    expect(description.className).toBe('visuallyHidden');
    // The pill stays hidden, so the count is announced once
    expect($('.refMore').getAttribute('aria-hidden')).toBe('true');
  });

  it('describes one further value in the singular, and none without a count', () => {
    // A Target: long axis primary, short axis the one further value
    render(circleRow({ toolType: 'Bidirectional', data: [{ displayText: '' }],
      detailSource: { measurement: { longestDiameter: 10, shortestDiameter: 5 }, context: { calibrated: true } } }));
    const icon = $('[data-cy="measurement-tool-icon"]');
    expect(document.getElementById(icon.getAttribute('aria-describedby')).textContent).toBe('1 more value');
    render(lengthRow());
    expect($('[data-cy="measurement-tool-icon"]').hasAttribute('aria-describedby')).toBe(false);
  });

  it('has no count for a tool with one value', () => {
    render(lengthRow());
    expect($('.refMore')).toBeNull();
    expect($('[data-cy="measurement-tool-icon"]').getAttribute('aria-label')).toBe('Length');
  });

  it('leads an ellipse with its area, or with its mean when the panel is set so', () => {
    const ellipse = {
      ...lengthRow(), toolType: 'EllipticalRoi', data: [{ displayText: '38.20 HU' }],
      detailSource: { measurement: { cachedStats: { area: 412.5, mean: 38.2, stdDev: 12.41, max: 71 } }, context: { calibrated: true } },
    };
    render(ellipse);
    expect($('.measurementDisplayText').textContent).toBe('412.50 mm²');
    expect($('.refMore').textContent).toBe('+3');
    render(ellipse, { regionLeadValue: 'mean' });
    // An MR mean has no unit
    expect($('.measurementDisplayText').textContent).toBe('38.20');
  });

  it('keeps the row controls: the visibility toggle and the lock', () => {
    render(lengthRow());
    expect($('[data-cy="measurement-visibility-toggle"]')).not.toBeNull();
    expect($('[data-icon="lock"]')).not.toBeNull();
  });
});


describe('the detail card', () => {
  it('opens after the pointer rests on the value for 300 ms, beside the row', () => {
    render(circleRow());
    hover($('.displayTexts'));
    advance(250);
    expect(card()).toBeNull();
    advance(100);
    expect(card()).not.toBeNull();
    expect($('[data-side]').getAttribute('data-side')).toBe('left');
    expect($('[data-side]').getAttribute('data-align')).toBe('start');
  });

  it('opens from the reference line too, and stays open moving between the trigger parts', () => {
    render(circleRow());
    hover($('.referenceMeta'));
    advance(300);
    expect(card()).not.toBeNull();
    unhover($('.referenceMeta'), $('.displayTexts'));
    hover($('.displayTexts'));
    advance(500);
    expect(card()).not.toBeNull();
    unhover($('.displayTexts'));
    advance(200);
    expect(card()).toBeNull();
  });

  it('does not open from the row controls or the label line', () => {
    render(circleRow());
    hover($('.measurementStatus'));
    hover($('.measurementLabel'));
    advance(500);
    expect(card()).toBeNull();
  });

  it('opens on focus of the tool icon and closes on Escape', () => {
    render(circleRow());
    const icon = $('[data-cy="measurement-tool-icon"]');
    expect(icon.getAttribute('tabindex')).toBe('0');
    act(() => icon.focus());
    expect(card()).not.toBeNull();
    act(() => icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(card()).toBeNull();
  });

  it('stays open while focus moves from the tool icon to the toggles, and closes when it leaves both', () => {
    render(circleRow());
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    act(() => $('[data-cy="measurement-detail-toggle-mean"]').focus());
    advance(500);
    expect(card()).not.toBeNull();
    act(() => $('[data-cy="measurement-detail-toggle-mean"]').blur());
    advance(200);
    expect(card()).toBeNull();
  });

  it('opens on a tap of the tool icon and closes on a second tap; the tap still selects the row', () => {
    const onItemClick = jest.fn();
    render(circleRow(), { onItemClick });
    const icon = $('[data-cy="measurement-tool-icon"]');
    pointer(icon, 'pointerdown', 'touch');
    act(() => icon.click());
    expect(card()).not.toBeNull();
    expect(onItemClick).toHaveBeenCalledTimes(1);
    pointer(icon, 'pointerdown', 'touch');
    act(() => icon.click());
    expect(card()).toBeNull();
  });

  it('opens on a whole tap (pointer down, focus, click) and closes on a second; the tap still selects the row', () => {
    const onItemClick = jest.fn();
    render(circleRow(), { onItemClick });
    const icon = $('[data-cy="measurement-tool-icon"]');
    const tap = (pointerType = 'touch') => {
      pointer(icon, 'pointerdown', pointerType);
      act(() => icon.focus());
      act(() => icon.click());
    };
    tap();
    expect(card()).not.toBeNull();
    expect(onItemClick).toHaveBeenCalledTimes(1);
    tap();
    expect(card()).toBeNull();
    expect(onItemClick).toHaveBeenCalledTimes(2);
    // A pen behaves as a finger
    act(() => icon.blur());
    tap('pen');
    expect(card()).not.toBeNull();
    tap('pen');
    expect(card()).toBeNull();
  });

  it('opens on keyboard focus of the tool icon after an earlier tap', () => {
    render(circleRow());
    const icon = $('[data-cy="measurement-tool-icon"]');
    pointer(icon, 'pointerdown', 'touch');
    advance(2000);
    act(() => icon.focus());
    expect(card()).not.toBeNull();
  });

  it('opens and closes on Enter and Space on the tool icon', () => {
    render(circleRow());
    const icon = $('[data-cy="measurement-tool-icon"]');
    const key = name => act(() => icon.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })));
    act(() => icon.focus());
    key('Escape');
    expect(card()).toBeNull();
    key('Enter');
    expect(card()).not.toBeNull();
    key(' ');
    expect(card()).toBeNull();
    key(' ');
    expect(card()).not.toBeNull();
  });

  it('names the image by its Instance Number, not as a position in the series', () => {
    jest.requireMock('@ohif/core').default.utils.referenceIdentifiers = () => ({
      SeriesNumber: 3, SeriesDescription: 'PD TSE Sag', Modality: 'MR', InstanceNumber: 981,
    });
    try {
      render(circleRow());
      act(() => $('[data-cy="measurement-tool-icon"]').focus());
      expect($$('.detailRef').map(node => node.textContent).slice(0, 2)).toEqual(['Series3 · PD TSE Sag · 160 images', 'Image981']);
    } finally {
      jest.requireMock('@ohif/core').default.utils.referenceIdentifiers = () => ({
        SeriesNumber: 3, SeriesDescription: 'PD TSE Sag', Modality: 'MR', InstanceNumber: 93,
      });
    }
  });

  it('does not open on a tap of the value', () => {
    render(circleRow());
    const value = $('.measurementDisplayText');
    pointer(value, 'pointerdown', 'touch');
    act(() => value.click());
    advance(500);
    expect(card()).toBeNull();
  });

  it("shows the tool, the row number, the state, the value and every value with what the viewport label draws", () => {
    render(circleRow());
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($('.detailName').textContent).toBe('Circle');
    expect($('.detailDescriptor').textContent).toBe('Radius');
    expect($$('.detailChip').map(node => node.textContent)).toEqual(['#11', 'Pending']);
    expect($('[data-cy="measurement-detail-primary"]').textContent).toBe('16.84mm');
    expect($$('.detailSectionHeader').map(node => node.firstChild.textContent)).toEqual(['Geometry', 'Pixel values', 'Reference', 'Meta']);
    expect($$('.detailValue').map(node => [node.children[0].textContent, node.children[1].textContent])).toEqual([
      ['Radius', '16.84 mm'], ['Diameter', '33.68 mm'], ['Area', '890.81 mm²'], ['Perimeter', '105.81 mm'],
      ['Mean', '412.60'], ['Std dev', '58.31'], ['Max', '611.00'],
    ]);
    expect($$('.detailRef').map(node => node.textContent)).toEqual([
      'Series3 · PD TSE Sag · 160 images', 'Image93', 'ModalityMR', 'LocationCartilage', 'DescriptionLesion',
    ]);
  });

  it("toggles the values a pending measurement's viewport label draws, keeping at least one", () => {
    const onViewportValuesChange = jest.fn();
    render(circleRow(), { onViewportValuesChange });
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    const toggle = key => $(`[data-cy="measurement-detail-toggle-${key}"]`);
    expect(toggle('radius').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('mean').getAttribute('aria-pressed')).toBe('false');
    expect(toggle('mean').getAttribute('aria-label')).toBe('Show Mean in viewport');

    act(() => toggle('mean').click());
    expect(onViewportValuesChange).toHaveBeenLastCalledWith(expect.objectContaining({ measurementId: 'c-1' }), ['radius', 'area', 'mean']);
    act(() => toggle('area').click());
    expect(onViewportValuesChange).toHaveBeenLastCalledWith(expect.anything(), ['radius']);
  });

  it('cannot turn off the last value shown, and disables the toggles of a hidden measurement', () => {
    const measurement = { data: { cachedStats: CIRCLE_STATS, viewportValues: ['radius'] } };
    render(circleRow({ detailSource: { measurement, context: {} } }));
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($('[data-cy="measurement-detail-toggle-radius"]').disabled).toBe(true);
    expect($('[data-cy="measurement-detail-toggle-area"]').disabled).toBe(false);

    render(circleRow({ isVisible: false }));
    expect($('[data-cy="measurement-detail-toggle-area"]').disabled).toBe(true);
  });

  it('marks the values a saved measurement shows, without toggles', () => {
    render(circleRow({ isPending: false, isReadOnly: true }));
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($$('[data-cy^="measurement-detail-toggle-"]')).toEqual([]);
    expect($$('.detailPin')).toHaveLength(2);
    expect($$('.detailChip').map(node => node.textContent)).toEqual(['#11', 'Saved']);
  });

  it('shows a measurement with one value without value sections', () => {
    render(lengthRow());
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($$('.detailSectionHeader').map(node => node.firstChild.textContent)).toEqual(['Reference', 'Meta']);
  });

  it('lists only the meta attributes that are set, and leaves the section out when none is', () => {
    render(lengthRow({ description: '' }));
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($$('.detailRef').map(node => node.textContent).filter(text => /^(Location|Description)/.test(text)))
      .toEqual(['LocationCartilage']);

    render(lengthRow({ location: undefined, description: '  ' }));
    expect($$('.detailSectionHeader').map(node => node.firstChild.textContent)).toEqual(['Reference']);
    expect(card().textContent).not.toContain('Not set');
  });

  it('shows the custom colors last, by name', () => {
    render(circleRow({ customColor: { line: '#348CFD', text: '#AABBCC' } }));
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect($$('.detailSectionHeader').map(node => node.firstChild.textContent).pop()).toBe('Appearance');
    expect($$('.detailRef').slice(-2).map(node => node.textContent)).toEqual(['LinePrimary', 'Text#AABBCC']);
  });

  it('is not offered on a row with a warning', () => {
    render(circleRow({ hasWarnings: true, warningTitle: 'Tool partially supported', warningList: [] }));
    hover($('.displayTexts'));
    advance(500);
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
    expect(card()).toBeNull();
    expect($('[data-cy="measurement-tool-icon"]').getAttribute('tabindex')).toBeNull();
  });
});
