// The scale check of an STL import: which unit a model looks to be in, against the image

import {
  extentOf, modelsNeedingRescale, overlapFraction, pointBounds, rescaleModel, STL_UNIT_BY_CODE, STL_UNITS,
  suggestStlUnit, unitFromMeasurementUnits,
} from './stlScale';


// A CT 350 mm across, away from the origin, as patient coordinates usually are
const IMAGE = { min: [-175, -175, -400], max: [175, 175, -50] };
// A femur 300 mm long, inside it
const FEMUR_MM = { min: [-60, -40, -380], max: [20, 40, -80] };
const scaled = (bounds, factor) => ({ min: bounds.min.map(v => v * factor), max: bounds.max.map(v => v * factor) });

describe('overlapFraction / extentOf / pointBounds', () => {
  it('measures how much of a model box lies in the image box', () => {
    expect(overlapFraction(FEMUR_MM, IMAGE)).toBe(1);
    expect(overlapFraction({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [5, 0, 0], max: [20, 20, 20] })).toBe(0.5);
    expect(overlapFraction({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [50, 50, 50], max: [60, 60, 60] })).toBe(0);
    // A flat model counts as inside on its flat axis when it is within the image's span
    expect(overlapFraction({ min: [0, 0, 5], max: [10, 10, 5] }, { min: [0, 0, 0], max: [10, 10, 10] })).toBe(1);
  });

  it('gives a box its largest side, and a point list its bounds', () => {
    expect(extentOf(FEMUR_MM)).toBe(300);
    expect(pointBounds([1, 2, 3, -1, 5, 0])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
    expect(pointBounds([])).toBeNull();
  });
});

describe('suggestStlUnit', () => {
  it('takes a model that lies on the image as millimetres', () => {
    expect(suggestStlUnit(FEMUR_MM, IMAGE)).toBeNull();
  });

  it('finds the unit at which a model saved in another unit lies on the image', () => {
    expect(suggestStlUnit(scaled(FEMUR_MM, 0.001), IMAGE)).toMatchObject({ unit: 'm', factor: 1000 });
    expect(suggestStlUnit(scaled(FEMUR_MM, 0.1), IMAGE)).toMatchObject({ unit: 'cm', factor: 10 });
    expect(suggestStlUnit(scaled(FEMUR_MM, 1 / 25.4), IMAGE)).toMatchObject({ unit: 'in', factor: 25.4 });
    const metres = suggestStlUnit(scaled(FEMUR_MM, 0.001), IMAGE);
    expect(metres.extent).toBeCloseTo(0.3);
    expect(metres.scaledExtent).toBeCloseTo(300);
  });

  it('prefers the unit nearest the image scale when several put a model near the origin on the image', () => {
    const image = { min: [-200, -200, -200], max: [200, 200, 200] };
    const nearOrigin = { min: [0.01, 0.01, 0.01], max: [0.2, 0.15, 0.1] };
    expect(suggestStlUnit(nearOrigin, image)).toMatchObject({ unit: 'm' });
  });

  it('judges a model in another frame of reference by its size only', () => {
    // 0.3 across, nowhere near the image: metres puts it at the image's scale
    expect(suggestStlUnit({ min: [5, 5, 5], max: [5.3, 5.1, 5.1] }, IMAGE)).toMatchObject({ unit: 'm' });
    // Plausibly sized as millimetres: left to the import's own off-the-grid report
    expect(suggestStlUnit({ min: [1000, 1000, 1000], max: [1300, 1100, 1100] }, IMAGE)).toBeNull();
  });

  it('suggests nothing without bounds', () => {
    expect(suggestStlUnit(null, IMAGE)).toBeNull();
    expect(suggestStlUnit(FEMUR_MM, null)).toBeNull();
  });
});

describe('rescaleModel / modelsNeedingRescale', () => {
  const model = (label, factor) => ({
    label,
    surface: { points: Float32Array.from([-60, -40, -380, 20, 40, -80, 0, 0, -200].map(v => v * factor)), polys: [1, 2] },
  });

  it('multiplies a surface\'s points, keeping its type and leaving the model as it was', () => {
    const original = model('femur', 0.001);
    const rescaled = rescaleModel(original, 1000);
    expect(rescaled.surface.points).toBeInstanceOf(Float32Array);
    expect(rescaled.surface.points[2]).toBeCloseTo(-380, 3);
    expect(rescaled.surface.polys).toBe(original.surface.polys);
    expect(original.surface.points[2]).toBeCloseTo(-0.38, 6);
  });

  it('groups the models that do not look like millimetres by their unit', () => {
    const groups = modelsNeedingRescale(
      [model('femur', 0.001), model('tibia', 1), model('patella', 0.001), model('pin', 0.1)], IMAGE);
    expect(groups.map(({ suggestion, models }) => [suggestion.unit, models.map(m => m.label)])).toEqual([
      ['m', ['femur', 'patella']],
      ['cm', ['pin']],
    ]);
  });
});

describe('the declarable units and an encoded unit (ohif-viewers#151 FR-5)', () => {
  it('lists the CID 7063 units the import handles, millimetres first, each reachable by its code', () => {
    expect(STL_UNITS.map(unit => unit.unit)).toEqual(['mm', 'µm', 'cm', 'in', 'm']);
    expect(STL_UNITS.map(unit => unit.factor)).toEqual([1, 0.001, 10, 25.4, 1000]);
    expect(STL_UNIT_BY_CODE.in.name).toBe('inches');
    expect(STL_UNIT_BY_CODE.furlong).toBeUndefined();
  });

  it('reads a model instance\'s Measurement Units Code Sequence by its UCUM code', () => {
    const encoded = (CodeValue, CodingSchemeDesignator = 'UCUM') => ({ MeasurementUnitsCodeSequence: [{ CodeValue, CodingSchemeDesignator, CodeMeaning: 'x' }] });
    expect(unitFromMeasurementUnits(encoded('mm'))).toBe(STL_UNIT_BY_CODE.mm);
    expect(unitFromMeasurementUnits(encoded('um'))).toBe(STL_UNIT_BY_CODE['µm']);
    expect(unitFromMeasurementUnits(encoded('[in_i]'))).toBe(STL_UNIT_BY_CODE.in);
    expect(unitFromMeasurementUnits(encoded(' m '))).toBe(STL_UNIT_BY_CODE.m);
    // Without a designator the code is read as UCUM; another scheme, an unknown code or no
    // sequence declare nothing
    expect(unitFromMeasurementUnits({ MeasurementUnitsCodeSequence: [{ CodeValue: 'cm' }] })).toBe(STL_UNIT_BY_CODE.cm);
    expect(unitFromMeasurementUnits(encoded('mm', 'DCM'))).toBeUndefined();
    expect(unitFromMeasurementUnits(encoded('ft'))).toBeUndefined();
    expect(unitFromMeasurementUnits({})).toBeUndefined();
    expect(unitFromMeasurementUnits(undefined)).toBeUndefined();
  });
});
