/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The dropdown select shared by the side panels: a focusable combobox that names the highlighted
// entry through aria-activedescendant (stable ids, distinct across controls and for entries with one
// title), chooses and dismisses from the keyboard, and bounds its menu by the space left below the
// control in its clipping ancestor, scrolling within it with the highlighted entry kept in view.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import CustomSelect from './CustomSelect';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const entriesOf = (chosen) => [
  { value: 'a', title: 'Alpha', description: 'first', onClick: () => chosen('a') },
  { value: 'b', title: 'Beta', onClick: () => chosen('b') },
  { value: 'c', title: 'Beta', description: 'the second Beta', onClick: () => chosen('c') },
];
const render = (element) => act(() => root.render(element));
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const $ = (selector, scope = container) => scope.querySelector(selector);
const $$ = (selector, scope = container) => [...scope.querySelectorAll(selector)];
const key = (element, name) => act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });

it('names the highlighted entry to assistive technology while the control keeps focus, and clears it on dismissal', () => {
  const chosen = jest.fn();
  const options = entriesOf(chosen);
  render(<CustomSelect label="Timepoint" value={options[1]} options={options} />);
  const control = $('[role="combobox"]');
  expect(control.getAttribute('aria-label')).toBe('Timepoint');
  expect(control.getAttribute('aria-activedescendant')).toBeNull();

  act(() => control.focus());
  key(control, 'ArrowDown');
  const listbox = $('[role="listbox"]');
  expect(control.getAttribute('aria-controls')).toBe(listbox.id);
  const items = $$('[role="option"]');
  // Opens on the shown value; two entries with one title have distinct ids
  expect(control.getAttribute('aria-activedescendant')).toBe(items[1].id);
  expect(new Set(items.map(item => item.id)).size).toBe(3);
  expect(items[1].getAttribute('aria-selected')).toBe('true');
  key(control, 'ArrowDown');
  expect(control.getAttribute('aria-activedescendant')).toBe(items[2].id);
  expect(document.activeElement).toBe(control);
  key(control, 'Home');
  expect(control.getAttribute('aria-activedescendant')).toBe(items[0].id);
  key(control, 'End');
  expect(control.getAttribute('aria-activedescendant')).toBe(items[2].id);
  key(control, ' ');
  expect(chosen).toHaveBeenCalledWith('c');
  expect($('[role="listbox"]')).toBeNull();
  expect(control.getAttribute('aria-activedescendant')).toBeNull();
  expect(document.activeElement).toBe(control);

  key(control, 'Enter');
  expect($('[role="listbox"]')).not.toBeNull();
  key(control, 'Escape');
  expect($('[role="listbox"]')).toBeNull();
  expect(control.getAttribute('aria-expanded')).toBe('false');
  expect(chosen).toHaveBeenCalledTimes(1);
});

it('gives two mounted controls distinct ids', () => {
  const options = entriesOf(() => {});
  render(<><CustomSelect label="One" value={options[0]} options={options} /><CustomSelect label="Two" value={options[0]} options={options} /></>);
  const [first, second] = $$('[role="combobox"]');
  key(first, 'Enter');
  key(second, 'Enter');
  const ids = $$('[role="option"]').map(item => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(first.getAttribute('aria-activedescendant')).not.toBe(second.getAttribute('aria-activedescendant'));
});

// Geometry: the clipping ancestors and the control report the rectangles given; the viewport is jsdom's
function withGeometry(rects, run) {
  const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const found = [...rects.entries()].find(([selector]) => this.matches && this.matches(selector));
    return found ? { left: 0, right: 0, width: 0, height: 0, ...found[1] } : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  });
  const scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
  try {
    run(scrolled);
  } finally {
    spy.mockRestore();
    delete Element.prototype.scrollIntoView;
  }
}
const menuOf = () => $('[role="listbox"]');
const openWith = (clips, controlRect, rects) => {
  const options = entriesOf(() => {});
  let tree = <CustomSelect label="Timepoint" value={options[0]} options={options} />;
  clips.forEach((name) => { tree = <div style={{ overflowY: 'hidden' }} data-clip={name}>{tree}</div>; });
  render(tree);
  rects.set('[role="combobox"]', controlRect);
  key($('[role="combobox"]'), 'Enter');
};

