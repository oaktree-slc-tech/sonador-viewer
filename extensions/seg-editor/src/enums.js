// Sonador Segmentation Constants: Cornerstone3D <-> Three.js Integration, Background Operations,
// and DICOM codes.

import { Enums as vtkEnums } from '@ohif/extension-vtk';


export const VIEWPORT_SONADORSEG = 'SONADOR3DSEG';
export const VIEWPORT = VIEWPORT_SONADORSEG;
export const ACTIVE_VIEWPORT = 'ACTIVE_VIEWPORT::'+VIEWPORT;

export const CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP = vtkEnums.CORNERSTONE.CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP;


export const SEGVIEWER_AXIAL = vtkEnums.CORNERSTONE.AXIAL;
export const SEGVIEWER_CORONAL = vtkEnums.CORNERSTONE.CORONAL;
export const SEGVIEWER_SAGITTAL = vtkEnums.CORNERSTONE.SAGITTAL;
export const SEGVIEWER_3D = vtkEnums.CORNERSTONE.C3D_3D;

export const SEGVIEWER_ID = 'sonadorSegViewer';
export const SEGVIEWER_RENDER_ID = SEGVIEWER_ID;
export const SEGVIEWER_TOOLGROUP_ID = SEGVIEWER_ID;
export const SEGVIEWER_TOOLGROUP_ID_SURFACE =  `${SEGVIEWER_ID}-Surface`;
export const SEGVIEWER_VOI_SYNC_ID = SEGVIEWER_ID;


const EVENTS = {
  
  // Segmentation Editor Data Events: Remove Segment
  SEGMENT_REMOVE_PREP: 'api-event::seg-editor::segment-remove::prep',
  SEGMENT_REMOVE_SUCCESS: 'api-event::seg-editor::segment-remove::success',
  SEGMENT_REMOVE_ERROR: 'api-event::seg-editor::segment-remove::error',
}


const Enums = {
  VIEWPORT_SONADORSEG, VIEWPORT, ACTIVE_VIEWPORT,
  CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP,
  SEGVIEWER_AXIAL, SEGVIEWER_CORONAL, SEGVIEWER_SAGITTAL, SEGVIEWER_3D,
  SEGVIEWER_RENDER_ID, SEGVIEWER_TOOLGROUP_ID, SEGVIEWER_TOOLGROUP_ID_SURFACE, SEGVIEWER_VOI_SYNC_ID,
  EVENTS,
}

export default Enums;
export { Enums, EVENTS };