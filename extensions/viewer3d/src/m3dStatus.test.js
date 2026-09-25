// Status messages shown over an M3D viewport (ohif-viewers#143)

import { getM3DStatus, setM3DStatus, subscribeM3DStatus } from './m3dStatus';

describe('m3dStatus', () => {
  it('sets, reports and clears a display set\'s status', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeM3DStatus(listener);

    setM3DStatus('ds', 'Converting models...');
    expect(getM3DStatus('ds')).toBe('Converting models...');
    setM3DStatus('ds', null);
    expect(getM3DStatus('ds')).toBeNull();

    expect(listener.mock.calls).toEqual([['ds', 'Converting models...'], ['ds', null]]);
    unsubscribe();
    setM3DStatus('ds', 'again');
    expect(listener).toHaveBeenCalledTimes(2);
    setM3DStatus('ds', null);
  });
});
