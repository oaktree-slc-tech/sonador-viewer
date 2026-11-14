import { callInputDialog, callInputDialogAutoComplete } from './callInputDialog';
import { callConfirmDialog } from './callConfirmDialog';
import { callColorPickerDialog, } from './colorPickerDialog';
import { annotationTextCallbacks } from './annotationTextDialog';
import arrowMarkerHelpers from './arrowMarkers';
import { ensureArrowMarkerTooltip } from '../components/ArrowMarkerTooltip';

// The arrow markers (utils/arrowMarkers) and their tooltip, for the Cornerstone3D views
const arrowMarkers = { ...arrowMarkerHelpers, ensureArrowMarkerTooltip };


const utils = {
	callInputDialog, callInputDialogAutoComplete, callColorPickerDialog, callConfirmDialog, annotationTextCallbacks, arrowMarkers,
};


export default utils;
export { utils, callInputDialog, callInputDialogAutoComplete, callColorPickerDialog, callConfirmDialog, annotationTextCallbacks, arrowMarkers, }