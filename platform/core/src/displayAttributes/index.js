// Display attributes: properties which control how a resource is rendered in the viewer. The
// shared element is the color-role contract (`Background`, `Border`, `Value`, `Meaning`, hexadecimal sRGB);
// each source wraps it differently: a tag `Meta` document (`DisplayAttributes.Color`), the per-tool
// site defaults (`<tool>.Color`), a finding's `displayAttributes.Color`, and the SR containers.
// The servers validate their inputs; this module normalizes without rejecting, dropping unknown
// roles and invalid colors.

import { data as dcmjsData } from 'dcmjs';

const { Colors } = dcmjsData;

export const DISPLAY_ATTRIBUTES = 'DisplayAttributes';
export const DISPLAY_ATTRIBUTE_COLOR = 'Color';
export const DISPLAY_COLOR_ROLES = Object.freeze(['Background', 'Border', 'Value', 'Meaning']);

export const SERIES_TAG_TOOL = 'DICOMSRSeriesTagTool';

// Built-in display profile, used when the site defaults are unavailable
export const SERIES_TAG_DEFAULT_COLOR = Object.freeze({ Background: null, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' });
export const BUILT_IN_DISPLAY_ATTRIBUTES = Object.freeze({
  [SERIES_TAG_TOOL]: Object.freeze({ [DISPLAY_ATTRIBUTE_COLOR]: SERIES_TAG_DEFAULT_COLOR }),
});

const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * Canonical upper-case `#RRGGBB` form of a hexadecimal sRGB color.
 * @returns {string|null} null for an unset or invalid value
 */
export function normalizeHexColor(value) {
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value.trim())) {
    return null;
  }

  let hex = value.trim().slice(1);
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  return `#${hex.toUpperCase()}`;
}

export const isHexColor = value => normalizeHexColor(value) !== null;

/**
 * Normalized color roles from a `Color` object; unknown roles and invalid colors are dropped.
 */
export function normalizeColor(color) {
  const normalized = {};
  if (!color || typeof color !== 'object') {
    return normalized;
  }

  DISPLAY_COLOR_ROLES.forEach(role => {
    const hex = normalizeHexColor(color[role]);
    if (hex) {
      normalized[role] = hex;
    }
  });
  return normalized;
}

/**
 * `Color` object from any display attribute carrier: a `Meta` document, a `DisplayAttributes`
 * payload, or a measurement/annotation with a `displayAttributes` property.
 */
export function getDisplayColor(carrier) {
  if (!carrier || typeof carrier !== 'object') {
    return {};
  }

  const displayAttributes = carrier[DISPLAY_ATTRIBUTES] || carrier.displayAttributes || carrier;
  return normalizeColor(displayAttributes && displayAttributes[DISPLAY_ATTRIBUTE_COLOR]);
}

// Site defaults, keyed by tool name

let siteDisplayAttributes = null;
const listeners = new Set();

/**
 * Apply the site defaults delivered with the user preferences (`site.displayAttributes`).
 */
export function setSiteDisplayAttributes(document) {
  const next = {};
  if (document && typeof document === 'object') {
    Object.keys(document).forEach(tool => {
      const color = normalizeColor(document[tool] && document[tool][DISPLAY_ATTRIBUTE_COLOR]);
      next[tool] = { [DISPLAY_ATTRIBUTE_COLOR]: color };
    });
  }

  siteDisplayAttributes = Object.keys(next).length ? next : null;
  listeners.forEach(listener => {
    try {
      listener(siteDisplayAttributes);
    } catch (error) {
      console.error('Display attributes: site defaults listener failed', error);
    }
  });
}

export const getSiteDisplayAttributes = () => siteDisplayAttributes;

export function subscribeSiteDisplayAttributes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A tag level that sets `Value` but not `Meaning` colors the meaning with its value color
const tagLevelColor = color => {
  const normalized = normalizeColor(color);
  if (normalized.Value && !normalized.Meaning) {
    normalized.Meaning = normalized.Value;
  }
  return normalized;
};

/**
 * Default colors of a tool: the site defaults over the built-in profile.
 */
export function getDefaultDisplayColor(tool = SERIES_TAG_TOOL) {
  return resolveDisplayColor(tool);
}

/**
 * Resolve each color role, first match wins: the provided tag levels in order, the site defaults,
 * then the built-in profile. `Background` resolves to null (no fill) when no level sets it.
 */
export function resolveDisplayColor(tool = SERIES_TAG_TOOL, ...levels) {
  const site = siteDisplayAttributes && siteDisplayAttributes[tool];
  const builtIn = BUILT_IN_DISPLAY_ATTRIBUTES[tool];
  const chain = [
    ...levels.map(tagLevelColor),
    normalizeColor(site && site[DISPLAY_ATTRIBUTE_COLOR]),
    normalizeColor(builtIn && builtIn[DISPLAY_ATTRIBUTE_COLOR]),
  ];

  const resolved = {};
  DISPLAY_COLOR_ROLES.forEach(role => {
    const level = chain.find(color => color[role]);
    resolved[role] = level ? level[role] : null;
  });
  return resolved;
}

/**
 * Colors of a saved finding. A finding with stored colors keeps its own background: no stored
 * background means no fill, whatever the current defaults. A finding without stored colors
 * (written before display attributes existed) follows the current defaults.
 */
export function resolveFindingColor(tool, carrier) {
  const stored = getDisplayColor(carrier);
  if (!Object.keys(stored).length) {
    return resolveDisplayColor(tool);
  }

  return { ...resolveDisplayColor(tool, stored), Background: stored.Background || null };
}

/**
 * Measurement `displayAttributes` value: the resolved colors of the tool for a tag `Meta` document.
 */
export function resolveDisplayAttributes(tool, meta) {
  return { [DISPLAY_ATTRIBUTE_COLOR]: resolveDisplayColor(tool, getDisplayColor(meta)) };
}

// DICOM CIELab (PS3.3 C.10.7.1.1: L* 0..100 and a*/b* -128..127 scaled to 0..65535)

/**
 * @returns {number[]|null} `[L, a, b]` as unsigned 16-bit integers
 */
export function hexToDicomLab(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return null;
  }

  const rgb = [1, 3, 5].map(i => parseInt(normalized.slice(i, i + 2), 16) / 255);
  return Colors.rgb2DICOMLAB(rgb).map(v => Math.min(65535, Math.max(0, Math.round(v))));
}

/**
 * @input lab (number[] or string): `[L, a, b]` or the `L\a\b` string form
 * @returns {string|null} `#RRGGBB`
 */
export function dicomLabToHex(lab) {
  const values = (typeof lab === 'string' ? lab.split('\\') : lab || []).map(Number);
  if (values.length !== 3 || values.some(v => !Number.isFinite(v) || v < 0 || v > 65535)) {
    return null;
  }

  const rgb = Colors.dicomlab2RGB(values).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const displayAttributes = {
  DISPLAY_ATTRIBUTES,
  DISPLAY_ATTRIBUTE_COLOR,
  DISPLAY_COLOR_ROLES,
  SERIES_TAG_TOOL,
  SERIES_TAG_DEFAULT_COLOR,
  BUILT_IN_DISPLAY_ATTRIBUTES,
  normalizeHexColor,
  isHexColor,
  normalizeColor,
  getDisplayColor,
  setSiteDisplayAttributes,
  getSiteDisplayAttributes,
  subscribeSiteDisplayAttributes,
  getDefaultDisplayColor,
  resolveDisplayColor,
  resolveFindingColor,
  resolveDisplayAttributes,
  hexToDicomLab,
  dicomLabToHex,
};

export default displayAttributes;
