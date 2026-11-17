// Colours of a landmark set: the roles `Line` (the marker) and `Text` (the name). A landmark's own
// colour replaces the set's role by role; a role neither sets is null, which a renderer draws in the
// Viewer's default.

const ROLES = ['Line', 'Text'];

/** The colours a set stores: { Line, Text }, null where it stores none */
function setColors(set) {
  const display = (set && set.display) || {};
  return { Line: display.Line || null, Text: display.Text || null };
}

/** The colours a landmark is drawn in: its own, else its set's, role by role; null for the default */
function landmarkColors(set, landmark) {
  const own = (landmark && landmark.display) || {};
  const inherited = setColors(set);
  return ROLES.reduce((colors, role) => ({ ...colors, [role]: own[role] || inherited[role] }), {});
}

/** The roles a landmark sets itself: { Line: bool, Text: bool } */
function ownColorRoles(landmark) {
  const own = (landmark && landmark.display) || {};
  return { Line: Boolean(own.Line), Text: Boolean(own.Text) };
}


export { landmarkColors, ownColorRoles, setColors };
