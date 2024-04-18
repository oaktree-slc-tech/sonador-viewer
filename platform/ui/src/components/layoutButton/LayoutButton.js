import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import ToolbarButton from '../../viewer/ToolbarButton';

import { LayoutChooser } from './LayoutChooser';

export function LayoutButton({ dropdownVisible = false, onChange, selectedCell }) {
  const [isDropdownVisible, setIsDropdownVisible] = useState(dropdownVisible);

  useEffect(() => {
    if (dropdownVisible !== isDropdownVisible) {
      setIsDropdownVisible(dropdownVisible);
    }
  }, [dropdownVisible]);

  const handleClick = () => {
    setIsDropdownVisible((prevState) => !prevState);
  };

  const handleChange = (newSelectedCell) => {
    if (onChange) {
      onChange(newSelectedCell);
    }
  };

  return (
    <div className="btn-group">
      <ToolbarButton id="layout" isActive={isDropdownVisible} label="Layout" icon="th" onClick={handleClick} />
      <LayoutChooser
        visible={isDropdownVisible}
        onChange={handleChange}
        onClick={handleClick}
        selectedCell={selectedCell}
      />
    </div>
  );
}

LayoutButton.propTypes = {
  dropdownVisible: PropTypes.bool,
  /** Called with the selectedCell number when grid sell is selected */
  onChange: PropTypes.func,
  /** The cell to show as selected */
  selectedCell: PropTypes.object,
};

export default LayoutButton;
