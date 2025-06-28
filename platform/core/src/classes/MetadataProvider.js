// Compatibility module which provides access to both the Cornerstone Metadata Provider and the 
// Cornerstone3dMetadataProvider instances for the Sonador viewer.

import CornerstoneMetadataProvider from './CornerstoneMetadataProvider';
import Cornerstone3dMetadataProvider from './Cornerstone3dMetadataProvider';


// Export Cornerstone Classic/Legacy Metadata provider by default
const metadataProvider = CornerstoneMetadataProvider;

export default metadataProvider;
export { CornerstoneMetadataProvider, Cornerstone3dMetadataProvider };
