import PropTypes from 'prop-types';

import getIcon from './getIcon';

import './Icon.styl';


const Icon = (props) => {
  return getIcon(props.name, props);
};

Icon.displayName = 'Icon';


Icon.propTypes = {
  /** The string name of the icon to display */
  name: PropTypes.string.isRequired,
};


export default Icon;
