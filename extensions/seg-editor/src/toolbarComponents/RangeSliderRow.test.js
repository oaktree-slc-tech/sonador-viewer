/**
 * @jest-environment jsdom
 */
// The range row (the Labelmap Threshold range): both ends have a handle, and moving either one
// emits the threshold pair. Rendered with the real ui-next Slider (Radix).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { RangeSliderRow } from './panelControls';

jest.mock('@ohif/ui-next', () => {
  const React = require('react');
  const passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  return {
    Slider: jest.requireActual('../../../../platform/ui-next/src/components/Slider/Slider').Slider,
    Input: props => React.createElement('input', props),
    Label: props => React.createElement('label', props),
    Switch: () => null,
    Tabs: passthrough,
    TabsList: passthrough,
    TabsTrigger: passthrough,
    Tooltip: passthrough,
    TooltipContent: () => null,
    TooltipTrigger: passthrough,
  };
}, { virtual: true });


global.IS_REACT_ACT_ENVIRONMENT = true;
// Radix measures its thumbs
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, unmount: () => act(() => root.unmount()) };
}

const press = (thumb, key) => act(() => {
  thumb.focus();
  thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

describe('RangeSliderRow', () => {
  it('has a handle at each end, and each one moves its own end of the pair', () => {
    const onChange = jest.fn();
    const { container, unmount } = render(React.createElement(RangeSliderRow, {
      id: 'threshold',
      label: 'Threshold Range',
      unit: 'HU',
      value: [50, 600],
      range: { min: -1000, max: 1000, step: 1 },
      onChange,
    }));

    const thumbs = container.querySelectorAll('[role="slider"]');
    expect(thumbs).toHaveLength(2);
    expect([...thumbs].map(thumb => thumb.getAttribute('aria-valuenow'))).toEqual(['50', '600']);

    press(thumbs[1], 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith([50, 601]);
    press(thumbs[0], 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith([49, 600]);
    unmount();
  });

  it('keeps a single-value slider to one handle', () => {
    const { Slider } = require('@ohif/ui-next');
    const { container, unmount } = render(React.createElement(Slider, { value: [3], min: 0, max: 5, step: 0.1, 'aria-label': 'Radius' }));
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(1);
    unmount();
  });
});
