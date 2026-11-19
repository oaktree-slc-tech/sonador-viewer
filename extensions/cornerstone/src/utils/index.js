import { callInputDialog, callInputDialogAutoComplete } from './callInputDialog';
import { callConfirmDialog } from './callConfirmDialog';
import { callColorPickerDialog, } from './colorPickerDialog';
import { annotationTextCallbacks } from './annotationTextDialog';
import arrowMarkerHelpers from './arrowMarkers';
import { ensureArrowMarkerTooltip } from '../components/ArrowMarkerTooltip';
import landmarkMarkers from './landmarkMarkerOverlay';
import { measurementUIDOf } from './measurementAnnotationSync';

// The arrow markers (utils/arrowMarkers) and their tooltip, for the Cornerstone3D views
const arrowMarkers = { ...arrowMarkerHelpers, ensureArrowMarkerTooltip };


const utils = {
	callInputDialog, callInputDialogAutoComplete, callColorPickerDialog, callConfirmDialog, annotationTextCallbacks, arrowMarkers,
	// The drawing and hover of landmark markers, for the Cornerstone3D views
	landmarkMarkers,
	// The measurement-service uid a Cornerstone3D annotation mirrors, or null (measurementAnnotationSync)
	measurementUIDOf,
};


export default utils;
export { utils, callInputDialog, callInputDialogAutoComplete, callColorPickerDialog, callConfirmDialog, annotationTextCallbacks, arrowMarkers, landmarkMarkers, measurementUIDOf, }