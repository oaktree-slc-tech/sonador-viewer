// Sonador Volume Viewer Constants

export const VIEWPORT = 'VIEWER3DVOL';
export const ACTIVE_VIEWPORT = 'ACTIVE_VIEWPORT::'+VIEWPORT;

// Cornerstone3D identities for the single-viewport volume viewer (render engine, tool group,
// and VOI synchronizer share one id)
export const VOLVIEWER_ID = 'sonadorVolumeViewer';
export const VOLVIEWER_RENDER_ID = VOLVIEWER_ID;
export const VOLVIEWER_TOOLGROUP_ID = VOLVIEWER_ID;
export const VOLVIEWER_VOI_SYNC_ID = VOLVIEWER_ID;


const VOLVIEWER_TOOL_DEFAULT = 'default';
const VOLVIEWER_TOOL_PAN = 'pan';

// Select ("Adjust") mode: VolumeCroppingTool holds the Primary binding for crop-handle
// interaction (see the §5.6 binding table on ohif-viewers#122)
const VOLVIEWER_TOOL_SELECT = 'select';

// API code name for the volume cropping tool (matches VolumeCroppingTool.toolName)
const VOLVIEWER_TOOL_CROP = 'VolumeCropping';


const TOOLS = {
  VOLVIEWER_TOOL_DEFAULT, VOLVIEWER_TOOL_PAN, VOLVIEWER_TOOL_SELECT, VOLVIEWER_TOOL_CROP,
}


const EVENTS = {

  // Volume Viewer Data Events
  VOLVIEWER_ACTIVATE_TOOL: 'api-event::vol-viewer::volume::tool-enable',

  // Tool activation-state changes. Payload: { tool: <TOOLS code>, displaySetInstanceUID,
  // state: 'active' | 'inactive' | 'hidden' }. 'hidden' fires when a tool is force-disabled
  // because its dependency turned off (e.g. cropping when volume rendering is disabled).
  VOLVIEWER_TOOL_STATE: 'api-event::vol-viewer::volume::tool-state',

  // Triggered to perform a full reset: clears segmentations, unloads the volume,
  // and re-loads the initial rendering state.
  VOLVIEWER_RESET: 'api-event::vol-viewer::volume::reset',
}


const Enums = {
  VIEWPORT, ACTIVE_VIEWPORT, EVENTS, TOOLS,
  VOLVIEWER_ID, VOLVIEWER_RENDER_ID, VOLVIEWER_TOOLGROUP_ID, VOLVIEWER_VOI_SYNC_ID,
}

export default Enums;
export { Enums, EVENTS, TOOLS };