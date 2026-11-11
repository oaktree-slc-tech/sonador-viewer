// Sonador-Measurement.View: the five registered values, with their meanings and Sonador-SR 0.3 codes
// (the same table as the Sonador IO client's), and the rule that names the view a measurement was
// drawn in: within 15 degrees of a patient axis, that axis's view; otherwise oblique.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });

import {
  DCMSR_MEASUREMENT_VIEW, MEASUREMENT_VIEW_CODES, MEASUREMENT_VIEWS,
} from '../enums';
import { VIEW_ALIGN_LIMIT_DEGREES, drawnViewOf, viewOfImageOrientation, viewOfNormal } from './measurementView';

const degrees = angle => (angle * Math.PI) / 180;
// A normal tilted `angle` degrees from the z axis, towards x
const tiltedFromZ = angle => [Math.sin(degrees(angle)), 0, Math.cos(degrees(angle))];


describe('the View registry', () => {
  it('registers five values, each its own code value, with the approved meanings', () => {
    expect(MEASUREMENT_VIEWS).toEqual(['axial', 'sagittal', 'coronal', 'oblique', '3d']);
    expect(Object.fromEntries(MEASUREMENT_VIEWS.map(view => [view, MEASUREMENT_VIEW_CODES[view].meaning]))).toEqual({
      axial: 'Axial view. Cross-sections, dividing head from feet.',
      sagittal: 'Sagittal view. Side-on slices, dividing left from right.',
      coronal: 'Coronal view. Front-on slices, dividing front from back.',
      oblique: 'Oblique view. A slice tilted away from the standard views.',
      '3d': '3D view. The whole volume, seen from any direction.',
    });
    MEASUREMENT_VIEWS.forEach((view) => {
      expect(MEASUREMENT_VIEW_CODES[view]).toEqual({
        value: view, schemeDesignator: 'Sonador-SR', meaning: expect.any(String), schemeVersion: '0.3',
      });
      expect(MEASUREMENT_VIEW_CODES[view].meaning.length).toBeLessThanOrEqual(64);
    });
  });

  it('keeps the View concept name', () => {
    expect(DCMSR_MEASUREMENT_VIEW).toMatchObject({ value: 'Sonador-Measurement.View', schemeDesignator: 'Sonador-SR', schemeVersion: '0.3' });
  });
});


describe('the view of a drawing view', () => {
  it('names the patient axis a normal is within 15 degrees of', () => {
    expect(VIEW_ALIGN_LIMIT_DEGREES).toBe(15);
    expect(viewOfNormal([0, 0, 1])).toBe('axial');
    expect(viewOfNormal([0, 0, -1])).toBe('axial');
    expect(viewOfNormal([0, -1, 0])).toBe('coronal');
    expect(viewOfNormal([1, 0, 0])).toBe('sagittal');
    expect(viewOfNormal([0, 0, 7])).toBe('axial');
  });

  it('is the axis view at the 15 degree limit and oblique beyond it', () => {
    expect(viewOfNormal(tiltedFromZ(15))).toBe('axial');
    expect(viewOfNormal(tiltedFromZ(14.9))).toBe('axial');
    expect(viewOfNormal(tiltedFromZ(15.1))).toBe('oblique');
    expect(viewOfNormal(tiltedFromZ(45))).toBe('oblique');
    expect(viewOfNormal(tiltedFromZ(75))).toBe('sagittal');
  });

  it('gives no view without a usable normal', () => {
    expect(viewOfNormal(undefined)).toBeUndefined();
    expect(viewOfNormal([0, 0, 0])).toBeUndefined();
    expect(viewOfNormal([0, 0])).toBeUndefined();
  });

  it('takes an image plane from its row and column directions', () => {
    expect(viewOfImageOrientation([1, 0, 0], [0, 1, 0])).toBe('axial');
    expect(viewOfImageOrientation([0, 1, 0], [0, 0, -1])).toBe('sagittal');
    expect(viewOfImageOrientation([1, 0, 0], [0, 0, -1])).toBe('coronal');
  });

  it("labels the Viewer's Length, Angle and Cobb angle, from the drawing view, else the image", () => {
    const axialImage = { rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] };
    expect(drawnViewOf('Length', { metadata: { viewPlaneNormal: [1, 0, 0] } }, axialImage)).toBe('sagittal');
    expect(drawnViewOf('Angle', { metadata: {} }, axialImage)).toBe('axial');
    expect(drawnViewOf('CobbAngle', { metadata: { viewPlaneNormal: tiltedFromZ(30) } }, axialImage)).toBe('oblique');
    expect(drawnViewOf('ArrowAnnotate', { metadata: {} }, axialImage)).toBeUndefined();
    expect(drawnViewOf('Length', { metadata: {} }, undefined)).toBeUndefined();
  });
});
