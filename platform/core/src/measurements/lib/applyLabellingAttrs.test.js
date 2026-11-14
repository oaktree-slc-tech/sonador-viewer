import applyLabellingAttrs from './applyLabellingAttrs';

describe('applyLabellingAttrs', () => {
  it('writes only the fields an edit supplies', () => {
    const measurement = { location: 'Bone', description: 'Original description', response: 'R', text: 'T' };

    applyLabellingAttrs(measurement, { location: 'Liver', locationLabel: 'Liver' });
    expect(measurement).toEqual({ location: 'Liver', description: 'Original description', response: 'R', text: 'T' });

    applyLabellingAttrs(measurement, { description: 'Saved replacement' });
    expect(measurement).toEqual({ location: 'Liver', description: 'Saved replacement', response: 'R', text: 'T' });
  });

  it('clears a field set to an empty string or null, and ignores a missing edit', () => {
    const measurement = { location: 'Bone', description: 'Original description' };
    applyLabellingAttrs(measurement, { description: '' });
    applyLabellingAttrs(measurement, { location: null });
    applyLabellingAttrs(measurement, undefined);
    expect(measurement).toEqual({ location: '', description: '' });
  });

  it("leaves an arrow's text and Sonador-Measurement.Text as they are", () => {
    const arrow = { toolType: 'ArrowAnnotate', text: 'Lesion margin', label: 'Lesion margin', metadata: { measurementText: 'Text' } };
    applyLabellingAttrs(arrow, { location: 'Lung', description: 'Arrow description' });
    expect(arrow).toMatchObject({ text: 'Lesion margin', label: 'Lesion margin', location: 'Lung', description: 'Arrow description' });
    expect(arrow.metadata.measurementText).toBe('Text');
  });
});
