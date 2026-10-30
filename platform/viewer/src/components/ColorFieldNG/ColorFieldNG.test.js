/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// The colour well: the swatch opens the picker, nothing reaches the caller until Apply, Cancel and
// Escape leave the value alone, and a disabled well shows its fallback and does not open.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@ohif/ui-next';

import ColorFieldNG, { normalizeHexColor } from './ColorFieldNG';

global.IS_REACT_ACT_ENVIRONMENT = true;

// react-color draws its alpha checkerboard on a canvas, which jsdom has no context for; the
// picker renders without it
HTMLCanvasElement.prototype.getContext = () => null;

// Radix positions its floating layers with ResizeObserver, which jsdom lacks
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const mounted = [];

function mount(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TooltipProvider>
        <ColorFieldNG id="well" label="Preview colour" hint="Pick a colour" onChange={() => {}} {...props} />
      </TooltipProvider>
    );
  });
  mounted.push({ root, host });
  return host;
}

afterEach(() => {
  while (mounted.length) {
    const { root, host } = mounted.pop();
    act(() => root.unmount());
    host.remove();
  }
});

const trigger = () => document.querySelector('[data-cy="well-swatch"]');
const picker = () => document.querySelector('[data-cy="well-picker"]');
const click = element => act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

// The picker's hex field is a controlled React input: set the value through the native setter and
// raise an input event, as a keyboard would
function typeHex(value) {
  const input = picker().querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('normalizeHexColor', () => {
  it('lower-cases a hex colour and falls back otherwise', () => {
    expect(normalizeHexColor('#FF8500', '#000000')).toBe('#ff8500');
    expect(normalizeHexColor('auto', '#8f8f8f')).toBe('#8f8f8f');
    expect(normalizeHexColor(undefined, '#8f8f8f')).toBe('#8f8f8f');
    expect(normalizeHexColor('#ff8500aa', '#8f8f8f')).toBe('#8f8f8f');
  });
});

describe('ColorFieldNG', () => {
  it('shows the value on the swatch, names it, and opens the picker on click', () => {
    mount({ value: '#FF8500' });
    const button = trigger();
    expect(button.getAttribute('aria-label')).toBe('Preview colour: #ff8500');
    expect(button.querySelector('span').style.backgroundColor).toBe('rgb(255, 133, 0)');
    expect(picker()).toBeNull();

    click(button);
    expect(picker()).not.toBeNull();
    expect(picker().querySelector('.chrome-picker')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('applies the picked colour in lower case on Apply, and only then', () => {
    const onChange = jest.fn();
    mount({ value: '#ff8500', onChange });
    click(trigger());
    typeHex('#AABBCC');
    expect(onChange).not.toHaveBeenCalled();

    click(picker().querySelector('[data-cy="well-apply"]'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#aabbcc');
    expect(picker()).toBeNull();
  });

  it('leaves the value alone on Cancel and on Escape, and reopens on the value', () => {
    const onChange = jest.fn();
    mount({ value: '#ff8500', onChange });

    click(trigger());
    typeHex('#AABBCC');
    click(picker().querySelector('[data-cy="well-cancel"]'));
    expect(picker()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    click(trigger());
    typeHex('#112233');
    act(() => {
      picker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(picker()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    // The picker starts from the field's value again, not from the abandoned pick
    click(trigger());
    expect(picker().querySelector('input').value.toLowerCase()).toBe('#ff8500');
  });

  it('shows the fallback and does not open while disabled', () => {
    const onChange = jest.fn();
    mount({ value: '#ff8500', onChange, disabled: true, fallback: '#8f8f8f', disabledHint: 'Following the segment' });
    const button = trigger();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Preview colour: #8f8f8f');
    expect(button.querySelector('span').style.backgroundColor).toBe('rgb(143, 143, 143)');
    click(button);
    expect(picker()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
