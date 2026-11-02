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
});
