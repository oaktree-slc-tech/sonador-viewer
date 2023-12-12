import React, { useState } from 'react';
import PropTypes from 'prop-types';

import ToolbarButton from './ToolbarButton.js';

const wLPresetIDs = ['setWLPresetSoftTissue', 'setWLPresetLung', 'setWLPresetLiver', 'setWLPresetBrain'];

function PresetToggle({ buttons }) {
  const [selected, setSelected] = useState(null);

  const wlPresetItems = buttons
    .filter((button) => wLPresetIDs.includes(button.command))
    .map((button, index) => <ToolbarButton key={index} {...button} click={onClick} />);

  const toolItems = buttons
    .filter((button) => !wLPresetIDs.includes(button.command))
    .map((button, index) => <ToolbarButton key={index} {...button} click={onClick} />);

  const selectedButton = buttons.find((button) => button.id === selected);

  function onClick(id) {
    const buttonItem = buttons.find((button) => button.command === id);
    setSelected(buttonItem.id);
  }

  return (
    <div className="PresetToggle">
      <div className="wlPresets">{wlPresetItems}</div>
      <div className="tools">{toolItems}</div>
      <span className="presetSelected">LEVELS: {selectedButton ? selectedButton.label : 'Manual'}</span>
    </div>
  );
}

PresetToggle.propTypes = {
  buttons: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      icon: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.shape({
          name: PropTypes.string.isRequired,
        }),
      ]),
    })
  ).isRequired,
  setToolActive: PropTypes.func.isRequired,
};

export default PresetToggle;
