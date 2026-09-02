// Selector reference stability.
//
// react-redux calls a selector twice with the same state on each consumer's first run and warns if
// the two results are not referentially equal ("Selector <name> returned a different result when
// called with the same parameters"). Beyond the console noise -- one line per mounted consumer,
// which on a busy study list is one per row and per thumbnail -- an unstable selector makes
// useSelector re-render its component on every store notification, whether or not anything it reads
// actually changed.

// `api/sonador.js` reaches the `../utils` barrel for one helper, and that barrel initialises
// Mousetrap at import time, which needs a DOM. Only the barrel is replaced, so the real
// `getActiveServer` still runs -- its reference stability is what these memos rely on.
jest.mock('../utils', () => ({ urlUtil: {} }));

import { activeOhifServer, getActiveViewportData, serverCount } from './selectors';

const SERVER_A = { name: 'a', active: true };
const SERVER_B = { name: 'b', active: false };

function serverState(servers) {
  return { servers: { servers } };
}

function viewportState(viewportSpecificData, activeViewportIndex) {
  return { viewports: { viewportSpecificData, activeViewportIndex } };
}

describe('activeOhifServer', () => {
  it('returns the same reference for the same state', () => {
    const state = serverState([SERVER_A, SERVER_B]);

    // This is exactly the comparison react-redux makes on a consumer's first run.
    expect(activeOhifServer(state)).toBe(activeOhifServer(state));
  });

  it('returns the same reference across distinct state objects with the same active server', () => {
    // A store update elsewhere produces a new state object; the active server is unchanged, so
    // consumers of this selector must not be re-rendered.
    expect(activeOhifServer(serverState([SERVER_A, SERVER_B])))
      .toBe(activeOhifServer(serverState([SERVER_A, SERVER_B])));
  });

  it('returns a new reference when the active server changes', () => {
    const before = activeOhifServer(serverState([SERVER_A, SERVER_B]));
    const after = activeOhifServer(serverState([{ ...SERVER_A, active: false }, { ...SERVER_B, active: true }]));

    expect(after).not.toBe(before);
    expect(after.activeServer.name).toBe('b');
  });

  it('still reports the active server', () => {
    expect(activeOhifServer(serverState([SERVER_A, SERVER_B])).activeServer).toBe(SERVER_A);
  });

  it('reports no active server for an empty server list', () => {
    expect(activeOhifServer(serverState([])).activeServer).toBeUndefined();
  });

  it('still throws when the server list is not an array (unchanged behaviour)', () => {
    // getActiveServer's own contract, left alone: memoising must not swallow it.
    expect(() => activeOhifServer({})).toThrow('server list is not an array');
  });
});

describe('getActiveViewportData', () => {
  const viewportSpecificData = { 0: { plugin: 'vtk' } };

  it('returns the same reference while the viewport data and index are unchanged', () => {
    const state = viewportState(viewportSpecificData, 0);

    expect(getActiveViewportData(state)).toBe(getActiveViewportData(state));
    expect(getActiveViewportData(viewportState(viewportSpecificData, 0)))
      .toBe(getActiveViewportData(viewportState(viewportSpecificData, 0)));
  });

  it('returns a new reference when the active viewport changes', () => {
    const before = getActiveViewportData(viewportState(viewportSpecificData, 0));
    const after = getActiveViewportData(viewportState(viewportSpecificData, 1));

    expect(after).not.toBe(before);
    expect(after.activeViewportIndex).toBe(1);
  });

  it('returns a new reference when the viewport data changes', () => {
    const before = getActiveViewportData(viewportState(viewportSpecificData, 0));
    const after = getActiveViewportData(viewportState({ 0: { plugin: 'cornerstone' } }, 0));

    expect(after).not.toBe(before);
  });
});

describe('serverCount', () => {
  it('counts registered servers and tolerates an empty state', () => {
    expect(serverCount(serverState([SERVER_A, SERVER_B]))).toBe(2);
    expect(serverCount({})).toBeUndefined();
  });
});
