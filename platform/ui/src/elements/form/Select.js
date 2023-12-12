import React from 'react';
import PropTypes from 'prop-types';

import './Select.css';

const Select = ({ options, label, value, onChange, ...props }) => {
  const handleChange = (event) => {
    const selectedValue = event.target.value;
    if (onChange) onChange(selectedValue);
  };

  return (
    <div className="select-ohif-container">
      {label && (
        <label className="select-ohif-label" htmlFor={props.id}>
          {label}
        </label>
      )}
      <select className="form-control select-ohif" value={value} onChange={handleChange} {...props}>
        {options.map(({ key, value }) => (
          <option key={key} value={value}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
};

Select.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ),
  label: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func,
};

export { Select };
