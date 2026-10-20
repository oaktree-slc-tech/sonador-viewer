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
// Two things do have to be reconciled, because the two stacks read them differently, and those
// are the cases where the legacy side gets a view rather than the image: the modality transform
// (see `withLegacyModalityTransform`) and the layout of color pixels (see `withLegacyColorLayout`).

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

  const view = createLegacyView(image);
  view.slope = 1;
  view.intercept = 0;

  return view;
}

/**
 * Hand the legacy stack color pixels in the layout it indexes them by.
 *
 * Every legacy reader of color pixels steps through them four bytes at a time: the renderer's
 * `storedColorPixelDataToCanvasImageData` reads R, G, B and skips one, `storedRGBA...` copies all
 * four, and cornerstone-tools' `getRGBPixels` (Probe, ROI stats) indexes `4 * (y * columns + x)`.
 * cornerstone-wado-image-loader honoured that: `useRGBA` defaulted to true, so a color frame was
 * decoded to RGBA and flagged `rgba: true`. The Cornerstone3D loader defaults it to false and keeps
 * three bytes a pixel, which is what its own viewports and volumes expect.
 *
 * Read at a stride of four, a three-byte frame does not fail -- it draws. Each canvas row consumes
 * a row and a third of source, so the picture repeats in vertical strips, R, G and B rotate from
 * pixel to pixel into banding, and the loop runs out of data three quarters of the way down,
 * leaving the bottom of the canvas blank. That is how every RGB, YBR and palette color series
 * looked in the classic 2D viewport and in thumbnails once the bridge took over decoding.
 *
 * Changing the loader's `useRGBA` instead would hand Cornerstone3D's own consumers a layout they
 * no longer expect, so the expansion happens here, on the legacy side only. It is the one place
 * the bridge holds a second copy of pixels, and it is built on first read rather than up front:
 * an image that only ever reaches Cornerstone3D viewports, or is evicted before the legacy stack
 * draws it, never pays for it. The copy lives on the view, so it goes when the mirror entry does.
 * `sizeInBytes` still reports the Cornerstone3D frame: the legacy cache's total must stay in step
 * with Cornerstone3D's so that its LRU never runs first (see cacheMirror.js).
 *
 * The window is reset to the one the old loader gave every color image, 255/127. Cornerstone3D
 * leaves it undefined for a color frame with no VOI LUT module, and the legacy color LUT has no
 * fallback of its own for a missing window.
 *
 * @param {object} image - a Cornerstone3D image, or a view over one
 * @returns {object} the image, or a view over it with RGBA pixels
 */
function withLegacyColorLayout(image) {
  if (!image.color || image.rgba) {
    return image;
  }

  const pixelCount = image.rows * image.columns;
  const pixelData = image.getPixelData();
  if (!pixelCount || pixelData.length !== pixelCount * 3) {
    // Not a layout this knows how to expand. Left as it is rather than guessed at.
    return image;
  }

  const view = createLegacyView(image);
  let rgba;

  view.getPixelData = () => {
    if (!rgba) {
      rgba = expandRgbToRgba(image.getPixelData(), pixelCount);
    }
    return rgba;
  };
  view.rgba = true;
  view.windowWidth = 255;
  view.windowCenter = 127;

  return view;
}

function expandRgbToRgba(rgb, pixelCount) {
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let source = 0, target = 0; target < rgba.length; source += 3, target += 4) {
    rgba[target] = rgb[source];
    rgba[target + 1] = rgb[source + 1];
    rgba[target + 2] = rgb[source + 2];
    rgba[target + 3] = 255;
  }

  return rgba;
}

/**
 * A view over a Cornerstone3D image for the legacy side: assignments land on the view, reads fall
 * through to the image.
 *
 * @param {object} image - a Cornerstone3D image
 * @returns {object} the view
 */
function createLegacyView(image) {
  const view = Object.create(image);

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

  return withLegacyColorLayout(withLegacyModalityTransform(image));
}
