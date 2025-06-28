const EVENTS = {
  DISPLAY_SET_ADDED: 'event::displaySetService::displaySetInstanceAdded',
  DISPLAY_SET_CHANGED: 'event::displaySetService::displaySetInstanceChanged',
  DISPLAY_SET_ACTIVATED: 'event::displaySetService::displaySetActivated',
  DISPLAY_SET_DATASYNC: 'event::displaySetService::data_sync',

  DISPLAY_SETS_CLEARED: 'event::displaySetService::displaySetsCleared',
  DISPLAY_SETS_ADDED: 'event::displaySetService:displaySetsAdded',
  DISPLAY_SETS_CHANGED: 'event::displaySetService:displaySetsChanged',
  DISPLAY_SETS_REMOVED: 'event::displaySetService:displaySetsRemoved',
  DISPLAY_SET_SERIES_METADATA_INVALIDATED: 'event::displaySetService:displaySetSeriesMetadataInvalidated',
};


export default EVENTS;
export { EVENTS };