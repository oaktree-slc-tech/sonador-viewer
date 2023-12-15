import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import _ from 'lodash';
import PropTypes from 'prop-types';

import { redux as coreRedux } from '@ohif/core';
import { CustomSelect, viewerbaseGetDisplaySet } from '@ohif/ui';

import vtkVolumeColorPresets, {
  getDefaultVolumePresetForModality,
  VTK_VOLUME_CPROFILE_CT_BONE,
} from '../utils/volume/vtkVolumePresets.js';

import './vtkVolumeColorPresetSelector.css';

export default function VtkVolumeColorPresetSelector({ button, toolbarClickCallback, defaultColorPreset }) {
  // Control which can be used to change the color preset options of a VTK volume

  // Retrieve modality for the currently active display set
  const { viewportSpecificData, activeViewportIndex } = useSelector(coreRedux.selectors.getActiveViewportData);
  let cmodality;
  try {
    const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
    cmodality = displaySet.Modality;
  } catch (err) {
    console.error('Unable to locate study and series for currently active viewport');
  }

  // Filter color presets by modality
  const modalityColorPresets = _.filter(vtkVolumeColorPresets, (v) => {
    // If there is an active modality, only return presets which match that modality
    return cmodality ? v.modality == cmodality : true;
  });

  // Check if desired "default" preset is available in modality list. If not, retrieve
  // the default preset for the displayset modality.
  let dcpreset;
  if (!_.includes(modalityColorPresets, (v) => v.id == defaultColorPreset) && cmodality) {
    dcpreset = getDefaultVolumePresetForModality(cmodality);
  } else {
    dcpreset = defaultColorPreset;
  }

  // Active preset
  const [activeColorPreset, setActiveColorPreset] = useState(dcpreset || defaultColorPreset);

  // Available VTK volume color presets
  const vtkColorProfileList = _.map(modalityColorPresets, (v) => {
    return {
      value: v.id,
      title: v.name,
      onClick: () => setActiveColorPreset(v.id),
    };
  });

  // Create dispatch operation to route to commands module
  const _applyColorPreset = (val) => {
    // Add active color preset to options before routing to command module for execution
    const op = { ...button };
    op.commandOptions = {
      ...op.commandOptions,
      activeColorPreset: val,
    };
    return op;
  };

  useEffect(() => {
    // Route change in color preset to toolbar/commands module
    toolbarClickCallback(_applyColorPreset(activeColorPreset));
  }, [_applyColorPreset, activeColorPreset, toolbarClickCallback]);

  // Initial property display value and styles
  let selectedColorProfile = _.find(vtkColorProfileList, (cp) => cp.value === activeColorPreset);

  return (
    <div className="vtk-volume-color-preset-selector-container">
      <div className="container">
        <div className="vtk-color-preset-select">
          <CustomSelect value={selectedColorProfile} options={vtkColorProfileList} />
        </div>
      </div>
    </div>
  );
}

VtkVolumeColorPresetSelector.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  defaultColorPreset: PropTypes.string.isRequired,
};
VtkVolumeColorPresetSelector.defaultProps = {
  defaultColorPreset: VTK_VOLUME_CPROFILE_CT_BONE,
};
