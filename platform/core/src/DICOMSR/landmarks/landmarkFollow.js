// "Follow selected landmark": whether each landmark chosen from the Annotations panel, by a list
// entry or a step, also turns the 3D volume view's camera to face it. A general user preference held
// by UserPreferencesService, off by default and kept in this browser, set from the panel's settings
// drawer. The slice views navigate whether it is on or off.

import UserPreferencesService, {
  LANDMARKS_FOLLOW_SELECTION_DEFAULT,
  LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY,
  UserPreferencesServiceEvents,
} from '../../services/UserPreferencesService/UserPreferencesService';

/** Whether the 3D view follows the chosen landmark */
function getFollowSelectedLandmark(service = UserPreferencesService) {
  const value = service && service.getGeneral ? service.getGeneral(LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY) : undefined;
  return typeof value === 'boolean' ? value : LANDMARKS_FOLLOW_SELECTION_DEFAULT;
}

/** Turn following on or off on the user's behalf */
function setFollowSelectedLandmark(value, service = UserPreferencesService) {
  try {
    return service && service.setGeneral ? service.setGeneral(LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY, Boolean(value)) : undefined;
  } catch (error) {
    console.warn('[Landmarks] Follow selected landmark could not be set:', error);
    return undefined;
  }
}

/**
 * Follow the preference: `listener(value, { hydrated })`, hydrated when the value was read at
 * startup rather than set by the user. Returns { unsubscribe }.
 */
function subscribeFollowSelectedLandmark(listener, service = UserPreferencesService) {
  const subscription = service && service.subscribe
    ? service.subscribe(UserPreferencesServiceEvents.GENERAL_CHANGED, ({ key, value, hydrated } = {}) => {
      if (key === LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY) {
        listener(Boolean(value), { hydrated: Boolean(hydrated) });
      }
    })
    : null;
  return { unsubscribe: () => subscription && subscription.unsubscribe && subscription.unsubscribe() };
}

export { getFollowSelectedLandmark, setFollowSelectedLandmark, subscribeFollowSelectedLandmark };
