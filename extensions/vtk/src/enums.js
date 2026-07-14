export const VIEWPORT = 'VTK'
export const VIEWPORT_VTK = VIEWPORT;
export const ACTIVE_VIEWPORT = 'ACTIVE_VIEWPORT::'+VIEWPORT_VTK;


export const CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP = 'Converting Labelmap to Surface';
export const AXIAL = 'Axial';
export const CORONAL = 'Coronal';
export const SAGITTAL = 'Sagittal';
export const C3D_3D = '3D';


export const VTK_MPRSLICE_ID = 'cornerstone3dSliceView';
export const VTK_MPRSLICE_RENDER_ID = VTK_MPRSLICE_ID;
export const VTK_MPRSLICE_TOOLGROUP_ID = VTK_MPRSLICE_ID;
export const VTK_MPRSLICE_VOI_SYNC_ID = VTK_MPRSLICE_ID;


export const VTK_MPRSLICE_TOOL_DEFAULT = 'default';
export const VTK_MPRSLICE_TOOL_LEVEL = 'level';


const VTK_MPR_TOOLS = {
  VTK_MPRSLICE_TOOL_DEFAULT, VTK_MPRSLICE_TOOL_LEVEL, 
}


const VTK_MPR_EVENTS = {

  // MPR Data Events
  VTK_MPR_ACTIVATE_TOOL: 'api-event::mpr-slice::tool-enable',
  VTK_MPR_REFRESH_VIEWPORT: 'api-event::mpr-slice::refresh-viewport',
}


const MPR = {
  VTK_MPRSLICE_ID, VTK_MPRSLICE_RENDER_ID, VTK_MPRSLICE_TOOLGROUP_ID, VTK_MPRSLICE_VOI_SYNC_ID,
  EVENTS: VTK_MPR_EVENTS, TOOLS: VTK_MPR_TOOLS,
}


const CORNERSTONE = {
  CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP, 
  AXIAL, CORONAL, SAGITTAL, C3D_3D, 
}


const Enums = {
  VIEWPORT_VTK, VIEWPORT, ACTIVE_VIEWPORT, CORNERSTONE, AXIAL, CORONAL, SAGITTAL, MPR, VTK_MPR_EVENTS, VTK_MPR_TOOLS
}
export default Enums;
export { Enums, CORNERSTONE, MPR };