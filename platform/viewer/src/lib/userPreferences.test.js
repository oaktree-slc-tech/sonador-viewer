// Unit tests for the FR-10/FR-18 version resolver (sonador#42) -- pure module, no React.

import {
  RESOLVED_FROM_CURRENT,
  RESOLVED_FROM_DEFAULTS,
  backfillSource,
  compareVersions,
  parseVersion,
  resolveSection,
  resolveStudylistInterfaces,
} from './userPreferences';

describe('parseVersion / compareVersions', () => {
  it('parses major.minor version keys', () => {
    expect(parseVersion('0.4')).toEqual([0, 4]);
    expect(parseVersion('10.12')).toEqual([10, 12]);
  });

  it('rejects malformed version keys', () => {
    expect(parseVersion('0.4.1')).toBeNull();
    expect(parseVersion('v0.4')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares numerically, not lexicographically', () => {
    expect(compareVersions('0.10', '0.9')).toBeGreaterThan(0);
    expect(compareVersions('10.0', '9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.4', '0.4')).toBe(0);
    expect(compareVersions('0.3', '0.4')).toBeLessThan(0);
  });
});

describe('resolveSection (FR-10)', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the current version values when present', () => {
    const document = {
      '0.3': { general: { language: 'de' } },
      '0.4': { general: { language: 'en-US' } },
    };

    expect(resolveSection(document, 'general', '0.4')).toEqual({
      values: { language: 'en-US' },
      resolvedFrom: RESOLVED_FROM_CURRENT,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('backfills from the numerically most recent OLDER version carrying the section', () => {
    const document = {
      '0.2': { hotkeys: { zoom: { label: 'Zoom', keys: ['x'] } } },
      '0.3': { hotkeys: { zoom: { label: 'Zoom', keys: ['z'] } } },
      '0.10': { hotkeys: { zoom: { label: 'Zoom', keys: ['q'] } } },
      '0.4': { general: { language: 'en-US' } },
    };

    // 0.10 is NEWER than 0.4 and must be ignored; 0.3 wins over 0.2.
    expect(resolveSection(document, 'hotkeys', '0.4')).toEqual({
      values: { zoom: { label: 'Zoom', keys: ['z'] } },
      resolvedFrom: backfillSource('0.3'),
    });
  });

  it('skips older versions that do not carry the section', () => {
    const document = {
      '0.2': { windowLevel: { 1: { description: 'Bone', window: '2500', level: '480' } } },
      '0.3': { general: { language: 'de' } },
    };

    expect(resolveSection(document, 'windowLevel', '0.4')).toEqual({
      values: { 1: { description: 'Bone', window: '2500', level: '480' } },
      resolvedFrom: backfillSource('0.2'),
    });
  });

  it('falls back to defaults with one console warning when nothing is stored', () => {
    expect(resolveSection({}, 'general', '0.4')).toEqual({
      values: null,
      resolvedFrom: RESOLVED_FROM_DEFAULTS,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('"general"');
  });

  it('treats an empty section object as absent', () => {
    const document = { '0.4': { general: {} }, '0.3': { general: { language: 'de' } } };

    expect(resolveSection(document, 'general', '0.4')).toEqual({
      values: { language: 'de' },
      resolvedFrom: backfillSource('0.3'),
    });
  });

  it('tolerates null and malformed documents', () => {
    expect(resolveSection(null, 'general', '0.4').resolvedFrom).toBe(RESOLVED_FROM_DEFAULTS);
    expect(resolveSection(undefined, 'general', '0.4').resolvedFrom).toBe(RESOLVED_FROM_DEFAULTS);
    expect(resolveSection({ legacyFlat: true }, 'general', '0.4').resolvedFrom).toBe(RESOLVED_FROM_DEFAULTS);
  });
});

describe('resolveStudylistInterfaces (FR-18)', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves each interface independently: current, backfill, and defaults', () => {
    const document = {
      '0.3': {
        worklist: { selectedColumns: ['PatientName'], columnOrder: ['PatientName'] },
        shared: { selectedColumns: ['StudyDate'], columnOrder: ['StudyDate'] },
      },
      '0.4': {
        worklist: { selectedColumns: ['Status'], columnOrder: ['Status'] },
      },
    };

    const resolved = resolveStudylistInterfaces(document, ['worklist', 'shared', 'upload'], '0.4');

    expect(resolved.worklist).toEqual({
      values: { selectedColumns: ['Status'], columnOrder: ['Status'] },
      resolvedFrom: RESOLVED_FROM_CURRENT,
    });
    expect(resolved.shared).toEqual({
      values: { selectedColumns: ['StudyDate'], columnOrder: ['StudyDate'] },
      resolvedFrom: backfillSource('0.3'),
    });
    expect(resolved.upload).toEqual({ values: null, resolvedFrom: RESOLVED_FROM_DEFAULTS });

    // One warning per missing interface only.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('"upload"');
  });
});
