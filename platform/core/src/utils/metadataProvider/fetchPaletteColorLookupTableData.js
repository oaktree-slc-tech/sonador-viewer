// Compatibility module for OHIF v2 and v3 methods. Provides access to fetchPaletteColorLookupTableData methods needed
// for the metadata providers in OHIF v2 and v3. The OHIF v2 instance is exported by default.
import fetchCornerstonePaletteColorLookupTableData from '../utils/metadataProvider/fetchCornerstonePaletteColorLookupTableData';
import fetchCornerstone3dPaletteColorLookupTableData from '../utils/metadataProvider/fetchCornerstone3dPaletteColorLookupTableData';


// Set Cornerstone Legacy/Class as default
const fetchPaletteColorLookupTableData = fetchCornerstonePaletteColorLookupTableData;


export default fetchPaletteColorLookupTableData;
export { fetchCornerstonePaletteColorLookupTableData, fetchCornerstone3dPaletteColorLookupTableData }