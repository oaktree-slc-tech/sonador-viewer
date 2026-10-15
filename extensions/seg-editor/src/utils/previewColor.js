// The colour a pending 3D edit is previewed in (threeDTools/previewOverlay.js): a general user
// preference held by UserPreferencesService (@ohif/core), set from the 3D panel's swatch or the
// Settings page's Seg Editor section. Until the server accepts the key it is kept in this browser
// (the service's local-only keys).

import { useEffect, useState } from 'react';

import {
  SEG_EDITOR_PREVIEW_COLOR_DEFAULT,
  SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY,
  UserPreferencesService,
  UserPreferencesServiceEvents,
} from '@ohif/core';

import { PREVIEW_COLOR_FALLBACK } from '../threeDTools/previewOverlay';


export const PREVIEW_COLOR_DEFAULT = SEG_EDITOR_PREVIEW_COLOR_DEFAULT || PREVIEW_COLOR_FALLBACK;

/** The preview colour, '#rrggbb'. */
export function getPreviewColor(service = UserPreferencesService) {
  return service?.getGeneral?.(SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY) || PREVIEW_COLOR_DEFAULT;
}

/** Set the preview colour on the user's behalf. An invalid colour is ignored. */
export function setPreviewColor(color, service = UserPreferencesService) {
  try {
    return service?.setGeneral?.(SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY, String(color).toLowerCase());
  } catch (error) {
    console.warn('[SegEditor] Not a preview colour:', color, error);
    return undefined;
  }
}

/** Follow the preview colour; returns an unsubscribe function. */
export function subscribePreviewColor(listener, service = UserPreferencesService) {
  const subscription = service?.subscribe?.(
    UserPreferencesServiceEvents?.GENERAL_CHANGED,
    ({ key, value } = {}) => key === SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY && listener(value)
  );
  return () => subscription?.unsubscribe?.();
}

/** The preview colour, following changes made anywhere (the panel, the Settings page). */
export function usePreviewColor() {
  const [color, setColor] = useState(getPreviewColor);
  useEffect(() => {
    setColor(getPreviewColor());
    return subscribePreviewColor(setColor);
  }, []);
  return color;
}
