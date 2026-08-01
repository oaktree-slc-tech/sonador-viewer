import React from 'react';

import OHIFLogo from '../components/OHIFLogo/OHIFLogo.js';


const defaultContextValues = {
  createLogoComponentFn: () => OHIFLogo(),
  emptyStateMessageFn: () => '',

  // Markdown shown on the sign-out confirmation page (SonadorSite "Farewell Message")
  signedOutMessageFn: () => '',
};


const WhiteLabelingContext = React.createContext(defaultContextValues);


export default WhiteLabelingContext;
