import _ from 'lodash';

import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import classnames from 'classnames';

import { utils, redux as coreRedux } from '@ohif/core';

import { viewerbaseGetDisplaySet } from '@ohif/ui';

import { DicomBrowserSelect } from '@ohif/extension-dicom-tag-browser';

import vtkVolumeColorPresets, {
  VTK_VOLUME_CPROFILE_CT_BONE,
  VTK_VOLUME_CPROFILE_MRI_DEFAULT,
  getDefaultVolumePresetForModality,
} from '../utils/volume/vtkVolumePresets.js';
import redux from '../redux';

import './vtkVolumeColorPresetSelector.css';

const vtkVolumeColorPresetSelectItem = ({ onClick, title, description }) => {
  return (
    <li className="vtk-color-preset-item" onClick={onClick}>
      <div className="vtk-color-preset-meta">
        <div className="vtk-color-preset-meta-title">{title}</div>
        <div className="vtk-color-preset-meta-description">{description}</div>
      </div>
    </li>
  );
};

vtkVolumeColorPresetSelectItem.propTypes = {
  onClick: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
};

vtkVolumeColorPresetSelectItem.defaultProps = {
  description: '',
};

const vtkVolumeColorPresetSelector = (props) => {
  // Control which can be used to change the color preset options of a VTK volume

  // Unpack toolbar button properties
  const { button, toolbarClickCallback, defaultColorPreset } = props;
  const { label } = button;

  // Retrieve modality for the currently active display set
  const { viewportSpecificData, activeViewportIndex } = useSelector(
    coreRedux.selectors.getActiveViewportData
  );
  let cmodality;
  try {
    const { study, displaySet } = viewerbaseGetDisplaySet(
      viewportSpecificData,
      activeViewportIndex
    );
    cmodality = displaySet.Modality;
  } catch (err) {
    console.log(
      'Unable to locate study and series for currently active viewport'
    );
  }

  // Filter color presets by modality
  const modalityColorPresets = _.filter(vtkVolumeColorPresets, (v) => {
    // If there is an active modality, only return presets which match that modality
    return cmodality ? v.modality == cmodality : true;
  });

  // Check if desired "default" preset is available in modality list. If not, retrieve
  // the default preset for the displayset modality.
  let dcpreset;
  if (
    !_.includes(modalityColorPresets, (v) => v.id == defaultColorPreset) &&
    cmodality
  ) {
    dcpreset = getDefaultVolumePresetForModality(cmodality);
  } else {
    dcpreset = defaultColorPreset;
  }

  // Active preset
  const [activeColorPreset, setActiveColorPreset] = useState(
    dcpreset || defaultColorPreset
  );

  // Available VTK volume color presets
  const vtkColorProfileList = _.map(modalityColorPresets, (v) => {
    return {
      value: v.id,
      title: v.name,
      onClick: () => setActiveColorPreset(v.id),
    };
  });

  // Profile list state hooks
  const [vtkColorProfileSelectList, setVtkColorProfileSelectList] =
    useState(vtkColorProfileList);

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
  }, [activeColorPreset]);

  // Initial property display value and styles
  let selectedColorProfile = _.find(
    vtkColorProfileSelectList,
    (cp) => cp.value === activeColorPreset
  );

  const style = {
    marginLeft: '1rem',
    marginRight: '1rem',
    minWidth: '15rem',
    marginTop: '-0.35rem',
  };

  return (
    <div style={style}>
      <div className="container">
        <div className="vtk-color-preset-select">
          <DicomBrowserSelect
            key="color-profile-select"
            value={selectedColorProfile}
            formatOptionLabel={vtkVolumeColorPresetSelectItem}
            options={vtkColorProfileSelectList}
            placeholder={label}
          />
        </div>
      </div>
    </div>
  );
};

vtkVolumeColorPresetSelector.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  defaultColorPreset: PropTypes.string.isRequired,
};
vtkVolumeColorPresetSelector.defaultProps = {
  defaultColorPreset: VTK_VOLUME_CPROFILE_CT_BONE,
};

export default vtkVolumeColorPresetSelector;
