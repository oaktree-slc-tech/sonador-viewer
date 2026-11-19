// The annotation stores the visibility rule (annotationVisibility.js) writes besides the measurement
// service, the Measurements API representations and the Cornerstone3D display annotations. A store
// registers itself as { id, entries(), keyOf(entry), isVisible(entry), setVisible(entry, visible) },
// with an optional setVisibleMany([{ entry, visible }]) that writes several entries at once; its
// entries carry what the rule needs to place them in a timepoint (a `document` with the SR Series
// Instance UID).

const stores = new Set();

/** Register a store; returns a function that removes it */
function registerVisibilityStore(store) {
  if (!store || typeof store.entries !== 'function') {
    return () => {};
  }
  stores.add(store);
  return () => stores.delete(store);
}

const visibilityStores = () => [...stores];

export { registerVisibilityStore, visibilityStores };
