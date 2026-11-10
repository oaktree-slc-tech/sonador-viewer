import { angle } from './angle';
import { cobbAngle } from './cobbAngle';

describe.each([['Angle', angle], ['Cobb angle', cobbAngle]])('%s measurements-table text', (name, tool) => {
  const display = tool.options.measurementTable.displayFunction;

  it.each([
    [{ rAngle: 0 }], [{ data: { rAngle: 0 } }], [{ measurementData: { rAngle: 0 } }], [{ rAngle: '0' }],
  ])('shows a valid zero, wherever it is kept (%o)', data => {
    expect(display(data)).toBe('0.00°');
  });

  it('shows a value with two decimals', () => {
    expect(display({ data: { rAngle: 135 } })).toBe('135.00°');
  });

  it.each([[{}], [{ rAngle: null }], [{ rAngle: 'Incomplete Angle' }], [{ rAngle: NaN }], [{ data: { rAngle: '' } }]])(
    'shows nothing for an absent or invalid value (%o)', data => {
      expect(display(data)).toBe('');
    });
});
