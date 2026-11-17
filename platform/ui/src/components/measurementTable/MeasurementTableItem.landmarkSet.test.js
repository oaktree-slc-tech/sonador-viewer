/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The row of a landmark set (one row per set, read-only): the set icon, its swatch and its name; the
// reference line with the series, the image of an image-domain set, the modality and the count pill,
// which gives the current landmark's position while the set holds it, with a line under the row
// naming that landmark (its type alone when it has none); the set's own visibility toggle; the lock
// or the document glyph. A held set has the blue index cell with its note, a "Not shown" chip in
// place of the modality and no toggle. The index cell of a placed set steps from the keyboard.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
const mockSetVisible = jest.fn();
const mockClearCurrent = jest.fn();
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { MeasurementApi: { Instance: { toggleVisibilityMeasurement: () => {} } }, refreshCornerstoneViewports: () => {} },
    DICOMSR: { landmarks: { setLandmarkSetVisible: (...args) => mockSetVisible(...args), clearCurrentLandmark: () => mockClearCurrent() } },
    DicomMetadataStore: { getSeries: () => ({ instances: new Array(120) }) },
    utils: {
      // The study's series 2.25.2 is loaded; any other is not. Its image 2.25.2.41 is instance 41.
      referenceIdentifiers: (store, { SeriesInstanceUID, SOPInstanceUID }) => (SeriesInstanceUID === '2.25.2'
        ? { SeriesNumber: 2, SeriesDescription: 'Synthetic pelvis', Modality: 'MR', InstanceNumber: SOPInstanceUID === '2.25.2.41' ? 41 : undefined }
        : null),
    },
  },
}), { virtual: true });
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
  DataRowActions: ({ actions }) => <div data-row-actions={actions.length} />,
  Icons: { Hide: () => <span data-icon="hide" />, Show: () => <span data-icon="show" />, Lock: props => <span data-icon="lock" {...props} /> },
  // The note's card, rendered in place: its trigger marked, its content beside it
  HoverCard: ({ children }) => <div data-hover-card>{children}</div>,
  HoverCardTrigger: ({ children }) => <div data-hover-trigger>{children}</div>,
  HoverCardPortal: ({ children }) => children,
  HoverCardContent: ({ children, side, align, sideOffset, ...props }) => <div data-side={side} {...props}>{children}</div>,
  Popover: ({ children }) => children,
  PopoverAnchor: ({ children }) => children,
  PopoverPortal: () => null,
  PopoverContent: () => null,
  Tooltip: ({ children }) => children,
  TooltipContent: ({ children, ...props }) => <div data-tooltip {...props}>{children}</div>,
  TooltipProvider: ({ children }) => children,
  TooltipTrigger: ({ children }) => children,
}), { virtual: true });
jest.mock('./metadataEventConcerns', () => ({ subscribeSeriesMetadata: () => () => {} }));
jest.mock('../overlayTrigger', () => ({ OverlayTrigger: ({ children, overlay }) => <>{children}<div data-warning>{overlay}</div></> }));
jest.mock('../tooltip', () => ({ Tooltip: ({ children, className }) => <div className={className}>{children}</div> }));
jest.mock('./../../elements/Icon', () => ({ Icon: ({ name }) => <span data-legacy-icon={name} /> }));

import { MeasurementTableItem } from './MeasurementTableItem';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  mockSetVisible.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const landmark = (index, name, extra = {}) => ({
  index, ordinal: index + 1, name, detail: '', shape: 'Point', typeText: 'Point', line: '#00C0FF', text: '#FFFFFF',
  own: { Line: null, Text: null }, ...extra,
});
// As the Viewer builds it (landmarkSetRows.js)
const row = (landmarkSet = {}, extra = {}) => ({
  measurementId: 'doc::set', toolType: 'SonadorLandmarkSet', isVisible: true, isReadOnly: true, isLocked: true, isPending: false,
  data: [{ displayText: 'Pelvic landmarks' }], label: 'Pelvis (planning) / Points picked',
  refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2',
  landmarkSet: {
    key: 'doc::set', name: 'Pelvic landmarks', count: 3, namedCount: 1, domain: 'patient', documentKind: 'exchange', placed: true,
    colors: { line: '#00C0FF', text: '#FFFFFF' },
    landmarks: [
      landmark(0, 'Pubic symphysis'),
      landmark(1, null, { shape: 'Anatomic', typeText: 'Anatomic' }),
      landmark(2, null, { shape: 'Registration', typeText: 'Registration' }),
    ],
    position: null, concept: null, label: null, description: null, frame: 'Imaging frame of series 2',
    types: [{ text: 'Point', shape: 'Point', count: 1 }], appearance: null,
    ...landmarkSet,
  },
  ...extra,
});
const onItemClick = jest.fn();
const render = (measurementData, props = {}) => act(() => root.render(
  <MeasurementTableItem itemIndex={1} onItemClick={onItemClick} onDelete={jest.fn()} onRelabel={jest.fn()} measurementData={measurementData} {...props} />));
