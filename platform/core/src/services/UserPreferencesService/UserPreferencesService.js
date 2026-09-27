// Session holder for the user's `general` preferences that no other service holds (the download
// queue holds its own two, i18n holds the language). The preference document is the record: this
// keeps only the value a feature reads when it runs, hydrated from the document at startup and set
// on the user's behalf when they change it -- from the Settings page or from the feature itself,
// as a "don't ask again" checkbox does.
//
// Persistence is wired in by the viewer (`setPersistence`), which owns the write queue and the
// section's full key set: a section POST replaces the section wholesale, so a write made from here
// has to carry the other holders' values too.

import { PubSubService } from '../_shared/pubSubServiceInterface';


const EVENTS = {
  // A general preference held here changed: `{ key, value, hydrated }`. Hydration and user
  // choice both announce, so a form showing the value can follow the startup fetch.
  GENERAL_CHANGED: 'event::userPreferencesService:generalChanged',
};

// Open as Segmentation says which locked models it leaves out before the editor opens. The
// dialog's "don't ask again" turns this off; the Settings page turns it back on.
export const LOCKED_MODELS_WARNING_PREFERENCE_KEY = 'warnLockedModelsOnOpenAsSegmentation';

// The keys held here and their defaults, which also fix each key's type: a stored value of another
// type (a document edited by hand, or written by another release) is read as the default.
const GENERAL_DEFAULTS = Object.freeze({
  [LOCKED_MODELS_WARNING_PREFERENCE_KEY]: true,
});

class UserPreferencesServiceClass extends PubSubService {
  constructor() {
    super(EVENTS);
    this.name = 'userPreferencesService';
    this._general = { ...GENERAL_DEFAULTS };
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

  /** Every general preference held here, for a wholesale section write. */
  getGeneralValues() {
    return { ...this._general };
  }

  /**
   * Set a general preference on the user's behalf and persist it.
   *
   * @param {string} key
   * @param {*} value
   * @param {Object} [options]
   * @param {boolean} [options.persist] - false when the caller writes the section itself (a
   *   Settings form saving the whole section), so the value is only recorded here
   * @returns {Promise} the persistence outcome; a failure is logged and does not reject, since the
   *   value is in effect for this session either way
   */
  setGeneral(key, value, { persist = true } = {}) {
    if (!(key in GENERAL_DEFAULTS)) {
      throw new Error(`Unknown general preference: ${key}`);
    }
    this._userSet.add(key);
    this._setGeneral(key, value, false);

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
      if (this._userSet.has(key)) {
        return;
      }
      const stored = values[key];
      this._setGeneral(key, typeof stored === typeof fallback ? stored : fallback, true);
    });
  }

  /**
   * Register how a user choice is written to the preference document: `() => Promise`, expected to
   * post the whole general section (this service's values included).
   */
  setPersistence(persist) {
    this._persist = typeof persist === 'function' ? persist : null;
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
