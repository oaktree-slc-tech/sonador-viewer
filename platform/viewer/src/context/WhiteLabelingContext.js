import React from 'react';

import OHIFLogo from '../components/OHIFLogo/OHIFLogo.js';

const defaultContextValues = {
  createLogoComponentFn: () => OHIFLogo(),
};

const WhiteLabelingContext = React.createContext(defaultContextValues);

export default WhiteLabelingContext;
