// Session holder for the user's `general` preferences that no other service holds (the download
// queue holds its own two, i18n holds the language). The preference document is the record: this
// keeps only the value a feature reads when it runs, hydrated from the document at startup and set
// on the user's behalf when they change it -- from the Settings page or from the feature itself,
// as a "don't ask again" checkbox does.
//
// Persistence is wired in by the viewer (`setPersistence`), which owns the write queue and the
// section's full key set: a section POST replaces the section wholesale, so a write made from here
// has to carry the other holders' values too.
//
// A key the server does not accept yet is LOCAL-ONLY: the server's general-section allowlist
// (sonador `GeneralPrefForm`) refuses a section carrying an unknown key with a 400, which would
// fail every General save, not just this key's. A local-only key is therefore left out of the
// section values and kept in this browser's storage instead. Once the server accepts it, take it
// out of LOCAL_ONLY_KEYS: hydration then reads the document, and a value this browser stored
// carries over as the first server value (a document without the key falls back to it).

import { PubSubService } from '../_shared/pubSubServiceInterface';


const EVENTS = {
  // A general preference held here changed: `{ key, value, hydrated }`. Hydration and user
  // choice both announce, so a form showing the value can follow the startup fetch.
  GENERAL_CHANGED: 'event::userPreferencesService:generalChanged',
};

// Open as Segmentation says which locked models it leaves out before the editor opens. The
// dialog's "don't ask again" turns this off; the Settings page turns it back on.
export const LOCKED_MODELS_WARNING_PREFERENCE_KEY = 'warnLockedModelsOnOpenAsSegmentation';

// The colour the Segmentation Editor draws a pending 3D edit in (its preview): Blender's
// edit-mode selection orange by default, so a change awaiting Apply stands out from any segment.
export const SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY = 'segEditorPreviewColor';
export const SEG_EDITOR_PREVIEW_COLOR_DEFAULT = '#ff8500';

// The keys held here and their defaults, which also fix each key's type: a stored value of another
// type (a document edited by hand, or written by another release) is read as the default.
const GENERAL_DEFAULTS = Object.freeze({
  [LOCKED_MODELS_WARNING_PREFERENCE_KEY]: true,
  [SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY]: SEG_EDITOR_PREVIEW_COLOR_DEFAULT,
});

// Values a key accepts beyond its default's type
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const VALIDATORS = Object.freeze({
  [SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY]: value => HEX_COLOR.test(value),
});

// Keys the server does not accept yet (see above): kept in this browser, not in the section POST
const LOCAL_ONLY_KEYS = new Set([SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY]);

// Where a local-only value is kept in the browser's storage
const LOCAL_STORAGE_PREFIX = 'sonador.preferences.general.';

function _isValid(key, value) {
  const fallback = GENERAL_DEFAULTS[key];
  return typeof value === typeof fallback && (!VALIDATORS[key] || VALIDATORS[key](value));
}

function _defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    return null;
  }
}

class UserPreferencesServiceClass extends PubSubService {
  /**
   * @param {Object} [options]
   * @param {Storage|null} [options.storage] - where local-only values are kept (the browser's
   *   localStorage by default)
   */
  constructor({ storage = _defaultStorage() } = {}) {
    super(EVENTS);
    this.name = 'userPreferencesService';
    this._storage = storage;
    this._general = { ...GENERAL_DEFAULTS };
    LOCAL_ONLY_KEYS.forEach(key => {
      const stored = this._readLocal(key);
      if (stored !== undefined) {
        this._general[key] = stored;
      }
    });
    // Keys the user chose a value for this session, which startup hydration may no longer
    // override: the preference fetch is asynchronous and can land after the choice was made.
    this._userSet = new Set();
    this._persist = null;
  }

  create() {
    return this;
  }

  get GENERAL_DEFAULTS() {
    return GENERAL_DEFAULTS;
  }

  /** The value of a general preference held here (its default until hydrated or set). */
  getGeneral(key) {
    return this._general[key];
  }

  /** Whether a key is kept in this browser only, because the server does not accept it yet. */
  isLocalOnly(key) {
    return LOCAL_ONLY_KEYS.has(key);
  }

  /**
   * The general preferences held here that the server accepts, for a wholesale section write.
   * Local-only keys are left out: a section carrying a key the server does not know is refused.
   */
  getGeneralValues() {
    return Object.fromEntries(Object.entries(this._general).filter(([key]) => !LOCAL_ONLY_KEYS.has(key)));
  }

  /**
   * Set a general preference on the user's behalf and persist it.
   *
   * @param {string} key
   * @param {*} value
   * @param {Object} [options]
   * @param {boolean} [options.persist] - false when the caller writes the section itself (a
   *   Settings form saving the whole section), so the value is only recorded here. A local-only
   *   key is always written to the browser's storage, since no section write carries it.
   * @returns {Promise} the persistence outcome; a failure is logged and does not reject, since the
   *   value is in effect for this session either way
   */
  setGeneral(key, value, { persist = true } = {}) {
    if (!(key in GENERAL_DEFAULTS)) {
      throw new Error(`Unknown general preference: ${key}`);
    }
    if (!_isValid(key, value)) {
      throw new Error(`Invalid value for general preference ${key}: ${value}`);
    }
    this._userSet.add(key);
    this._setGeneral(key, value, false);

    if (LOCAL_ONLY_KEYS.has(key)) {
      this._writeLocal(key, value);
      return Promise.resolve();
    }
    if (!persist) {
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(() => this._persist?.())
      .catch(error => {
        console.warn(`[UserPreferencesService] Saving "${key}" failed; the value applies for this session.`, error);
      });
  }

  /**
   * Apply the `general` values startup hydration resolved. A key the user has already chosen this
   * session keeps their choice; a key absent from the document (it predates the preference), or of
   * the wrong type, falls back to the default rather than keeping a previous identity's value.
   */
  applyHydratedGeneral(values = {}) {
    Object.entries(GENERAL_DEFAULTS).forEach(([key, fallback]) => {
      // A local-only key is not in the document: the browser's value stands
      if (this._userSet.has(key) || LOCAL_ONLY_KEYS.has(key)) {
        return;
      }
      const stored = values[key];
      const local = this._readLocal(key);
      const value = _isValid(key, stored) ? stored : local !== undefined ? local : fallback;
      this._setGeneral(key, value, true);
    });
  }

  /**
   * Register how a user choice is written to the preference document: `() => Promise`, expected to
   * post the whole general section (this service's values included).
   */
  setPersistence(persist) {
    this._persist = typeof persist === 'function' ? persist : null;
  }

  _readLocal(key) {
    try {
      const raw = this._storage?.getItem(LOCAL_STORAGE_PREFIX + key);
      if (raw === null || raw === undefined) {
        return undefined;
      }
      const value = JSON.parse(raw);
      return _isValid(key, value) ? value : undefined;
    } catch (error) {
      return undefined;
    }
  }

  _writeLocal(key, value) {
    try {
      this._storage?.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (error) {
      console.warn(`[UserPreferencesService] Keeping "${key}" in this browser failed; the value applies for this session.`, error);
    }
  }

  _setGeneral(key, value, hydrated) {
    if (this._general[key] === value) {
      return;
    }
    this._general[key] = value;
    this._broadcastEvent(EVENTS.GENERAL_CHANGED, { key, value, hydrated });
  }
}

const UserPreferencesService = new UserPreferencesServiceClass();

export { EVENTS as UserPreferencesServiceEvents, UserPreferencesServiceClass };
export default UserPreferencesService;
