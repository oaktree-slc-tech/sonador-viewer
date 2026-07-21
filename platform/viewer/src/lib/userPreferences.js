// Pure version-resolution logic for the Sonador User Preferences documents (sonador#42
// FR-10/FR-18, §5.4 item 9). No React, no I/O -- testable as a plain module (AR-7).
//
// Preference documents are keyed by "<major>.<minor>" release (AR-2), e.g.:
//   { "0.3": { hotkeys: {...} }, "0.4": { hotkeys: {...}, general: {...} } }
//
// For a given section: use the current version's values when present; otherwise backfill
// from the numerically most recent OLDER version that carries the section (newer versions
// are never read); otherwise fall back to the built-in defaults with one console warning.

const VERSION_RE = /^\d+\.\d+$/;

export const RESOLVED_FROM_CURRENT = 'current';
export const RESOLVED_FROM_DEFAULTS = 'defaults';
export const backfillSource = (version) => `backfill:${version}`;

export const parseVersion = (version) => {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    return null;
  }
  const [major, minor] = version.split('.');
  return [parseInt(major, 10), parseInt(minor, 10)];
};

export const compareVersions = (a, b) => {
  // Numeric major.minor comparison: "0.10" > "0.9", "10.2" > "9.9".
  const [aMajor, aMinor] = parseVersion(a) || [-1, -1];
  const [bMajor, bMinor] = parseVersion(b) || [-1, -1];
  return aMajor - bMajor || aMinor - bMinor;
};

const hasValues = (values) =>
  !!values && typeof values === 'object' && Object.keys(values).length > 0;

const olderVersionsOf = (document, version) => {
  // Version keys of `document` numerically older than `version`, most recent first.
  return Object.keys(document || {})
    .filter((key) => parseVersion(key) && compareVersions(key, version) < 0)
    .sort(compareVersions)
    .reverse();
};

export const resolveSection = (document, section, version) => {
  // Resolve one section of a versioned preference document (FR-10).
  //
  // @input document (object): versioned document (`UserPref.viewer` shape), may be null.
  // @input section (str): section key inside the version documents.
  // @input version (str): current release version, e.g. `0.4`.
  // @returns { values, resolvedFrom } where `resolvedFrom` is `current`,
  //   `backfill:<v>`, or `defaults` (`values` is null on the defaults path -- the caller
  //   keeps the locally cached / built-in state in effect).

  const doc = document && typeof document === 'object' ? document : {};

  const current = (doc[version] || {})[section];
  if (hasValues(current)) {
    return { values: current, resolvedFrom: RESOLVED_FROM_CURRENT };
  }

  for (const older of olderVersionsOf(doc, version)) {
    const values = (doc[older] || {})[section];
    if (hasValues(values)) {
      return { values, resolvedFrom: backfillSource(older) };
    }
  }

  console.warn(
    `User preferences: no stored values for section "${section}" (version ${version}); using built-in defaults.`
  );
  return { values: null, resolvedFrom: RESOLVED_FROM_DEFAULTS };
};

export const resolveStudylistInterfaces = (document, interfaces, version) => {
  // Per-interface resolution of the `UserPref.studylist` document with the same FR-10
  // semantics (FR-18): each interface independently resolves current -> backfill ->
  // defaults (one console warning per missing interface).
  //
  // @returns map of interface key -> { values, resolvedFrom }

  const resolved = {};
  for (const interfaceKey of interfaces) {
    resolved[interfaceKey] = resolveSection(document, interfaceKey, version);
  }
  return resolved;
};
