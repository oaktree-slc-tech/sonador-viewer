import React, { useState } from 'react';
import PropTypes from 'prop-types';

import './Select.css';

const Select = ({ options, value, onChange }) => {
  const [selected, setSelected] = useState(value);

  const handleChange = (event) => {
    const newValue = event.target.value;
    setSelected(newValue);
    if (onChange) onChange(newValue);
  };

  return (
    <select className="select-ohif" value={selected} onChange={handleChange}>
      {options.map(({ key, value }) => (
        <option key={key} value={value}>
          {key}
        </option>
      ))}
    </select>
  );
};

Select.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ),
  value: PropTypes.string,
  onChange: PropTypes.func,
};

export default Select;
