import user from '@ohif/core/src/user';
import OHIF from '@ohif/core';


// Unpack Sonador helper utilities from OHIF core
const { getAuthToken, sonadorUrl } = OHIF.sonador;


// Maintain export of utilities for backwards compatibility
export { getAuthToken, sonadorUrl };
