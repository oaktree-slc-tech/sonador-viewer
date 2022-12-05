import OHIF from '@ohif/core';

import { getVtkOptions, getActiveVolumeColorPreset } from './selectors.js';

/* VTK Viewport actions */
const setVtkVolumeColorPreset = (colorPreset) => {
  return OHIF.redux.actions.setExtensionData('vtk', {
    activeColorPreset: colorPreset,
  });
};

const redux = {
  actions: { setVtkVolumeColorPreset },
  selectors: { getVtkOptions, getActiveVolumeColorPreset },
};
export default redux;
