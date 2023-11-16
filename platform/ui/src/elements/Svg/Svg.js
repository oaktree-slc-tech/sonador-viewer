import PropTypes from 'prop-types';

import getSvg from './getSvg.js';

import './Svg.styl';

const Svg = (props) => {
  return getSvg(props.name, props);
};

Svg.propTypes = {
  name: PropTypes.string.isRequired,
};

export { Svg };
