import React from 'react';

import OHIFLogo from '../components/OHIFLogo/OHIFLogo.js';
import SonadorMark from '../components/OHIFLogo/SonadorMark.js';


const defaultContextValues = {
  createLogoComponentFn: () => OHIFLogo(),

  // Square mark for the collapsed sidebar. Falls back to the bundled artwork whenever the server
  // omits branding.logo_narrow (ohif-viewers#128, FR-21).
  createNarrowLogoComponentFn: () => SonadorMark(),
  emptyStateMessageFn: () => '',

  // Markdown shown on the sign-out confirmation page (SonadorSite "Farewell Message")
  signedOutMessageFn: () => '',
};


const WhiteLabelingContext = React.createContext(defaultContextValues);


export default WhiteLabelingContext;
