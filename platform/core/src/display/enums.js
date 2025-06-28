import { EVENTS as SERVICE_EVENTS } from '../services/DisplaySetService/EVENTS';


const EVENTS = {

  // Data fetch (download) events
  STUDY_FETCH_START: 'api-event::fetch-data::study::start',
  STUDY_DATA_FETCH: 'api-event::fetch-data::study',
  STUDY_DATA_FETCH_RAW: 'api-event::fetch-data::study-data::raw',
  STUDY_DATA_FETCH_ERR: 'api-event::fetch-data::study-data::error',
  STUDY_FETCH_ERR: 'api-event::fetch-data::study::error',
  STUDY_RELOAD: 'api-event::fetch-data::study::reload',

  // Data transfer (upload) events
  DCM_TRANSFER: 'api-event::transfer-data::dcm',
  DCM_LOCAL_CREATE: 'api-event::create-data::dcm',
  DCM_TRANSFER_ERR: 'api-event::transfer-data::dcm:error',

  // Viewer lifecycle events
  VIEWER_RENDER: 'api-event::render',
}

const Enums = {
  EVENTS,
  SERVICE_EVENTS,
}
export default Enums;
export { Enums, EVENTS, SERVICE_EVENTS };