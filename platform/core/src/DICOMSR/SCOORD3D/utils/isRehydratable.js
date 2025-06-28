import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';


export default function isRehydratable(displaySet, mappings, options) {
  /**
  * Checks if the given `displaySet`can be rehydrated into the `MeasurementService`.
  *
  * @param {object} displaySet The SR `displaySet` to check.
  * @param {object[]} mappings The CornerstoneTools 4 mappings to the `MeasurementService`.
  * @returns {boolean} True if the SR can be rehydrated into the `MeasurementService`.
  */
  options = options || {};
  _.defaults(options, {
    adapters: c3dAdaptersSR.Cornerstone,
  });

  if (!mappings || !mappings.length) {
    return false;
  }

  const mappingDefinitions = mappings.map((m) => m.definition);
  const { measurements } = displaySet;

  const adapterKeys = Object.keys(options.adapters).filter(
    (adapterKey) => typeof options.adapters[adapterKey].isValidCornerstoneTrackingIdentifier === 'function'
  );

  const adapters = [];

  adapterKeys.forEach((key) => {
    if (mappingDefinitions.includes(key)) {
      // Must have both a dcmjs adapter and a MeasurementService
      // Definition in order to be a candidate for import.
      adapters.push(options.adapters[key]);
    }
  });

  for (let i = 0; i < measurements.length; i++) {
    const TrackingIdentifier = measurements[i].TrackingIdentifier;
    const hydratable = adapters.some((adapter) => adapter.isValidCornerstoneTrackingIdentifier(TrackingIdentifier));

    if (hydratable) {
      return true;
    }
  }

  return false;
}
