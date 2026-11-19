/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// A landmark set's card: one card for the named landmarks and the set's details, beside its row. It
// opens after the pointer rests 300 ms on the row's value, reference or label line, on keyboard focus
// of the set icon (Enter or Space toggles it, Tab moves into the list, Shift+Tab back) and on a click
// on the row, which also selects the row once; it closes 150 ms after the pointer leaves the row and
// the card, and on Escape. An entry chooses its own landmark without selecting the row. A held set's
// entries are text, and its card gives no stepping guidance.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values = {}) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { MeasurementApi: { Instance: { toggleVisibilityMeasurement: () => {} } }, refreshCornerstoneViewports: () => {} },
    DICOMSR: { landmarks: { setLandmarkSetVisible: () => {}, clearCurrentLandmark: () => {} } },
    DicomMetadataStore: { getSeries: () => ({ instances: new Array(120) }) },
    displayAttributes: {
      ANNOTATION_PALETTE: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Success', hex: '#58BC82' }],
      normalizeHexColor: value => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null),
    },
    utils: {
      referenceIdentifiers: (store, { SeriesInstanceUID }) => (SeriesInstanceUID === '2.25.2'
        ? { SeriesNumber: 2, SeriesDescription: 'Synthetic pelvis, series P', Modality: 'MR' } : null),
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
    HoverCardContent: () => null,
    // The card's popover: its content rendered in place while it is open
    Popover: ({ open, children }) => <Open.Provider value={open}>{children}</Open.Provider>,
    PopoverAnchor: ({ children }) => children,
    PopoverPortal: ({ children }) => children,
    PopoverContent: React.forwardRef(({ children, side, align, sideOffset, collisionPadding, avoidCollisions, onEscapeKeyDown,
      onInteractOutside, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
      const open = React.useContext(Open);
      const inner = React.useRef(null);
      // As the popover dismisses: a press outside its content calls onInteractOutside, which may prevent it
      React.useEffect(() => {
        if (!open) {
          return undefined;
        }
        const onDown = (event) => {
          if (inner.current && inner.current.contains(event.target)) {
            return;
          }
          let prevented = false;
          onInteractOutside({ target: event.target, preventDefault: () => { prevented = true; } });
          return prevented;
        };
        const doc = global.document;
        doc.addEventListener('pointerdown', onDown, true);
        return () => doc.removeEventListener('pointerdown', onDown, true);
      }, [open]);
      return open ? (
        <div ref={(node) => { inner.current = node; if (typeof ref === 'function') { ref(node); } else if (ref) { ref.current = node; } }} data-side={side} {...props}
          onKeyDown={(event) => { if (event.key === 'Escape') { onEscapeKeyDown(event); } else if (props.onKeyDown) { props.onKeyDown(event); } }}>
          {children}
        </div>
      ) : null;
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

const landmark = (index, name, extra = {}) => ({
  index, ordinal: index + 1, name, detail: '', shape: 'Point', typeText: 'Point', line: '#00C0FF', text: '#FFFFFF',
  own: { Line: null, Text: null }, ...extra,
});
// The fixture set of the boards: ten landmarks, eight named, two of them "Tear drop"
const FIXTURE_LANDMARKS = [
  landmark(0, 'Left anterior superior iliac spine', {
    shape: 'Anatomic', typeText: 'Anatomic', line: '#FF0000', detail: 'ASIS (left) · Every attribute set', own: { Line: '#FF0000', Text: '#58BC82' },
  }),
  landmark(1, 'Label only'),
  landmark(2, 'Pubic symphysis'),
  landmark(3, 'Left anterior superior iliac spine', { detail: 'Concept and label' }),
  landmark(4, null),
  landmark(5, 'Line override', { line: '#FF8000', own: { Line: '#FF8000', Text: null } }),
  landmark(6, 'Épine iliaque antérieure'),
  landmark(7, 'Tear drop'),
  landmark(8, 'Tear drop'),
  landmark(9, null, { shape: 'Registration', typeText: 'Registration' }),
];
const row = (landmarkSet = {}, extra = {}) => ({
  measurementId: 'doc::set', toolType: 'SonadorLandmarkSet', isVisible: true, isReadOnly: true, isLocked: true, isPending: false,
  data: [{ displayText: 'Pelvic landmarks' }], label: 'Pelvis (planning) / Points picked',
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2', fromApplicationDocument: true,
  landmarkSet: {
    key: 'doc::set', name: 'Pelvic landmarks', count: 10, namedCount: 8, domain: 'patient', documentKind: 'application', placed: true,
    colors: { line: '#00C0FF', text: '#FFFFFF' },
    landmarks: FIXTURE_LANDMARKS, position: null,
    concept: { meaning: 'Pelvic landmarks', value: 'PELVIS-SET', scheme: '99EXAMPLE' }, label: 'Pelvis (planning)',
    description: 'Points picked on the planning model', frame: 'Imaging frame of series 2',
    types: [{ text: 'Point', shape: 'Point', count: 8 }, { text: 'Anatomic', shape: 'Anatomic', count: 1 }, { text: 'Registration', shape: 'Registration', count: 1 }],
    appearance: { line: '#00C0FF', text: '#FFFFFF', overrides: [{ ordinal: 1, line: '#FF0000', text: '#58BC82' }, { ordinal: 6, line: '#FF8000', text: null }] },
    ...landmarkSet,
  },
  ...extra,
});

const onItemClick = jest.fn();
const onLandmarkClick = jest.fn();
beforeEach(() => {
  onItemClick.mockClear();
  onLandmarkClick.mockClear();
});
const render = (measurementData, props = {}) => act(() => root.render(
  <MeasurementTableItem itemIndex={1} onItemClick={onItemClick} onLandmarkClick={onLandmarkClick} measurementData={measurementData} {...props} />));
const $ = selector => document.body.querySelector(selector);
const $$ = selector => [...document.body.querySelectorAll(selector)];
const card = () => $('[data-cy="landmark-set-card"]');
const section = cy => $(`[data-cy="landmark-set-card-${cy}"]`);
const rowsOf = node => [...node.querySelectorAll('.detailRef')].map(line => [line.children[0].textContent, line.children[1].textContent]);
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
const key = (node, name, init = {}) => act(() => node.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init })));
const click = node => act(() => node.click());


describe('opening and closing', () => {
  it.each([
    ['value line', '.displayTexts'],
    ['reference line', '.referenceMeta'],
    ['label line', '.measurementLabel'],
  ])('opens after the pointer rests 300 ms on the %s', (_, selector) => {
    render(row());
    hover($(selector));
    advance(299);
    expect(card()).toBeNull();
    advance(1);
    expect(card()).not.toBeNull();
  });

  it('stays open while the pointer moves onto the card and closes 150 ms after it leaves both', () => {
    render(row());
    hover($('.displayTexts'));
    advance(300);
    unhover($('.displayTexts'), card());
    hover(card());
    advance(500);
    expect(card()).not.toBeNull();
    unhover(card());
    advance(149);
    expect(card()).not.toBeNull();
    advance(1);
    expect(card()).toBeNull();
  });

  it('stays open while the pointer is anywhere over its row: from the reference line onto the current landmark line', () => {
    render(row({ position: 2 }));
    hover($('.referenceMeta'));
    advance(300);
    unhover($('.referenceMeta'), $('[data-cy="landmark-set-current"]'));
    hover($('[data-cy="landmark-set-current"]'));
    advance(500);
    expect(card()).not.toBeNull();
    // Leaving the row and the card: closed 150 ms later
    unhover($('.measurementDetailAnchor'));
    advance(150);
    expect(card()).toBeNull();
  });

  it('opens on keyboard focus of the set icon; Enter and Space toggle it; Escape closes it', () => {
    render(row());
    const icon = $('[data-cy="measurement-tool-icon"]');
    act(() => icon.focus());
    expect(card()).not.toBeNull();
    key(icon, 'Enter');
    expect(card()).toBeNull();
    key(icon, ' ');
    expect(card()).not.toBeNull();
    key(icon, 'Escape');
    expect(card()).toBeNull();
  });

  it('Tab from the set icon moves into the list, Shift+Tab from the first entry returns to the icon, and Escape returns focus there', () => {
    render(row());
    const icon = $('[data-cy="measurement-tool-icon"]');
    act(() => icon.focus());
    key(icon, 'Tab');
    const [first] = $$('[data-cy="landmark-entry"]');
    expect(document.activeElement).toBe(first);
    key(first, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(icon);
    key(icon, 'Tab');
    key(document.activeElement, 'Escape');
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it('a click on the row opens the card and selects the row once; two clicks with the card open select it twice', () => {
    render(row());
    click($('.displayTexts'));
    expect(card()).not.toBeNull();
    expect(onItemClick).toHaveBeenCalledTimes(1);
    click($('.displayTexts'));
    expect(card()).not.toBeNull();
    expect(onItemClick).toHaveBeenCalledTimes(2);
  });

  it('stays open, without closing and reopening, while the row is selected again and again', () => {
    render(row());
    const states = [];
    const press = (node) => {
      const down = new Event('pointerdown', { bubbles: true });
      down.pointerType = 'mouse';
      act(() => node.dispatchEvent(down));
      states.push(Boolean(card()));
      click(node);
      states.push(Boolean(card()));
    };
    press($('.displayTexts'));
    press($('.referenceMeta'));
    press($('.displayTexts'));
    // Open from the first click on, never closed between
    expect(states).toEqual([false, true, true, true, true, true]);
    expect(onItemClick).toHaveBeenCalledTimes(3);
    // A press outside the row and the card closes it (control)
    const down = new Event('pointerdown', { bubbles: true });
    act(() => document.body.dispatchEvent(down));
    expect(card()).toBeNull();
  });

  it('a click on an entry or on the visibility toggle does not select the row', () => {
    render(row());
    click($('.displayTexts'));
    onItemClick.mockClear();
    click($$('[data-cy="landmark-entry"]')[0]);
    click($('[data-cy="measurement-visibility-toggle"]'));
    expect(onItemClick).not.toHaveBeenCalled();
  });
});


describe('the card of a placed set', () => {
  const open = (measurementData = row()) => {
    render(measurementData);
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
  };

  it('has the header: tile, the whole name, the count, the row number and Saved with the lock, its hover saying where the set comes from', () => {
    open();
    expect($('.detailName').textContent).toBe('Pelvic landmarks');
    expect($('.detailDescriptor').textContent).toBe('10 landmarks');
    expect($('[data-cy="landmark-set-card-saved"] [data-icon="lock"]')).not.toBeNull();
    expect($('[data-cy="landmark-set-card-saved"]').textContent).toBe('SavedRead-only: from an application document');
    const hover = $('[data-cy="landmark-set-card-application-document"]');
    expect(hover.querySelector('.measurementDocumentIcon')).not.toBeNull();
    expect(hover.textContent).toBe('Read-only: from an application document');

    open(row({ documentKind: 'exchange' }, { fromApplicationDocument: false }));
    expect($$('.detailChip').map(chip => chip.textContent)).toEqual(['#1', 'Saved']);
    expect($('[data-cy="landmark-set-card-application-document"]')).toBeNull();
  });

  it('lists the named landmarks in set order, each a link, under "8 named of 10", with the unnamed count and the stepping guidance', () => {
    open();
    expect($('[data-cy="landmark-set-card-landmarks"] .detailSectionHeader span').textContent).toBe('8 of 10');
    const entries = $$('[data-cy="landmark-entry"]');
    expect(entries.map(entry => entry.querySelector('.landmarkEntryOrdinal').textContent)).toEqual(['1', '2', '3', '4', '6', '7', '8', '9']);
    expect(entries.every(entry => entry.tagName === 'BUTTON')).toBe(true);
    expect(entries[0].querySelector('.landmarkEntryDetail').textContent).toBe('ASIS (left) · Every attribute set');
    expect(entries[0].querySelector('[data-shape="Anatomic"] g').getAttribute('stroke')).toBe('#FF0000');
    expect($('[data-cy="landmark-entries-footer"]').textContent).toBe('2 landmarks have no name. Select the row to step through all 10.');
  });

  it('shows eight entries, two-line ones included; nine scroll', () => {
    // Entries as laid out: 44 px with a second line, 28 px without
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() { return this.classList.contains('landmarkEntry') ? (this.querySelector('.landmarkEntryDetail') ? 44 : 28) : 0; },
    });
    const described = FIXTURE_LANDMARKS.slice(0, 9).map((entry, index) => ({ ...entry, name: entry.name || `Point ${index}`, detail: `Description ${index}` }));
    open(row({ landmarks: described, count: 9 }));
    expect($('[data-cy="landmark-entries"]').style.maxHeight).toBe(`${8 * 44}px`);
    open(row({ landmarks: described.slice(0, 8), count: 8 }));
    expect($('[data-cy="landmark-entries"]').style.maxHeight).toBe('');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);

    open();
    expect($('[data-cy="landmark-entries"]').classList.contains('isScrolling')).toBe(false);
    open(row({ landmarks: [...FIXTURE_LANDMARKS.slice(0, 9).map((entry, index) => ({ ...entry, name: entry.name || `Point ${index}` }))], count: 9 }));
    expect($$('[data-cy="landmark-entry"]')).toHaveLength(9);
    expect($('[data-cy="landmark-entries"]').classList.contains('isScrolling')).toBe(true);
  });

  it('marks own colours: one colour for Line, split for Line and Text, the left half empty for Text only', () => {
    const textOnly = landmark(1, 'Text only', { own: { Line: null, Text: '#FFFFFF' } });
    open(row({ landmarks: [FIXTURE_LANDMARKS[0], textOnly, FIXTURE_LANDMARKS[5]], count: 3, namedCount: 3 }));
    const dots = $$('[data-cy="landmark-entries"] [data-cy="landmark-own-color"]');
    expect(dots).toHaveLength(3);
    expect(dots.map(dot => dot.dataset.roles)).toEqual(['Line Text', 'Text', 'Line']);
    expect(dots[1].classList.contains('isTextOnly')).toBe(true);
    expect(dots[2].style.background).toBe('rgb(255, 128, 0)');
    // The name is never tinted
    expect($$('.landmarkEntryText').every(name => !name.getAttribute('style'))).toBe(true);
  });

  it('keeps the stepping guidance when every landmark has a name', () => {
    const named = FIXTURE_LANDMARKS.filter(entry => entry.name);
    open(row({ landmarks: named, count: named.length, namedCount: named.length }));
    expect($('[data-cy="landmark-entries-footer"]').textContent).toBe('Select the row to step through all 8.');
  });

  it('keeps the current landmark in view: the list scrolls to it as it changes', () => {
    // Laid out as the browser would: 28 px entries in a list that shows eight
    const restore = ['getBoundingClientRect', 'offsetHeight', 'clientHeight'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) || Object.getOwnPropertyDescriptor(Element.prototype, name)]);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('landmarkEntry') ? 28 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('landmarkEntries') ? 8 * 28 : 0; } });
    HTMLElement.prototype.getBoundingClientRect = function rect() {
      const list = this.closest('.landmarkEntries');
      if (this.classList.contains('landmarkEntry') && list) {
        const top = [...list.children].indexOf(this) * 28 - list.scrollTop;
        return { top, bottom: top + 28 };
      }
      return { top: 0, bottom: 0 };
    };
    const many = Array.from({ length: 12 }, (_, index) => landmark(index, `Point ${index + 1}`));
    open(row({ landmarks: many, count: 12, namedCount: 12, position: 0 }));
    const list = $('[data-cy="landmark-entries"]');
    expect(list.scrollTop).toBe(0);
    // The eleventh is below the visible eight: the list scrolls just far enough to show it
    open(row({ landmarks: many, count: 12, namedCount: 12, position: 10 }));
    expect(list.scrollTop).toBe(11 * 28 - 8 * 28);
    // Back to the first, above the visible part
    open(row({ landmarks: many, count: 12, namedCount: 12, position: 0 }));
    expect(list.scrollTop).toBe(0);
    restore.forEach(([name, descriptor]) => {
      if (descriptor) {
        Object.defineProperty(name === 'getBoundingClientRect' ? Element.prototype : HTMLElement.prototype, name, descriptor);
      }
      if (name === 'getBoundingClientRect') {
        delete HTMLElement.prototype.getBoundingClientRect;
      }
    });
  });

  it('highlights the current landmark', () => {
    open(row({ position: 7 }));
    const current = $$('[data-cy="landmark-entry"]').filter(entry => entry.classList.contains('isCurrent'));
    expect(current.map(entry => entry.querySelector('.landmarkEntryOrdinal').textContent)).toEqual(['8']);
  });

  it('chooses each entry\'s own landmark: of two "Tear drop" entries, each its numbered one', () => {
    open();
    const tearDrops = $$('[data-cy="landmark-entry"]').filter(entry => entry.querySelector('.landmarkEntryText').textContent === 'Tear drop');
    click(tearDrops[0]);
    click(tearDrops[1]);
    expect(onLandmarkClick.mock.calls.map(([, , index]) => index)).toEqual([7, 8]);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('gives Meta (Category and Label), Reference (Series, Frame, Landmarks by type, Document) and Appearance', () => {
    open();
    expect(rowsOf(section('meta')).map(([label, value]) => [label.startsWith('Category') ? 'Category' : label, value])).toEqual([
      ['Category', 'Pelvic landmarks · PELVIS-SET, 99EXAMPLE'], ['Label', 'Pelvis (planning)'],
    ]);
    // Category names the row; its hover gives what it is, in the document's terms
    expect($('[data-cy="landmark-set-card-category"]').textContent).toBe('Category');
    expect($('[data-cy="landmark-set-card-category-help"]').textContent).toBe('Coded concept describing the type of landmark.');
    // Above the card it sits in
    expect($('[data-cy="landmark-set-card-category-help"]').classList.contains('landmarkCardTooltip')).toBe(true);
    expect(rowsOf(section('reference'))).toEqual([
      ['Series', '2 · Synthetic pelvis, series P · 120 images'],
      ['Frame', 'Imaging frame of series 2'],
      ['Landmarks', '108 Point1 Anatomic1 Registration'],
      ['Document', 'Application document'],
    ]);
    expect(rowsOf(section('appearance')).map(([label]) => label)).toEqual(['Line', 'Text', 'Overrides']);
    expect(rowsOf(section('appearance'))[0][1]).toBe('#00C0FF');
    expect(rowsOf(section('appearance'))[1][1]).toBe('White');
    expect($$('[data-cy="landmark-set-card-override"]').map(entry => entry.textContent)).toEqual(['1', '6']);
  });

  it('leaves out Meta and Appearance when nothing sets them, and Landmarks with no named landmark, with a note on how they are reached', () => {
    open(row({
      landmarks: FIXTURE_LANDMARKS.slice(0, 3).map(entry => ({ ...entry, name: null, own: { Line: null, Text: null } })),
      count: 3, namedCount: 0, concept: null, label: null, appearance: null,
    }));
    expect(section('landmarks')).toBeNull();
    expect(section('meta')).toBeNull();
    expect(section('appearance')).toBeNull();
    expect($('[data-cy="landmark-set-card-step-note"]').textContent).toBe('No landmark has a name. Select the row to step through all 3.');
  });

  it('shows the stored Label under Meta for a set with a label and no concept, although the header shows the same text', () => {
    open(row({ name: 'Navigation points', concept: null, label: 'Navigation points' }));
    expect($('.detailName').textContent).toBe('Navigation points');
    expect(rowsOf(section('meta'))).toEqual([['Label', 'Navigation points']]);
  });

  it('breaks the landmarks down by type, a type outside the three under its own text', () => {
    open(row({ types: [{ text: 'Point', shape: 'Point', count: 1 }, { text: 'Tracker origin', shape: 'Point', count: 1 }] }));
    expect($('[data-cy="landmark-set-card-types"]').textContent).toBe('1 Point1 Tracker origin');
  });
});


