// Tests for the "Sonador Platform" rows: which values share a row, and what each row says when a
// value is missing.

import buildPlatformRows from './platformRows';

const CONNECTED = {
  sonadorUrl: 'https://sonador.example.com/',
  sonadorVersion: '0.4.0',
  imagingServerUrl: 'https://pacs.example.com',
  imagingServerVersion: '1.12.4',
  cloudPluginVersion: '0.4.1',
  hasActiveServer: true,
  isLoading: false,
  error: null,
};

const rowsByName = (versions) =>
  buildPlatformRows(versions).reduce((acc, row) => ({ ...acc, [row.name]: row }), {});


describe('row grouping', () => {
  it('reports the platform in two rows, one per deployed component', () => {
    expect(buildPlatformRows(CONNECTED)).toHaveLength(2);
  });

  it('keeps each component on the same row as the address it lives at', () => {
    const rows = rowsByName(CONNECTED);

    expect(rows['Sonador Web Application'].value).toBe('0.4.0');
    expect(rows['Sonador Web Application'].detail).toBe('https://sonador.example.com/');
    expect(rows['Sonador Web Application'].detailLink).toBe('https://sonador.example.com/');

    expect(rows['Imaging Server'].detail).toBe('https://pacs.example.com');
    expect(rows['Imaging Server'].detailLink).toBe('https://pacs.example.com');
  });

  it('combines the Orthanc and cloud plugin versions onto one row, each one named', () => {
    // Separate segments so the renderer can space them apart; HTML collapses padding in a string.
    expect(rowsByName(CONNECTED)['Imaging Server'].value).toEqual([
      'Orthanc 1.12.4',
      'Sonador Cloud Plugin 0.4.1',
    ]);
  });

  it('keeps the two as separate segments so they can be spaced apart when rendered', () => {
    // They share a row but are separate pieces of software. Joined into one string the renderer
    // could not put real horizontal space between them -- HTML would collapse it.
    const value = rowsByName(CONNECTED)['Imaging Server'].value;

    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(2);
  });
});


describe('missing values', () => {
  it('never leaves a cell blank', () => {
    buildPlatformRows({}).forEach((row) => {
      expect(row.name).toBeTruthy();

      const segments = Array.isArray(row.value) ? row.value : [row.value];
      segments.forEach((segment) => expect(segment).toBeTruthy());
    });
  });

  it('distinguishes a server with no Sonador plugin from one that never answered', () => {
    const withoutPlugin = rowsByName({ ...CONNECTED, cloudPluginVersion: undefined });
    const unreachable = rowsByName({ ...CONNECTED, error: new Error('HTTP 502'), imagingServerVersion: undefined, cloudPluginVersion: undefined });

    expect(withoutPlugin['Imaging Server'].value).toEqual([
      'Orthanc 1.12.4',
      'Sonador Cloud Plugin not reported',
    ]);
    expect(unreachable['Imaging Server'].value).toBe('Unavailable');
  });

  it('still gives out the imaging server address when the server could not be reached', () => {
    const rows = rowsByName({ ...CONNECTED, error: new Error('HTTP 502') });

    expect(rows['Imaging Server'].detail).toBe('https://pacs.example.com');
  });

  it('says the report is in flight rather than reporting a version that has not arrived', () => {
    const rows = rowsByName({
      ...CONNECTED,
      isLoading: true,
      imagingServerVersion: undefined,
      cloudPluginVersion: undefined,
    });

    expect(rows['Imaging Server'].value).toBe('Loading…');
  });

  it('offers no imaging server address when there is no active server', () => {
    const rows = rowsByName({ ...CONNECTED, hasActiveServer: false });

    expect(rows['Imaging Server'].value).toBe('No active imaging server');
    expect(rows['Imaging Server'].detail).toBeUndefined();
  });

  it('reports a web application that predates the version setting rather than guessing', () => {
    const rows = rowsByName({ ...CONNECTED, sonadorVersion: undefined });

    expect(rows['Sonador Web Application'].value).toBe('Not reported');
    // The URL is still known, so it is still given.
    expect(rows['Sonador Web Application'].detail).toBe('https://sonador.example.com/');
  });
});


describe('translation', () => {
  it('routes every label through the provided translator', () => {
    const t = jest.fn((text) => `[${text}]`);

    const rows = buildPlatformRows(CONNECTED, t);

    expect(rows[0].name).toBe('[Sonador Web Application]');
    expect(rows[1].name).toBe('[Imaging Server]');
  });

  it('leaves the product names inside the combined value untranslated', () => {
    // "Orthanc" and "Sonador Cloud Plugin" are product names, not copy.
    const rows = buildPlatformRows(CONNECTED, (text) => `[${text}]`);

    expect(rows[1].value).toEqual(['Orthanc 1.12.4', 'Sonador Cloud Plugin 0.4.1']);
  });
});
