import _ from 'lodash';
import { VTK_VOLUME_CPROFILE_CT_BONE } from '../utils/volume/vtkVolumePresets.js';

export const getVtkOptions = (state) => {
  // Retrieve the currently active VTK options
  if (state.extensions && state.extensions.vtk) {
    return state.extensions.vtk;
  }
  return {};
};

export const getActiveVolumeColorPreset = (state) => {
  // Retrieve the currently active VTK color preset from the state extensions data.
  return getVtkOptions(state).activeColorPreset || '';
};
