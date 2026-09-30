// Status messages shown over a view while an action runs on what it shows

import { getActionStatus, setActionStatus, subscribeActionStatus } from './actionStatus';

describe('actionStatus', () => {
  it('sets, reports and clears a status under its key', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeActionStatus(listener);

    setActionStatus('ds', 'Converting models...');
    expect(getActionStatus('ds')).toBe('Converting models...');
    setActionStatus('ds', null);
    expect(getActionStatus('ds')).toBeNull();

    expect(listener.mock.calls).toEqual([['ds', 'Converting models...'], ['ds', null]]);
    unsubscribe();
    setActionStatus('ds', 'again');
    expect(listener).toHaveBeenCalledTimes(2);
    setActionStatus('ds', null);
  });
});
