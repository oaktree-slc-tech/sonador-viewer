// Follow Selected Segment (owner's request of 2026-10-27): when it is on, selecting a segment
// moves the editor's views onto it (the 2D views scroll and pan to its centre, the 3D view frames
// its surface); when it is off, selecting a segment moves nothing. A general user preference held
// by UserPreferencesService (@ohif/core), off by default, set from the segmentation header's menu
// or the Settings page (General > Segmentation Editor); kept in this browser until the server accepts the
// key (the service's local-only keys).
//
// The framing itself is the editor layout's (it holds the viewports and the editing canvas): it
// registers a framer here, which the header menu's Frame Selected Segment and the command reach
// without a handle on the layout.

import { useEffect, useState } from 'react';

import {
  SEG_EDITOR_FOLLOW_SELECTION_DEFAULT,
  SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY,
  UserPreferencesService,
  UserPreferencesServiceEvents,
} from '@ohif/core';


/** Whether the views follow the selected segment. */
export function getFollowSelection(service = UserPreferencesService) {
  const value = service?.getGeneral?.(SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY);
  return typeof value === 'boolean' ? value : !!SEG_EDITOR_FOLLOW_SELECTION_DEFAULT;
}

/** Turn following on or off on the user's behalf. */
export function setFollowSelection(value, service = UserPreferencesService) {
  try {
    return service?.setGeneral?.(SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY, !!value);
  } catch (error) {
    console.warn('[SegEditor] Follow Selected Segment could not be set:', error);
    return undefined;
  }
}

/** Follow the preference; returns an unsubscribe function. */
export function subscribeFollowSelection(listener, service = UserPreferencesService) {
  const subscription = service?.subscribe?.(
    UserPreferencesServiceEvents?.GENERAL_CHANGED,
    ({ key, value } = {}) => key === SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY && listener(!!value)
  );
  return () => subscription?.unsubscribe?.();
}

/** The preference, following changes made anywhere (the header menu, the Settings page). */
export function useFollowSelection() {
  const [following, setFollowing] = useState(getFollowSelection);
  useEffect(() => {
    setFollowing(getFollowSelection());
    return subscribeFollowSelection(setFollowing);
  }, []);
  return following;
}

let _framer = null;

/**
 * Register the function that frames the selected segment (the editor layout's). Returns a
 * function that unregisters it, if it is still the one registered.
 *
 * @param {Function} framer - (options) => boolean, true when a view moved
 */
export function registerSegmentFramer(framer) {
  _framer = framer;
  return () => {
    if (_framer === framer) {
      _framer = null;
    }
  };
}

/**
 * Move the views onto the selected segment now, whatever the preference says (the header menu's
 * Frame Selected Segment, and turning Follow on).
 *
 * @param {Object} [options] - passed to the framer ({ animate })
 * @returns {boolean} whether a view moved (false without an editor, or with nothing to frame)
 */
export function frameSelectedSegment(options = {}) {
  if (!_framer) {
    return false;
  }
  try {
    return _framer(options) === true;
  } catch (error) {
    console.error('[SegEditor] Framing the selected segment failed', error);
    return false;
  }
}
