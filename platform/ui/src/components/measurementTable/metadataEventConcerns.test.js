import { metadataEventConcerns, subscribeSeriesMetadata } from './metadataEventConcerns';

describe('metadataEventConcerns', () => {
  it('refreshes for summary metadata that includes the series', () => {
    expect(metadataEventConcerns({ seriesSummaryMetadata: [{ SeriesInstanceUID: 'a' }, { SeriesInstanceUID: 'b' }] }, 'b')).toBe(true);
    expect(metadataEventConcerns({ seriesSummaryMetadata: [{ SeriesInstanceUID: 'a' }] }, 'b')).toBe(false);
  });

  it('refreshes for instances or updates of the series only', () => {
    expect(metadataEventConcerns({ SeriesInstanceUID: 'b' }, 'b')).toBe(true);
    expect(metadataEventConcerns({ SeriesInstanceUID: 'a' }, 'b')).toBe(false);
  });

  it('refreshes for events that do not name a series', () => {
    expect(metadataEventConcerns(undefined, 'b')).toBe(true);
    expect(metadataEventConcerns({ StudyInstanceUID: 's' }, 'b')).toBe(true);
  });
});

describe('subscribeSeriesMetadata', () => {
  const EVENTS = {
    SERIES_ADDED: 'seriesAdded',
    SERIES_UPDATED: 'seriesUpdated',
    INSTANCES_ADDED: 'instancesAdded',
    INSTANCE_ADDED: 'instanceAdded',
  };
  const fakeStore = () => {
    const listeners = {};
    return {
      EVENTS,
      listeners,
      subscribe: (name, callback) => {
        listeners[name] = (listeners[name] || []).concat(callback);
        return { unsubscribe: () => { listeners[name] = listeners[name].filter(cb => cb !== callback); } };
      },
      emit: (name, event) => (listeners[name] || []).forEach(callback => callback(event)),
    };
  };

  it('subscribes to series and instance additions, including single instances', () => {
    const store = fakeStore();
    subscribeSeriesMetadata(store, 'b', () => {});
    expect(Object.keys(store.listeners).sort()).toEqual(Object.values(EVENTS).sort());
  });

  it('calls back for a single instance of the series and ignores other series', () => {
    const store = fakeStore();
    const onChange = jest.fn();
    subscribeSeriesMetadata(store, 'b', onChange);

    store.emit(EVENTS.INSTANCE_ADDED, { StudyInstanceUID: 's', SeriesInstanceUID: 'b', SOPInstanceUID: 'i' });
    store.emit(EVENTS.INSTANCE_ADDED, { StudyInstanceUID: 's', SeriesInstanceUID: 'a', SOPInstanceUID: 'j' });
    store.emit(EVENTS.INSTANCES_ADDED, { StudyInstanceUID: 's', SeriesInstanceUID: 'b' });
    store.emit(EVENTS.SERIES_ADDED, { seriesSummaryMetadata: [{ SeriesInstanceUID: 'a' }] });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('removes every subscription on cleanup', () => {
    const store = fakeStore();
    const onChange = jest.fn();
    const unsubscribe = subscribeSeriesMetadata(store, 'b', onChange);
    unsubscribe();

    store.emit(EVENTS.INSTANCE_ADDED, { SeriesInstanceUID: 'b' });
    expect(onChange).not.toHaveBeenCalled();
    expect(Object.values(store.listeners).every(callbacks => callbacks.length === 0)).toBe(true);
  });

  it('is a no-op for a store without events', () => {
    expect(subscribeSeriesMetadata(null, 'b', () => {})).toEqual(expect.any(Function));
    expect(subscribeSeriesMetadata({}, 'b', () => {})).toEqual(expect.any(Function));
  });
});
