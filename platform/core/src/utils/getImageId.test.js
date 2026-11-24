// getImageId's local-versus-remote decision (ohif-viewers#125 FR-2, imaging-development-env#103):
// a cached instance, or one of a series being fetched as an archive for the session, gets a
// `sonadorlocal:` id with the remote id recorded as its fallback.

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import { clearScheduledSeries, scheduleSeries } from '../services/LocalCacheService/sessionArchiveRegistry';
import { getRemoteFallback } from '../loaders/sonadorLocalImageReader';
import getImageId from './getImageId';

global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) { this.type = type; this.detail = params.detail; }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const instance = (SOPInstanceUID, SeriesInstanceUID) => ({
  SOPInstanceUID,
  SeriesInstanceUID,
  wadouri: `https://example.invalid/wado?objectUID=${SOPInstanceUID}`,
});

afterEach(() => {
  clearScheduledSeries();
  jest.restoreAllMocks();
});

describe('getImageId', () => {
  it('returns the remote id for an instance that is neither cached nor scheduled', () => {
    expect(getImageId(instance('sop-r', 'series-r'))).toBe('dicomweb:https://example.invalid/wado?objectUID=sop-r');
  });

  it('returns a local id for a cached instance, recording the remote fallback', () => {
    jest.spyOn(LocalCacheService, 'isInstanceCachedSync').mockReturnValue(true);
    expect(getImageId(instance('sop-c', 'series-c'))).toBe('sonadorlocal:sop-c');
    expect(getRemoteFallback('sop-c')).toBe('dicomweb:https://example.invalid/wado?objectUID=sop-c');
  });

  it('returns a local id for an instance of a series scheduled for archive loading, before anything is cached', () => {
    scheduleSeries('series-s');
    expect(getImageId(instance('sop-s', 'series-s'))).toBe('sonadorlocal:sop-s');
    expect(getRemoteFallback('sop-s')).toBe('dicomweb:https://example.invalid/wado?objectUID=sop-s');
    // A frame keeps its number on the local id
    expect(getImageId(instance('sop-s', 'series-s'), 3)).toBe('sonadorlocal:sop-s?frame=3');
    // Another series of the same study is untouched
    expect(getImageId(instance('sop-o', 'series-o'))).toBe('dicomweb:https://example.invalid/wado?objectUID=sop-o');
  });

  it('gives a thumbnail of a scheduled series its remote id unless the instance is already cached', () => {
    scheduleSeries('series-t');
    expect(getImageId(instance('sop-t', 'series-t'), undefined, true)).toBe('dicomweb:https://example.invalid/wado?objectUID=sop-t');
    jest.spyOn(LocalCacheService, 'isInstanceCachedSync').mockReturnValue(true);
    expect(getImageId(instance('sop-t', 'series-t'), undefined, true)).toBe('sonadorlocal:sop-t');
  });

  it('leaves a locally loaded instance alone, scheduled or not', () => {
    scheduleSeries('series-f');
    const local = { SOPInstanceUID: 'sop-f', SeriesInstanceUID: 'series-f', getImageId: () => 'dicomfile:1' };
    expect(getImageId(local)).toBe('dicomfile:1');
  });
});