describe('the card of a held set', () => {
  const NOTE = "No loaded series shares this measurement's frame of reference.";
  const held = (extra = {}) => row({ placed: false, note: NOTE, frame: undefined, ...extra }, { refSeriesInstanceUID: undefined });
  const open = (measurementData) => {
    render(measurementData);
    act(() => $('[data-cy="measurement-tool-icon"]').focus());
  };

  it('lists its named landmarks as text, gives the unnamed count with no instruction to step, and repeats its note under Reference', () => {
    open(held());
    const entries = $$('[data-cy="landmark-entry"]');
    expect(entries).toHaveLength(8);
    expect(entries.some(entry => entry.tagName === 'BUTTON')).toBe(false);
    expect($('[data-cy="landmark-entries-footer"]').textContent).toBe('2 landmarks have no name.');
    expect(rowsOf(section('reference'))[0]).toEqual(['Series', 'Unknown']);
    expect(rowsOf(section('reference')).map(([label]) => label)).not.toContain('Frame');
    expect($('[data-cy="landmark-set-card-held-note"]').textContent).toBe(NOTE);
    expect(card().textContent).not.toContain('Select the row');
  });

  it('with no named landmark: no Landmarks section, the unnamed count, the held note and no stepping guidance', () => {
    open(held({ landmarks: FIXTURE_LANDMARKS.slice(0, 3).map(entry => ({ ...entry, name: null })), count: 3, namedCount: 0 }));
    expect(section('landmarks')).toBeNull();
    expect($('[data-cy="landmark-set-card-unnamed"]').textContent).toBe('3 landmarks have no name.');
    expect($('[data-cy="landmark-set-card-step-note"]')).toBeNull();
    expect($('[data-cy="landmark-set-card-held-note"]').textContent).toBe(NOTE);
    expect(card().textContent).not.toContain('Select the row');
  });

  it('gains its links and its stepping guidance once a matching series is loaded', () => {
    open(held());
    expect($$('[data-cy="landmark-entry"]').some(entry => entry.tagName === 'BUTTON')).toBe(false);
    open(row());
    expect($$('[data-cy="landmark-entry"]').every(entry => entry.tagName === 'BUTTON')).toBe(true);
    expect($('[data-cy="landmark-entries-footer"]').textContent).toContain('Select the row to step through all 10.');
  });
});
