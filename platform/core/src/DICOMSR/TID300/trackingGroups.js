// Tracking groups of a TID 300 measurement read from an SR keep their tracking UID when the
// measurement is re-saved (dcmjs mints a new one on every save).

function keepTrackingUID(trackingGroups, trackingUniqueIdentifier) {
  if (trackingUniqueIdentifier) {
    trackingGroups.filter(item => item.ValueType === 'UIDREF').forEach(item => {
      item.UID = trackingUniqueIdentifier;
    });
  }
  return trackingGroups;
}


export default keepTrackingUID;
export { keepTrackingUID };
