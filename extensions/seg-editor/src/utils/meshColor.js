// The colour the edit-mode mesh of the segment being edited is drawn in (threeDTools/
// editModeOverlay.js): 'auto' (the default) follows the segment's own colour, a hex colour is
// the user's pick. A general user preference held by UserPreferencesService (@ohif/core), set
// from the 3D panel's swatch beside "Show mesh" or the Settings page (General > Segmentation Editor).
// Until the server accepts the key it is kept in this browser (the service's local-only keys).

import { useEffect, useState } from 'react';

import {
  SEG_EDITOR_MESH_COLOR_DEFAULT,
  SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY,
  UserPreferencesService,
  UserPreferencesServiceEvents,
} from '@ohif/core';

import { MESH_COLOR_AUTO } from '../threeDTools/editModeOverlay';


export { MESH_COLOR_AUTO };
export const MESH_COLOR_DEFAULT = SEG_EDITOR_MESH_COLOR_DEFAULT || MESH_COLOR_AUTO;

/** The mesh colour preference: MESH_COLOR_AUTO (follow the segment) or '#rrggbb'. */
export function getMeshColor(service = UserPreferencesService) {
  return service?.getGeneral?.(SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY) || MESH_COLOR_DEFAULT;
}

/** Whether the mesh follows the segment's colour. */
export function isMeshColorAuto(color = getMeshColor()) {
  return !color || color === MESH_COLOR_AUTO;
}

/** Set the mesh colour on the user's behalf: a colour, or MESH_COLOR_AUTO. An invalid value is ignored. */
export function setMeshColor(color, service = UserPreferencesService) {
  try {
    return service?.setGeneral?.(SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY, String(color).toLowerCase());
  } catch (error) {
    console.warn('[SegEditor] Not a mesh colour:', color, error);
    return undefined;
  }
}

/** Follow the mesh colour; returns an unsubscribe function. */
export function subscribeMeshColor(listener, service = UserPreferencesService) {
  const subscription = service?.subscribe?.(
    UserPreferencesServiceEvents?.GENERAL_CHANGED,
    ({ key, value } = {}) => key === SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY && listener(value)
  );
  return () => subscription?.unsubscribe?.();
}

/** The mesh colour, following changes made anywhere (the panel, the Settings page). */
export function useMeshColor() {
  const [color, setColor] = useState(getMeshColor);
  useEffect(() => {
    setColor(getMeshColor());
    return subscribeMeshColor(setColor);
  }, []);
  return color;
}
