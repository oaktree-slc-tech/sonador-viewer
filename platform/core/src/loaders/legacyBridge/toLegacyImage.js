// The object the bridge hands back to the legacy renderer.
//
// It is the Cornerstone3D image itself, not a copy and not a spread. Cornerstone3D's `IImage`
// declares every field the legacy renderer reads, and it still declares the CPU-fallback slots the
// legacy renderer writes (`render`, `modalityLUT`, `voiLUT`, `colormap`, `cachedLut`, `stats`), so
// the two stacks can share one object without either seeing a field it does not expect.
//
// Sharing the object is the point: `getPixelData()` must return the same typed array the
// Cornerstone3D cache entry holds, so a series shown in a 2D viewport and in MPR is decoded once
// and held once. Anything that rebuilt the object would silently reintroduce the second copy this
// phase exists to remove.
//
// One field pair does have to be reconciled, because the two stacks read it differently, and that
// is the one case where the legacy side gets a view rather than the image. See
// `withLegacyModalityTransform`.

/**
 * Reconcile `slope` and `intercept` with pixel data the loader has already rescaled.
 *
 * Both stacks read these as the modality transform *still to be applied* to whatever
 * `getPixelData()` returns. The Cornerstone3D loader rescales monochrome pixels to modality units
 * during decode -- `createImage` defaults `preScale.enabled` to true, and the decode worker applies
 * the transform, records `preScale.scaled` and reports post-scale min/max -- but it still reports
 * the file's RescaleSlope and RescaleIntercept on the image. Cornerstone3D's renderer knows and
 * skips its modality LUT (`image.isPreScaled = image.preScale?.scaled`); the legacy renderer has
 * no such field and applies `storedValue * slope + intercept` to values that already have it.
 *
 * For MR the transform is the identity, so nothing looks wrong. For CT it is a shift of around
 * -1024 HU, and the window from the VOI LUT module then lands nowhere near the tissue it was
 * chosen for -- which is why CT previews, thumbnails and the classic 2D viewport all rendered at
 * the wrong level while MPR was correct.
 *
 * The identity goes on a prototype-chained view rather than on the image, which is the isolation
 * AR-2 provides for: the Cornerstone3D cache entry keeps the file's values for its own consumers
 * and `getPixelData` is inherited, so the typed array is still shared. The file's values also
 * remain on `preScale.scalingParameters`, which is where Cornerstone3D records them.
 *
 * @param {object} image - a Cornerstone3D image
 * @returns {object} the image, or a view over it with the transform neutralised
 */
function withLegacyModalityTransform(image) {
  if (!image.preScale || !image.preScale.scaled) {
    return image;
  }

  const view = Object.create(image);
  view.slope = 1;
  view.intercept = 0;

  // A prototype only isolates *assignments*. Two of the slots the legacy renderer uses are objects
  // it mutates through, so an inherited one would be written into -- the Cornerstone3D image's,
  // shared with whatever put it there:
  //
  // - `cachedLut`: `generateLut` allocates only `if (image.cachedLut === undefined)`, so an
  //   inherited object makes it skip the allocation and write its `lutArray` into that object.
  //   `getLut` then records the window state on it as well. Cornerstone3D's CPU fallback renderer
  //   builds the same structure under its own assumptions, so a CPU render followed by a legacy
  //   thumbnail is enough to reach this.
  // - `stats`: `image.stats = image.stats || {}` keeps an inherited object and the render
  //   functions time themselves into it.
  //
  // Shadowing both as own `undefined` puts the boundary where the prototype cannot: the legacy
  // renderer finds nothing, allocates its own, and its allocation lands on the view.
  view.cachedLut = undefined;
  view.stats = undefined;

  return view;
}

/**
 * Assert the invariants the legacy cache and renderer depend on, and hand the image over.
 *
 * @param {object} image - a Cornerstone3D image
 * @param {string} imageId - the id it was requested under, for the error message
 * @returns {object} the image, or an AR-2 view over it
 */
export default function toLegacyImage(image, imageId) {
  if (!image || typeof image !== 'object') {
    throw new Error(`[legacyBridge] Cornerstone3D returned no image for ${imageId}.`);
  }

  // The legacy cache throws on a missing or non-numeric sizeInBytes, but only later, inside a
  // promise callback where the imageId is no longer in scope. Failing here names the image.
  if (typeof image.sizeInBytes !== 'number' || !Number.isFinite(image.sizeInBytes)) {
    throw new Error(
      `[legacyBridge] Image ${imageId} has no numeric sizeInBytes (${typeof image.sizeInBytes}).`
    );
  }

  if (typeof image.getPixelData !== 'function') {
    throw new Error(`[legacyBridge] Image ${imageId} has no getPixelData().`);
  }

  // Cornerstone3D's `ensureVoxelManager` replaces `getPixelData` and deletes
  // `imageFrame.pixelData` on IMAGE_LOADED, so this is the only remaining route to the pixels.
  const pixelData = image.getPixelData();
  if (!ArrayBuffer.isView(pixelData)) {
    throw new Error(
      `[legacyBridge] Image ${imageId} did not return a typed array from getPixelData().`
    );
  }

  return withLegacyModalityTransform(image);
}
