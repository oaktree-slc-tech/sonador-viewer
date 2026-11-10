// The save result names each measurement the report left out and what to do about it.

import { lockSavedMeasurements, measurementVersion, omittedMeasurement, saveResultSummary } from './saveResult';

const refusal = code => Object.assign(new Error('internal: handles start, end, start2, end2 are required'), { code });

it('reports a full save as a success', () => {
  expect(saveResultSummary([], 'Sonador')).toEqual({
    title: 'Measurements saved successfully', message: 'Data persisted to Sonador.', type: 'success', omitted: [],
  });
});

it('reports a partial save as a warning naming the tool, its label and the fix, without internal details', () => {
  const omitted = [
    omittedMeasurement('CobbAngle', { label: 'Hip abduction' }, refusal('degenerate')),
    omittedMeasurement('Angle', {}, refusal('uncalibrated')),
  ];
  const result = saveResultSummary(omitted, 'Sonador');

  expect(result.type).toBe('warning');
  expect(result.title).toBe('Measurements partly saved');
  expect(result.message).toContain('Data persisted to Sonador. 2 measurements were not saved.');
  expect(result.message).toContain('Cobb angle "Hip abduction": move its endpoints apart so that each line has a length.');
  expect(result.message).toContain('Angle: its image calibration is missing or invalid, so the angle cannot be measured in degrees; draw it on a calibrated image.');
  expect(result.message).not.toContain('handles');
  expect(result.omitted).toEqual([
    { toolType: 'CobbAngle', label: 'Hip abduction', reason: 'degenerate' },
    { toolType: 'Angle', label: '', reason: 'uncalibrated' },
  ]);
});

it('tells the user to complete an incomplete measurement', () => {
  const result = saveResultSummary([omittedMeasurement('Angle', { description: 'Knee' }, refusal('incomplete'))]);
  expect(result.message).toBe('Data persisted. One measurement was not saved. Angle "Knee": complete it, or delete it and draw it again.');
});


describe('the outcome by number of measurements written', () => {
  const degenerate = omittedMeasurement('CobbAngle', { label: 'Hip abduction' }, refusal('degenerate'));
  const uncalibrated = omittedMeasurement('Angle', {}, refusal('uncalibrated'));

  it('full: nothing left out', () => {
    expect(saveResultSummary({ omitted: [], saved: 2 }, 'Sonador')).toMatchObject({ title: 'Measurements saved successfully', type: 'success' });
  });

  it('mixed: some written, some left out', () => {
    expect(saveResultSummary({ omitted: [degenerate], saved: 1 }, 'Sonador'))
      .toMatchObject({ title: 'Measurements partly saved', type: 'warning', saved: 1 });
  });

  it('sole measurement refused: nothing stored, nothing claimed', () => {
    const result = saveResultSummary({ omitted: [degenerate], saved: 0 }, 'Sonador');
    expect(result).toMatchObject({ title: 'Measurements not saved', type: 'error', saved: 0 });
    expect(result.message).toBe('The measurement was not saved. Nothing was stored. '
      + 'Cobb angle "Hip abduction": move its endpoints apart so that each line has a length.');
    expect(result.message).not.toContain('persisted');
  });

  it('all refused: nothing stored, each named', () => {
    const result = saveResultSummary({ omitted: [degenerate, uncalibrated], saved: 0 }, 'Sonador');
    expect(result).toMatchObject({ title: 'Measurements not saved', type: 'error' });
    expect(result.message).toContain('None of the 2 measurements was saved. Nothing was stored.');
    expect(result.message).toContain('Angle: its image calibration is missing or invalid');
  });
});


describe('lockSavedMeasurements', () => {
  const SESSION = 4;
  const stored = () => ({
    uid: 'a', label: 'Hip', description: 'Left', isDirty: true, referencedImageId: 'wadors:image-1', SOPInstanceUID: '2.25.900',
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    data: { rAngle: 135, handles: { start: { x: 1, y: 2, highlight: false } } },
    metadata: { TrackingUniqueIdentifier: '2.25.1', location: 'Bone', displayAttributes: { Color: { Border: '#FF8800' } } },
  });
  const serviceOf = measurement => ({
    getMeasurement: uid => (measurement && measurement.uid === uid ? measurement : undefined),
    update: jest.fn(),
  });
  const versionOf = measurement => measurementVersion(measurement, undefined, SESSION);

  it('locks the stored version, clean and read-only, keeping its other attributes', () => {
    const measurement = stored();
    const service = serviceOf(measurement);
    expect(lockSavedMeasurements(service, [versionOf(measurement)], { session: SESSION })).toBe(1);
    expect(service.update).toHaveBeenCalledWith('a', {
      ...measurement, isLocked: true, isDirty: false,
      metadata: { ...measurement.metadata, isReadOnly: true, isLocked: true, isDirty: false },
    }, true);
  });

  it('locks it after changes that are not persisted: hover, selection, visibility, a refreshed record, its key order', () => {
    const version = versionOf(stored());
    const current = stored();
    current.data.handles.start.highlight = true;
    Object.assign(current, { isSelected: true, isVisible: false, modifiedTimestamp: 99, displayText: ['135°'], source: { name: 'x' } });
    const reordered = { metadata: current.metadata, ...current };
    expect(lockSavedMeasurements(serviceOf(reordered), [version], { session: SESSION })).toBe(1);
  });

  it.each([
    ['a moved point', m => { m.points[1] = { x: 30, y: 4 }; }],
    ['a new label', m => { m.label = 'Knee'; }],
    ['a new description', m => { m.description = 'Right'; }],
    ['a new location', m => { m.metadata.location = 'Joint'; }],
    ['a new colour', m => { m.metadata.displayAttributes.Color.Border = '#00FF00'; }],
    ['another image, same image points', m => { m.referencedImageId = 'wadors:image-2'; m.SOPInstanceUID = '2.25.901'; }],
    ['a new value', m => { m.data.rAngle = 120; }],
  ])('leaves a measurement with %s since the report was encoded pending', (name, change) => {
    const version = versionOf(stored());
    const changed = stored();
    change(changed);
    const service = serviceOf(changed);
    expect(lockSavedMeasurements(service, [version], { session: SESSION })).toBe(0);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('locks nothing from a session that has ended, even a record keeping the tracking UID', () => {
    const version = versionOf(stored());
    const replacement = { ...stored(), uid: 'b' };
    const sameRecord = serviceOf(stored());
    expect(lockSavedMeasurements(sameRecord, [version], { session: SESSION + 1 })).toBe(0);
    expect(lockSavedMeasurements(serviceOf(replacement), [version], { session: SESSION })).toBe(0);
    expect(sameRecord.update).not.toHaveBeenCalled();
  });

  it('locks nothing when the measurement left the session', () => {
    expect(lockSavedMeasurements(serviceOf(undefined), [versionOf(stored())], { session: SESSION })).toBe(0);
    expect(lockSavedMeasurements(undefined, [versionOf(stored())], { session: SESSION })).toBe(0);
  });
});
