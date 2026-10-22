// Series and image identifiers of a measurement reference. Series summary metadata carries
// SeriesNumber and Modality before any instances load, so the series is consulted before its
// first instance.

const IDENTIFIER_KEYS = ['SeriesNumber', 'SeriesDescription', 'Modality'];

/**
 * @input store: DicomMetadataStore (passed in to avoid an import cycle with the services)
 * @returns {object|null} `{ SeriesNumber, SeriesDescription, Modality, InstanceNumber }`, or null
 *   when neither the instance nor the series is known
 */
export default function referenceIdentifiers(store, { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = {}) {
  if (!store || !SeriesInstanceUID) {
    return null;
  }

  const instance = SOPInstanceUID ? store.getInstance(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID) : undefined;
  const series = store.getSeries(StudyInstanceUID, SeriesInstanceUID);
  if (!instance && !series) {
    return null;
  }

  const first = series && series.instances && series.instances[0];
  const identifiers = { InstanceNumber: instance ? instance.InstanceNumber : undefined };
  IDENTIFIER_KEYS.forEach(key => {
    identifiers[key] = [instance, series, first].map(source => source && source[key]).find(v => v !== undefined && v !== null);
  });
  return identifiers;
}
