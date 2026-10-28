// The selection's colour system: a pastel fill of the segment's hue, a wire (edges, vertex
// cores) in the hue at full saturation and a lightness solved for contrast against the fill and
// the edit-mode mesh, the opacities and sizes

import { Color } from 'three';

import {
  BRUSH_FOOTPRINT_OPACITY, contrastRatio, SELECTION_EDGE_WIDTH, SELECTION_FILL_OPACITY, SELECTION_POINT_SIZE, selectionColors,
  selectionStyle,
} from './selectionStyle';

const WIRE_LIGHTNESS = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

describe('selectionColors', () => {
  it.each([
    ['red', '#ff0000', { mesh: '#ff9999', fill: '#ffb3b3', wire: '#ff2e2e', light: false }],
    ['dark blue', '#1a3a8a', { mesh: '#a3b0d0', fill: '#b3c8ff', wire: '#4278ff', light: false }],
    ['pale yellow', '#ffff80', { mesh: '#33331a', fill: '#ffffd6', wire: '#b2b300', light: true }],
    ['mid grey', '#808080', { mesh: '#1a1a1a', fill: '#ebebeb', wire: '#a3a3a3', light: true }],
  ])('solves %s: the wire clears the fill by 2.1:1 and the mesh by 1.8:1', (_name, segment, expected) => {
    const colors = selectionColors(segment);
    expect(colors).toEqual(expected);
    expect(contrastRatio(colors.wire, colors.fill)).toBeGreaterThanOrEqual(2.1);
    expect(contrastRatio(colors.wire, colors.mesh)).toBeGreaterThanOrEqual(1.8);
    const lightness = WIRE_LIGHTNESS(colors.wire);
    expect(lightness).toBeGreaterThanOrEqual(0.2);
    expect(lightness).toBeLessThanOrEqual(0.705); // 0.7, with hex rounding
  });

  it('reads a colour LUT entry and a CSS string alike, and solves against the mesh colour in effect', () => {
    expect(selectionColors([255, 0, 0])).toEqual(selectionColors('#ff0000'));
    expect(selectionColors('rgb(255, 0, 0)').wire).toBe('#ff2e2e');
    // A user-picked grey mesh moves the wire darker to clear it
    const grey = selectionColors('#ff0000', { meshColor: '#8f8f8f' });
    expect(grey.mesh).toBe('#8f8f8f');
    expect(contrastRatio(grey.wire, '#8f8f8f')).toBeGreaterThanOrEqual(1.8);
    expect(contrastRatio(grey.wire, grey.fill)).toBeGreaterThanOrEqual(2.1);
    expect(WIRE_LIGHTNESS(grey.wire)).toBeLessThan(0.59);
    // A mesh picked at the wire's own colour cannot be cleared in range: the closest balance wins
    const against = selectionColors('#ff0000', { meshColor: '#ff2e2e' });
    expect(against.wire).not.toBe('#ff2e2e');
    expect(contrastRatio(against.wire, '#ff2e2e')).toBeGreaterThan(1.3);
    expect(contrastRatio(against.wire, against.fill)).toBeGreaterThan(1.8);
  });

  it('falls back to the fallback yellow without a colour', () => {
    expect(selectionColors(undefined)).toEqual(selectionColors('#ffd600'));
    expect(selectionColors(null)).toEqual(selectionColors('#ffd600'));
    expect(selectionColors('#ffd600')).toMatchObject({ fill: '#fff8d6', wire: '#c7a700', light: true });
  });
});

describe('selectionStyle', () => {
  it('fills more strongly while painting, with a 3px outline, 2px interior edges and 6px points either way', () => {
    const lasso = selectionStyle('#ff0000');
    expect(lasso.fill).toBeInstanceOf(Color);
    expect(lasso.fill.getHexString()).toBe('ffb3b3');
    expect(lasso.wire.getHexString()).toBe('ff2e2e');
    expect(lasso).toMatchObject({
      fillOpacity: SELECTION_FILL_OPACITY.lasso, boundaryWidth: 3, interiorWidth: 2, pointSize: SELECTION_POINT_SIZE, light: false,
    });
    expect(selectionStyle('#ff0000', { painting: true }).fillOpacity).toBe(SELECTION_FILL_OPACITY.paint);
    expect(SELECTION_FILL_OPACITY).toEqual({ lasso: 0.8, paint: 0.9 });
    expect(SELECTION_EDGE_WIDTH).toEqual({ boundary: 3, interior: 2 });
    expect(SELECTION_POINT_SIZE).toBe(6);
    expect(BRUSH_FOOTPRINT_OPACITY).toBe(0.45);
  });
});
