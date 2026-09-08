// Keeps the legacy image cache a mirror of the Cornerstone3D one rather than a second owner.
//
// Two things have to be true for the legacy consumers to keep working unchanged. Cornerstone3D
// must be the only thing that decides an image is no longer needed, and the legacy listeners that
// watch cache events for load progress must still hear about images that never went through the
// legacy path at all -- volume slices pulled in by MPR, for instance.

import { cache as c3dCache, eventTarget as c3dEventTarget, Enums as c3dEnums } from '@cornerstonejs/core';

function imageIdOf(detail) {
  // IMAGE_CACHE_IMAGE_ADDED/REMOVED carry the cached-image wrapper; IMAGE_LOADED carries the image.
  return detail?.imageId || detail?.image?.imageId || detail?.image?.image?.imageId;
}

/**
 * Install the mirror. Returns an uninstall function that removes every listener it added, so a
 * test -- or the sunset phase -- can take it back off.
 *
 * @param {object} cornerstone - the legacy cornerstone-core module
 * @returns {Function} uninstall
 */
export function installLegacyCacheMirror(cornerstone) {
  const { imageCache, events: legacyEvents, EVENTS } = cornerstone;

  // Functions are called on the module rather than destructured off it, so a receiver-dependent
  // implementation keeps working.
  let warnedAboutEnabledElements = false;

  function isOnScreen(imageId, ignoredElement) {
    // An element still painting this image holds the only reference that matters. Dropping the
    // mirror entry underneath it would let the array be collected while it is being displayed.
    //
    // `ignoredElement` exists because cornerstone-core fires the global ELEMENT_DISABLED event
    // BEFORE it splices the element out of the enabled list, so during that callback the element
    // being torn down still reports the image it was showing.
    try {
      return cornerstone
        .getEnabledElements()
        .some(element => element.element !== ignoredElement && element.image?.imageId === imageId);
    } catch (error) {
      // Conservative answer: keep the entry. Warned about once rather than per event, because the
      // effect -- the mirror stops removing anything at all -- is otherwise invisible.
      if (!warnedAboutEnabledElements) {
        warnedAboutEnabledElements = true;
        console.warn('[legacyBridge] Could not read the legacy enabled elements; keeping mirrored cache entries.', error);
      }
      return true;
    }
  }

  function syncMaximumSize() {
    // The legacy LRU must never be the one that runs. Raising its ceiling to Cornerstone3D's means
    // its purge loop cannot trigger before Cornerstone3D's own eviction has already run and told
    // us about it. Only written when it differs, because the setter fires an event and walks the
    // cache every time.
    const c3dMax = c3dCache.getMaxCacheSize();
    if (!Number.isFinite(c3dMax)) {
      return;
    }

    if (imageCache.getCacheInfo().maximumSizeInBytes !== c3dMax) {
      imageCache.setMaximumSizeBytes(c3dMax);
    }
  }

  function onCornerstone3dImageAdded(event) {
    syncMaximumSize();

    // Scrolling loads images, so this fires whenever an element is likely to have moved on.
    sweepDeferredRemovals();

    const imageId = imageIdOf(event.detail);
    if (!imageId) {
      return;
    }

    // An image that came in through the bridge is already in the legacy cache -- legacy
    // `loadAndCacheImage` records the entry synchronously before the promise resolves -- and the
    // legacy library fires its own IMAGE_LOADED and IMAGE_CACHE_CHANGED for it. Re-emitting here
    // would double-count it in StudyLoadingListener's progress.
    if (imageCache.imageCache[imageId]) {
      return;
    }

    // This one reached Cornerstone3D another way. Announce it so the legacy listeners see the
    // same picture of what is loaded.
    const image = event.detail?.image?.image || event.detail?.image;
    cornerstone.triggerEvent(legacyEvents, EVENTS.IMAGE_LOADED, { image });
    cornerstone.triggerEvent(legacyEvents, EVENTS.IMAGE_CACHE_CHANGED, { action: 'addImage', image });
  }

  function removeMirrorEntry(imageId) {
    try {
      // Fires IMAGE_CACHE_CHANGED { action: 'deleteImage' } itself, and calls the bridge's no-op
      // decache, so nothing Cornerstone3D still owns is released here.
      imageCache.removeImageLoadObject(imageId);
    } catch (error) {
      console.warn(`[legacyBridge] Error removing mirrored cache entry for ${imageId}.`, error);
      return;
    }

    cornerstone.triggerEvent(legacyEvents, EVENTS.IMAGE_CACHE_PROMISE_REMOVED, { imageId });
  }

  // Images Cornerstone3D evicted while a legacy element was still displaying them. The entry is
  // kept for as long as that is true -- but it cannot be kept forever. Legacy `loadAndCacheImage`
  // returns an existing entry's promise before it consults any loader, so a stale entry means the
  // bridge is never invoked for that imageId again: the slice is never reloaded into Cornerstone3D
  // and the legacy cache becomes a second owner of pixels Cornerstone3D has already released.
  const deferredRemovals = new Set();

  function sweepDeferredRemovals(ignoredElement) {
    if (!deferredRemovals.size) {
      return;
    }

    for (const imageId of [...deferredRemovals]) {
      if (!imageCache.imageCache[imageId]) {
        // Removed by something else in the meantime.
        deferredRemovals.delete(imageId);
        continue;
      }

      if (isOnScreen(imageId, ignoredElement)) {
        continue;
      }

      deferredRemovals.delete(imageId);
      removeMirrorEntry(imageId);
    }
  }

  function onCornerstone3dImageRemoved(event) {
    sweepDeferredRemovals();

    const imageId = imageIdOf(event.detail);
    if (!imageId || !imageCache.imageCache[imageId]) {
      return;
    }

    if (isOnScreen(imageId)) {
      // Nothing is torn down under a viewport that is painting this image. The element holds its
      // own reference -- rendering reads `enabledElement.image`, never the cache -- so the frame
      // stays up either way, but removing the entry now would let a redraw re-request the image
      // and reload it while it is still on screen. Deferred to the moment the element moves on.
      deferredRemovals.add(imageId);
      return;
    }

    removeMirrorEntry(imageId);
  }

  // An element changing image is the moment it stops displaying the evicted one, and it is the
  // only signal that covers ordinary navigation: scrolling to a neighbour that is already in both
  // caches produces no cache event at all, so a sweep driven by cache events alone would leave the
  // stale entry in place and the bridge unreachable for that imageId.
  //
  // NEW_IMAGE is fired on the element rather than on the global target, so it is subscribed per
  // element, tracked through ELEMENT_ENABLED and ELEMENT_DISABLED.
  const watchedElements = new Map();

  function onNewImage() {
    sweepDeferredRemovals();
  }

  function watchElement(element) {
    if (!element || watchedElements.has(element)) {
      return;
    }

    element.addEventListener(EVENTS.NEW_IMAGE, onNewImage);
    watchedElements.set(element, onNewImage);
  }

  function unwatchElement(element) {
    if (!element || !watchedElements.has(element)) {
      return;
    }

    element.removeEventListener(EVENTS.NEW_IMAGE, watchedElements.get(element));
    watchedElements.delete(element);
  }

  function onElementEnabled(event) {
    watchElement(event.detail?.element);
  }

  function onElementDisabled(event) {
    const element = event.detail?.element;
    unwatchElement(element);
    // Swept with this element ignored: it is still in the enabled list at this point.
    sweepDeferredRemovals(element);
  }

  syncMaximumSize();

  // Elements enabled before the bridge was installed.
  try {
    cornerstone.getEnabledElements().forEach(enabled => watchElement(enabled.element));
  } catch (error) {
    // The library is not initialised yet; ELEMENT_ENABLED will pick them up.
  }

  const { IMAGE_CACHE_IMAGE_ADDED, IMAGE_CACHE_IMAGE_REMOVED } = c3dEnums.Events;
  c3dEventTarget.addEventListener(IMAGE_CACHE_IMAGE_ADDED, onCornerstone3dImageAdded);
  c3dEventTarget.addEventListener(IMAGE_CACHE_IMAGE_REMOVED, onCornerstone3dImageRemoved);
  legacyEvents.addEventListener(EVENTS.ELEMENT_ENABLED, onElementEnabled);
  legacyEvents.addEventListener(EVENTS.ELEMENT_DISABLED, onElementDisabled);

  return function uninstallLegacyCacheMirror() {
    c3dEventTarget.removeEventListener(IMAGE_CACHE_IMAGE_ADDED, onCornerstone3dImageAdded);
    c3dEventTarget.removeEventListener(IMAGE_CACHE_IMAGE_REMOVED, onCornerstone3dImageRemoved);
    legacyEvents.removeEventListener(EVENTS.ELEMENT_ENABLED, onElementEnabled);
    legacyEvents.removeEventListener(EVENTS.ELEMENT_DISABLED, onElementDisabled);
    [...watchedElements.keys()].forEach(unwatchElement);
  };
}

export default installLegacyCacheMirror;