it('bounds the menu by the room below the control inside the clipping ancestor, and keeps the highlighted entry in view', () => {
  const rects = new Map([['[data-clip="panel"]', { top: 0, bottom: 300 }]]);
  withGeometry(rects, (scrolled) => {
    openWith(['panel'], { top: 100, bottom: 150 }, rects);
    // 300 at the clip's bottom edge, 150 below the control, 8 kept clear
    expect(menuOf().style.maxHeight).toBe('142px');
    expect(menuOf().classList.contains('customSelectMenuAbove')).toBe(false);
    const control = $('[role="combobox"]');
    key(control, 'ArrowDown');
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.instances.pop().id).toBe(control.getAttribute('aria-activedescendant'));
  });
});

it('never gives the menu more than the room below when that room is small but the larger side', () => {
  const rects = new Map([['[data-clip="panel"]', { top: 120, bottom: 200 }]]);
  withGeometry(rects, () => {
    openWith(['panel'], { top: 130, bottom: 150 }, rects);
    expect(menuOf().style.maxHeight).toBe('42px');
    expect(menuOf().classList.contains('customSelectMenuAbove')).toBe(false);
  });
});

it('opens above the control when the room below is too small and the room above is larger', () => {
  const rects = new Map([['[data-clip="panel"]', { top: 0, bottom: 200 }]]);
  withGeometry(rects, () => {
    openWith(['panel'], { top: 150, bottom: 200 }, rects);
    // Nothing below (0 - 8 < 0), 142 above
    expect(menuOf().classList.contains('customSelectMenuAbove')).toBe(true);
    expect(menuOf().style.maxHeight).toBe('142px');
  });
});

it('gives the menu no height when no room is visible on either side, never an unbounded one', () => {
  const rects = new Map([['[data-clip="panel"]', { top: 150, bottom: 150 }]]);
  withGeometry(rects, () => {
    openWith(['panel'], { top: 150, bottom: 150 }, rects);
    expect(menuOf().style.maxHeight).toBe('0px');
  });
});

it('takes the tightest of nested clipping ancestors and the viewport', () => {
  const rects = new Map([['[data-clip="inner"]', { top: 0, bottom: 500 }], ['[data-clip="outer"]', { top: 0, bottom: 300 }]]);
  withGeometry(rects, () => {
    openWith(['inner', 'outer'], { top: 100, bottom: 150 }, rects);
    expect(menuOf().style.maxHeight).toBe('142px');
  });
  act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const wide = new Map([['[data-clip="tall"]', { top: 0, bottom: 5000 }]]);
  withGeometry(wide, () => {
    openWith(['tall'], { top: 100, bottom: 150 }, wide);
    expect(menuOf().style.maxHeight).toBe(`${window.innerHeight - 150 - 8}px`);
  });
});

it('measures the room again when the window is resized while the menu is open', () => {
  const rects = new Map([['[data-clip="panel"]', { top: 0, bottom: 300 }]]);
  withGeometry(rects, () => {
    openWith(['panel'], { top: 100, bottom: 150 }, rects);
    expect(menuOf().style.maxHeight).toBe('142px');
    rects.set('[data-clip="panel"]', { top: 0, bottom: 250 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(menuOf().style.maxHeight).toBe('92px');
  });
});

it('bounds the menu by the viewport when no ancestor clips', () => {
  const options = entriesOf(() => {});
  render(<CustomSelect value={options[0]} options={options} />);
  key($('[role="combobox"]'), 'Enter');
  // The control measures at the top of an unstyled document: the viewport height less the margin
  expect($('[role="listbox"]').style.maxHeight).toBe(`${window.innerHeight - 8}px`);
});