const $ = selector => container.querySelector(selector);
const text = selector => ($(selector) || {}).textContent;
const references = () => [...container.querySelectorAll('.referenceMeta .refItem')].map(item => item.textContent);

beforeEach(() => {
  onItemClick.mockClear();
  mockClearCurrent.mockClear();
});


describe('the row of a placed set', () => {
  it('leads with the set icon and the swatch, Line on the left half and Text on the right, then the name, on one line', () => {
    render(row());
    // One flex line: icon, swatch, name
    const value = $('.landmarkSetValue');
    expect([...value.children].map(child => child.dataset.cy || child.className)).toEqual([
      'measurement-tool-icon', 'landmark-set-swatch', 'measurementDisplayText landmarkSetName ',
    ]);
    expect($('[data-cy="measurement-tool-icon"]').getAttribute('aria-label')).toBe('Landmark set');
    expect($('[data-cy="measurement-tool-icon"] svg circle')).not.toBeNull();
    const swatch = $('[data-cy="landmark-set-swatch"]');
    expect(swatch.querySelector('.measurementColorIndicatorLine').style.backgroundColor).toBe('rgb(0, 192, 255)');
    expect(swatch.querySelector('.measurementColorIndicatorText').style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(text('.landmarkSetName')).toBe('Pelvic landmarks');
  });

  it('reads "Landmark set" when the set has neither concept nor label', () => {
    render(row({ name: '' }));
    expect($('.landmarkSetName').textContent).toBe('Landmark set');
    expect($('.landmarkSetName').classList.contains('isUnnamed')).toBe(true);
  });

  it('gives S:, Modality and the count pill; no image for a patient-domain set', () => {
    render(row());
    expect(references()).toEqual(['S:2', 'Modality:MR', '3 landmarks']);
    expect(text('.referenceMeta .refLandmarkCount')).toBe('3 landmarks');
  });

  it('gives the image of an image-domain set, after the series', () => {
    render(row({ domain: 'image' }, { refSOPInstanceUID: '2.25.2.41' }));
    expect(references()).toEqual(['S:2', 'I:41', 'Modality:MR', '3 landmarks']);
  });

  it('keeps the count on a row with no series (Series Unavailable), with no S: or Modality', () => {
    render(row({}, { refSeriesInstanceUID: undefined }));
    expect(references()).toEqual(['3 landmarks']);
  });

  it('has its own visibility toggle, which shows or hides the set without selecting the row', () => {
    render(row());
    const toggle = $('[data-cy="measurement-visibility-toggle"]');
    expect(toggle.getAttribute('aria-label')).toBe('Hide');
    act(() => toggle.click());
    expect(mockSetVisible).toHaveBeenCalledWith('doc::set', false);
    expect(onItemClick).not.toHaveBeenCalled();

    render(row({}, { isVisible: false }));
    expect($('[data-cy="measurement-visibility-toggle"]').getAttribute('aria-label')).toBe('Show');
    expect($('[data-cy="measurement-visibility-toggle"] [data-icon="show"]')).not.toBeNull();
    act(() => $('[data-cy="measurement-visibility-toggle"]').click());
    expect(mockSetVisible).toHaveBeenLastCalledWith('doc::set', true);
  });

  it('has the lock, and no actions menu or row actions, selected or not', () => {
    render(row(), { isSelected: true });
    expect($('[data-icon="lock"]')).not.toBeNull();
    expect($('[data-row-actions]')).toBeNull();
    expect($('.rowActions')).toBeNull();
  });

  it('has no note on its index cell, a named control that steps the set from the keyboard (Enter or Space)', () => {
    render(row());
    expect($('[data-cy="landmark-set-held-note"]')).toBeNull();
    const index = $('[data-cy="landmark-set-index"]');
    expect(index.tabIndex).toBe(0);
    expect(index.getAttribute('role')).toBe('button');
    expect(index.getAttribute('aria-label')).toBe('1. Next landmark of Pelvic landmarks');
    // The row number stays visible
    expect(index.textContent).toContain('1');
    act(() => index.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => index.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    expect(onItemClick).toHaveBeenCalledTimes(2);
  });
});


describe('the current landmark', () => {
  it('turns the pill into its position, with a help tag, and names it on a line under the row', () => {
    render(row({ position: 0 }));
    expect(text('.referenceMeta .refLandmarkCount')).toBe('1 of 3');
    expect(text('[data-cy="landmark-set-position-help"]')).toBe('Landmark 1 of 3. Select the row again for the next.');
    const line = $('[data-cy="landmark-set-current"]');
    expect(line.querySelector('.landmarkCurrentName').textContent).toBe('Pubic symphysis');
    // Docked in the row card, inside the row
    expect(line.closest('.measurementItem')).not.toBeNull();
    expect(line.querySelector('[data-shape="Point"] path').getAttribute('d')).toContain('M3.5 10H7.5');
    expect(line.querySelector('[data-shape="Point"] g').getAttribute('stroke')).toBe('#00C0FF');
    expect(line.querySelector('[data-cy="landmark-type-mark"]')).toBeNull();
  });

  it.each([
    [1, 'Anatomic'],
    [2, 'Registration'],
  ])('shows an unnamed landmark by its type alone, as an outlined mark (%s, %s)', (position, type) => {
    render(row({ position }));
    const line = $('[data-cy="landmark-set-current"]');
    expect(line.querySelector('[data-cy="landmark-type-mark"]').textContent).toBe(type);
    expect(line.querySelector('.landmarkCurrentName')).toBeNull();
    expect(line.querySelector(`[data-shape="${type}"]`)).not.toBeNull();
    expect(line.textContent).toBe(type);
  });

  it('shows an unnamed Point as "Point"', () => {
    render(row({ landmarks: [landmark(0, null)], count: 1, position: 0 }));
    expect(text('[data-cy="landmark-set-current"] [data-cy="landmark-type-mark"]')).toBe('Point');
  });

  it('shows the whole name and second line on hover when they do not fit', () => {
    const long = landmark(0, 'Anterior inferior iliac spine, right side of the pelvis', { detail: 'Taken from the planning model by hand' });
    render(row({ landmarks: [long], count: 1, position: 0 }));
    expect(text('[data-cy="landmark-set-current"] .landmarkCurrentName')).toBe('Anterior inferior iliac spine, right side of the pelvis \u00B7 Taken from the planning model by hand');
    expect(text('[data-cy="landmark-set-current"] [data-tooltip]')).toBe('Anterior inferior iliac spine, right side of the pelvis \u00B7 Taken from the planning model by hand');
  });

  it('clears the current landmark from its line, without selecting the row', () => {
    render(row({ position: 0 }));
    act(() => $('[data-cy="landmark-set-current-clear"]').click());
    expect(mockClearCurrent).toHaveBeenCalledTimes(1);
    expect(onItemClick).not.toHaveBeenCalled();
    expect($('[data-cy="landmark-set-current-clear"]').getAttribute('aria-label')).toBe('Clear the current landmark');
  });

  it('moves keyboard focus from the clear control to the row\'s step control, which then steps once on Enter', () => {
    // As the store does: clearing rebuilds the row without the current landmark
    mockClearCurrent.mockImplementationOnce(() => render(row({ position: null })));
    render(row({ position: 0 }));
    const clear = $('[data-cy="landmark-set-current-clear"]');
    act(() => clear.focus());
    act(() => clear.click());
    expect($('[data-cy="landmark-set-current"]')).toBeNull();
    const step = $('[data-cy="landmark-set-index"]');
    expect(document.activeElement).toBe(step);
    // Clearing did not step the row
    expect(onItemClick).not.toHaveBeenCalled();
    act(() => step.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it('through a store notification: the row rebuilt without the line keeps focus on its step control, and Enter steps to the first landmark', () => {
    // A store as the landmark store behaves: clearing and stepping notify, and a subscribed row is
    // rebuilt from it, as the panel rebuilds its rows
    const store = { position: 0, listeners: new Set() };
    const notify = () => store.listeners.forEach(listener => listener());
    mockClearCurrent.mockImplementation(() => { store.position = null; notify(); });
    const step = jest.fn(() => { store.position = store.position === null ? 0 : store.position + 1; notify(); });
    const SubscribedRow = () => {
      const [, setVersion] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setVersion(version => version + 1);
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
      }, []);
      return <MeasurementTableItem itemIndex={1} onItemClick={step} measurementData={row({ position: store.position })} />;
    };
    act(() => root.render(<SubscribedRow />));

    const clear = $('[data-cy="landmark-set-current-clear"]');
    act(() => clear.focus());
    act(() => clear.click());
    expect(store.position).toBeNull();
    expect($('[data-cy="landmark-set-current"]')).toBeNull();
    expect(text('.referenceMeta .refLandmarkCount')).toBe('3 landmarks');
    expect(document.activeElement).toBe($('[data-cy="landmark-set-index"]'));
    expect(step).not.toHaveBeenCalled();

    act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(step).toHaveBeenCalledTimes(1);
    expect(store.position).toBe(0);
    expect(text('[data-cy="landmark-set-current"] .landmarkCurrentName')).toBe('Pubic symphysis');
    mockClearCurrent.mockReset();
  });

  it('keeps the count and no line on a set that does not hold it', () => {
    render(row({ position: null }));
    expect(text('.referenceMeta .refLandmarkCount')).toBe('3 landmarks');
    expect($('[data-cy="landmark-set-current"]')).toBeNull();
  });
});


describe('the row of a held set', () => {
  const held = (extra = {}) => row({ placed: false, note: "No loaded series shares this measurement's frame of reference.", ...extra });

  it('has the blue index cell with a ring struck through, and its note: the sentence of its state and its stored series', () => {
    render(held({ sourceSeries: '2.25.2' }));
    expect($('.measurementItem').classList.contains('isHeldLandmarkSet')).toBe(true);
    expect($('.landmarkHeldMark svg').getAttribute('aria-label')).toBe('Not shown');
    const note = $('[data-cy="landmark-set-held-note"]');
    expect(note.querySelector('.warningTitle').textContent).toBe('Landmark set not shown');
    expect(note.textContent).toContain("No loaded series shares this measurement's frame of reference.");
    expect(note.textContent).toContain('Series: 2 Synthetic pelvis');
    expect($('[data-hover-trigger] .itemIndex').tabIndex).toBe(0);
  });

  it('names the series Unknown when it stores none', () => {
    render(held());
    expect($('[data-cy="landmark-set-held-note"]').textContent).toContain('Series: Unknown');
  });

  it('reads S:, the "Not shown" chip and the count; never the modality; no visibility toggle', () => {
    render(held());
    expect(references()).toEqual(['S:2', 'Not shown', '3 landmarks']);
    expect($('[data-cy="measurement-visibility-toggle"]')).toBeNull();

    render(held({}, {}));
    act(() => root.render(<MeasurementTableItem itemIndex={1} onItemClick={onItemClick}
      measurementData={{ ...held(), refSeriesInstanceUID: undefined }} />));
    expect(references()).toEqual(['Not shown', '3 landmarks']);
  });

  it('an image-domain set held: S:, the chip and the count, never its image number', () => {
    render(held({ domain: 'image', note: 'The image this landmark set was placed on is not loaded.' }));
    act(() => root.render(<MeasurementTableItem itemIndex={1} onItemClick={onItemClick}
      measurementData={{ ...held({ domain: 'image' }), refSOPInstanceUID: '2.25.2.41' }} />));
    expect(references()).toEqual(['S:2', 'Not shown', '3 landmarks']);
    // Its image loaded again: placed, with its image and modality
    act(() => root.render(<MeasurementTableItem itemIndex={1} onItemClick={onItemClick}
      measurementData={row({ domain: 'image' }, { refSOPInstanceUID: '2.25.2.41' })} />));
    expect(references()).toEqual(['S:2', 'I:41', 'Modality:MR', '3 landmarks']);
  });

  it('keeps the count and no landmark line, even with a position', () => {
    render(held({ position: 0 }));
    expect(text('.referenceMeta .refLandmarkCount')).toBe('3 landmarks');
    expect($('[data-cy="landmark-set-current"]')).toBeNull();
  });
});


describe('the label line', () => {
  it('reads the label line of the set, or what a search matched among its landmarks', () => {
    render(row());
    expect(text('.measurementLabel')).toBe('Pelvis (planning) / Points picked');

    render(row(), { landmarkMatch: 'Tear drop (2)' });
    expect(text('[data-cy="landmark-set-matches"]')).toBe('Matches: Tear drop (2)');
    expect(container.textContent).not.toContain('Points picked');
  });
});


describe('a set of an application document', () => {
  it('keeps the lock, with the document and where the set comes from in its hover', () => {
    render(row({ documentKind: 'application' }, { fromApplicationDocument: true }));
    expect($('[data-cy="measurement-application-document"]').getAttribute('aria-label')).toBe('Read-only: from an application document');
    expect($('[data-cy="measurement-application-document"] [data-icon="lock"]')).not.toBeNull();
    expect($('[data-cy="measurement-application-document-tooltip"] [data-cy="measurement-application-document-icon"]')).not.toBeNull();
  });
});
