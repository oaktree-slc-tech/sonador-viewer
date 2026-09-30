// Preset view directions for the 3D views, in patient (LPS) coordinates.
// `viewPlaneNormal` points from the focal point toward the camera; `viewUp` is screen up.

export const VIEW_ORIENTATIONS = [
  // From above the head, anterior at the top of the screen
  { id: 'top', label: 'Top', viewPlaneNormal: [0, 0, 1], viewUp: [0, -1, 0] },
  // From the feet, anterior at the top of the screen (the radiological axial view)
  { id: 'bottom', label: 'Bottom', viewPlaneNormal: [0, 0, -1], viewUp: [0, -1, 0] },
  // Facing the patient, superior at the top of the screen
  { id: 'front', label: 'Front', viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1] },
  // From behind the patient, superior at the top of the screen
  { id: 'back', label: 'Back', viewPlaneNormal: [0, 1, 0], viewUp: [0, 0, 1] },
  // From the patient's left side, superior up (the patient faces screen left)
  { id: 'left', label: 'Left', viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1] },
  // From the patient's right side, superior up (the patient faces screen right)
  { id: 'right', label: 'Right', viewPlaneNormal: [-1, 0, 0], viewUp: [0, 0, 1] },
];

export function getViewOrientation(id) {
  return VIEW_ORIENTATIONS.find(orientation => orientation.id === id);
}

export function applyViewOrientationToViewport(viewport, id) {
  // Turn a Cornerstone3D viewport to the preset direction and fit its contents to the canvas.
  // Returns false when the viewport or the preset is missing.
  const orientation = getViewOrientation(id);
  if (!viewport || !orientation) {
    return false;
  }

  viewport.setCamera({
    viewPlaneNormal: [...orientation.viewPlaneNormal],
    viewUp: [...orientation.viewUp],
  });
  // Fits the visible actors (or the volume, when one is loaded) with the camera direction kept
  viewport.resetCamera();
  viewport.render();
  return true;
}

export function applyViewOrientationToModelView(api, id) {
  // Turn a Three.js model view (extension-viewerm3d's M3DModelView api) to the preset direction
  // with the models fitted to the view. Returns false when the view, the preset or the models are
  // missing.
  const orientation = getViewOrientation(id);
  if (!api?.setCameraOrientation || !orientation) {
    return false;
  }
  return api.setCameraOrientation(orientation) === true;
}
