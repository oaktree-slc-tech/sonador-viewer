import React from 'react';
import PropTypes from 'prop-types';

import SecurityAccessIdsTabNG from '../SecurityAcessIdsTabNG/SecurityAccessIdsTabNG';
import SecurityAPITokensTabNG from '../SecurityAPITokensTabNG/SecurityAPITokensTabNG';

export default function SecurityTabNG({ type }) {
  if (type === 'tokens') {
    return <SecurityAPITokensTabNG />;
  }

  return <SecurityAccessIdsTabNG />;
}

SecurityTabNG.propTypes = {
  type: PropTypes.oneOf(['tokens', 'ids']).isRequired,
};
