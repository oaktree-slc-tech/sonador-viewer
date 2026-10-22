// Whether a DicomMetadataStore event may change the metadata of the series. SERIES_ADDED lists
// summaries; SERIES_UPDATED, INSTANCES_ADDED and INSTANCE_ADDED name one series; an event naming
// none may affect any.
export const metadataEventConcerns = (event, SeriesInstanceUID) => {
  if (!event) {
    return true;
  }
  const seriesUIDs = event.seriesSummaryMetadata
    ? event.seriesSummaryMetadata.map(series => series.SeriesInstanceUID)
    : [event.SeriesInstanceUID];
  return seriesUIDs.includes(SeriesInstanceUID) || seriesUIDs.includes(undefined);
};



// Store events that add or change series and instance metadata
const METADATA_EVENTS = ['SERIES_ADDED', 'SERIES_UPDATED', 'INSTANCES_ADDED', 'INSTANCE_ADDED'];

/**
 * Calls `onChange` whenever the store reports metadata that may concern the series.
 * @returns {Function} unsubscribes every subscription
 */
export const subscribeSeriesMetadata = (store, SeriesInstanceUID, onChange) => {
  if (!store || !store.EVENTS || typeof store.subscribe !== 'function') {
    return () => {};
  }

  const refresh = event => {
    if (metadataEventConcerns(event, SeriesInstanceUID)) {
      onChange();
    }
  };
  const subscriptions = METADATA_EVENTS
    .map(name => store.EVENTS[name])
    .filter(Boolean)
    .map(name => store.subscribe(name, refresh));
  return () => subscriptions.forEach(subscription => subscription && subscription.unsubscribe && subscription.unsubscribe());
};


export default metadataEventConcerns;
