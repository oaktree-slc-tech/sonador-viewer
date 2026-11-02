// Apply one labelling edit (location, description, response) to a measurement. Each edit supplies
// only the fields it changed, so only those are written: the others keep their current values,
// including edits made earlier in the same dialog. An empty string clears a field.

const LABELLING_ATTRS = ['location', 'description', 'response'];

export default function applyLabellingAttrs(measurement, attrs) {
  LABELLING_ATTRS.forEach(key => {
    if (attrs && attrs[key] !== undefined) {
      measurement[key] = attrs[key] === null ? '' : attrs[key];
    }
  });
  return measurement;
}
