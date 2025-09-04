import React from 'react';

import { Icon } from '@ohif/ui';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';

import './OHIFLogo.css';

function OHIFLogo() {
  return (
    <a target="_blank" rel="noopener noreferrer" className="header-brand" href="/">
      <Logo />
    </a>
  );
}

export default OHIFLogo;
