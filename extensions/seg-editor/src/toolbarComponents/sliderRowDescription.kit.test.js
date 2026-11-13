/**
 * @jest-environment jsdom
 */
// A length setting's unit is defined wherever the setting takes focus (ohif-viewers!117): the
// number field and the slider's thumb, rendered with the REAL @ohif/ui-next kit (Input, Radix
// Slider and Tooltip), are described by the unit with its hover text and by the note beneath.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@ohif/ui-next';

import { SliderRow } from './panelControls';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const mounted = [];
function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(TooltipProvider, null, React.createElement(SliderRow, {
    id: 'seg-editor-depth',
    label: 'Depth',
    range: { min: 0, max: 40, step: 1 },
    onChange: () => {},
    ...props,
  }))));
  mounted.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
}
afterEach(() => {
  while (mounted.length) {
    mounted.pop()();
  }
});

// The text of the elements an element's aria-describedby names, in order
const description = element => (element.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)
  .map(id => document.getElementById(id)?.textContent);

const VOXELS_HINT = "Voxel units: whole steps of the grid's smallest spacing (1). The cells are 1 × 1 × 2.5 across, so a count is not that many cells along every axis.";

describe('SliderRow descriptions', () => {
  it('describes the number field and the thumb by the voxel unit\'s definition and the note, on an anisotropic grid', () => {
    const container = render({ unit: 'vox', unitHint: VOXELS_HINT, value: 4, note: '= 4 grid units · cells 1 × 1 × 2.5' });
    const field = container.querySelector('#seg-editor-depth-value');
    const thumb = container.querySelector('[role="slider"]');

    expect(field.getAttribute('aria-label')).toBe('Depth');
    expect(thumb.getAttribute('aria-label')).toBe('Depth');
    const expected = [`vox. ${VOXELS_HINT}`, '= 4 grid units · cells 1 × 1 × 2.5'];
    expect(description(field)).toEqual(expected);
    expect(description(thumb)).toEqual(expected);
    // The definition is not drawn: the row shows the unit, and the note under the slider
    const definition = container.querySelector('#seg-editor-depth-unit-description');
    expect(definition.className).toBe('sr-only');
    // ... and the row is its containing block, so the hidden line is laid out inside the panel's
    // scroll area rather than against the page (which a row below the fold would stretch)
    expect(definition.parentElement.classList.contains('relative')).toBe(true);
  });

  it('describes a calibrated length by its unit and its reading in voxels', () => {
    const container = render({ unit: 'mm', value: 2, note: '≈ 4 voxel(s) · cells 0.5 × 0.5 × 3 mm' });
    const field = container.querySelector('#seg-editor-depth-value');
    const thumb = container.querySelector('[role="slider"]');
    expect(description(field)).toEqual(['mm', '≈ 4 voxel(s) · cells 0.5 × 0.5 × 3 mm']);
    expect(description(thumb)).toEqual(['mm', '≈ 4 voxel(s) · cells 0.5 × 0.5 × 3 mm']);
  });

  it('names a generic unit\'s reason, and describes nothing for a setting without a unit or note', () => {
    const generic = render({ unit: 'units', unitHint: 'The images carry no pixel spacing.', value: 2 });
    expect(description(generic.querySelector('#seg-editor-depth-value'))).toEqual(['units. The images carry no pixel spacing.']);

    const bare = render({ id: 'seg-editor-passes', label: 'Passes', value: 3, range: { min: 1, max: 10, step: 1 } });
    expect(bare.querySelector('#seg-editor-passes-value').hasAttribute('aria-describedby')).toBe(false);
    expect(bare.querySelector('[role="slider"]').hasAttribute('aria-describedby')).toBe(false);
  });
});
