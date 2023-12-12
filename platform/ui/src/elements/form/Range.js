import React, { useState } from 'react';
import PropTypes from 'prop-types';

import './Range.css';

function Range({ value, min, max, step, onChange, id, showPercentage, showValue, valueRenderer }) {
  const [state, setState] = useState({ value: value || 0 });

  const handleChange = (event) => {
    setState({ value: event.target.value });
    if (onChange) onChange(event);
  };

  return (
    <>
      <input
        type="range"
        value={state.value}
        min={min}
        max={max}
        step={step || 1}
        onChange={handleChange}
        id={id}
        className="range"
      />
      {showPercentage && <span>{`${state.value}%`}</span>}
      {showValue && <span>{valueRenderer ? valueRenderer(state.value) : state.value}</span>}
    </>
  );
}

Range.propTypes = {
  value: PropTypes.number,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number,
  id: PropTypes.string,
  valueRenderer: PropTypes.func,
  onChange: PropTypes.func,
  showPercentage: PropTypes.bool,
  showValue: PropTypes.bool,
};

Range.defaultProps = {
  showPercentage: false,
  showValue: false,
};

export { Range };
