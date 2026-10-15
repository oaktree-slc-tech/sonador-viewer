// The palette option cards: values clamped to their range, units resolved from the series, and
// segmented controls given their own line when their labels are long

import { clampToRange, optionUnit } from './ToolOptionCards';
import { segmentsNeedOwnLine } from './panelControls';

jest.mock('@ohif/ui-next', () => ({}), { virtual: true });
jest.mock('@ohif/extension-vtk', () => ({ Enums: { CORNERSTONE: {} } }), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ cache: {}, metaData: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: {} }), { virtual: true });


describe('clampToRange', () => {
  const radius = { min: 0.1, max: 5, step: 0.1 };

  it('keeps a value in its range, at its step\'s decimals', () => {
    expect(clampToRange(radius, 12)).toBe(5);
    expect(clampToRange(radius, 0)).toBe(0.1);
    expect(clampToRange(radius, 0.1 + 0.2)).toBe(0.3);
    expect(clampToRange({ min: -1000, max: 1000, step: 1 }, '40.4')).toBe(40);
  });
});

describe('optionUnit', () => {
  const mm = { length: 'mm', intensity: 'HU' };
  const generic = { length: 'units', intensity: null };

  it('shows lengths in the series\' units, explaining generic ones', () => {
    expect(optionUnit({ unit: 'length' }, mm)).toEqual({ unit: 'mm', unitHint: undefined });
    expect(optionUnit({ unit: 'length' }, generic)).toEqual({ unit: 'units', unitHint: expect.stringMatching(/pixel spacing/) });
  });

  it('shows intensities in HU on CT only, and nothing for an option without a unit', () => {
    expect(optionUnit({ unit: 'intensity' }, mm)).toEqual({ unit: 'HU', unitHint: 'Hounsfield units' });
    expect(optionUnit({ unit: 'intensity' }, generic)).toEqual({});
    expect(optionUnit({}, mm)).toEqual({});
  });
});

describe('segmentsNeedOwnLine', () => {
  const items = (...labels) => labels.map(label => ({ value: label, label }));

  it('puts Circle / Sphere / Rectangle on its own line, and keeps the short controls beside their labels', () => {
    expect(segmentsNeedOwnLine(items('Circle', 'Sphere', 'Rectangle'))).toBe(true);
    expect(segmentsNeedOwnLine(items('Circle', 'Sphere'))).toBe(false);
    expect(segmentsNeedOwnLine(items('Auto', 'Smooth', 'Flat'))).toBe(false);
    expect(segmentsNeedOwnLine(items('Freehand', 'Box'))).toBe(false);
  });
});
