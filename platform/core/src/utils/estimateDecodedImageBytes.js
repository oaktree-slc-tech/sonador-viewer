// How much cache an image will occupy once decoded.
//
// The prefetch gate needs this before the request is made, so it cannot ask the cache -- the image
// does not exist yet. Every field it needs is in the image pixel module, which the metadata
// providers answer from the study's own metadata well before any pixels are fetched.

// Used when the pixel module cannot answer. Deliberately larger than a typical CT or MR frame
// (512 x 512 x 1 x 2 bytes is 512 KiB): the gate's job is to avoid overrunning the cache, so an
// unknown image must be assumed expensive rather than cheap.
export const CONSERVATIVE_DECODED_IMAGE_BYTES = 8 * 1024 * 1024;

// The widest typed array the loader will decode a monochrome frame into (Float32Array/Uint32Array).
export const MAX_DECODED_BYTES_PER_SAMPLE = 4;

/**
 * Bytes one sample occupies once decoded, as an upper bound.
 *
 * BitsAllocated describes the stored width, not the decoded one. The loader's
 * `postProcessDecodedPixels` picks the output typed array from the post-scale value range and will
 * promote to `Uint32Array` or `Float32Array`, and `createImage` charges the cache
 * `imageFrame.pixelData.byteLength` -- so a 16-bit monochrome source can occupy four bytes per
 * sample. Reserving two would leave the difference unaccounted, and with several concurrent
 * prefetches that shortfall eats the reserve this gate exists to protect.
 *
 * Colour images are not rescaled, so their stored width is their decoded width.
 */
function decodedBytesPerSample(samplesPerPixel, bitsAllocated) {
  const stored = Math.ceil(bitsAllocated / 8);

  if (samplesPerPixel > 1) {
    return stored;
  }

  return Math.max(stored, MAX_DECODED_BYTES_PER_SAMPLE);
}

/**
 * Estimate the decoded size of an image in bytes.
 *
 * @param {(type: string, imageId: string) => object} metaDataGet - a metaData.get implementation
 * @param {string} imageId
 * @param {number} [fallbackBytes] - used when the pixel module is unavailable or unusable
 * @returns {number} estimated bytes, never zero
 */
export default function estimateDecodedImageBytes(
  metaDataGet,
  imageId,
  fallbackBytes = CONSERVATIVE_DECODED_IMAGE_BYTES
) {
  let pixelModule;

  try {
    pixelModule = metaDataGet('imagePixelModule', imageId);
  } catch (error) {
    // A provider that throws takes the whole lookup with it; an estimate is not worth that.
    return fallbackBytes;
  }

  if (!pixelModule) {
    return fallbackBytes;
  }

  const { rows, columns, samplesPerPixel, bitsAllocated } = pixelModule;

  // Every field is required. Substituting a plausible value for a missing one produces a number
  // that looks authoritative and is not: an image whose metadata cannot be read is exactly the
  // case the conservative fallback exists for.
  const required = [rows, columns, samplesPerPixel, bitsAllocated];
  if (required.some(value => !Number.isFinite(value) || value <= 0)) {
    return fallbackBytes;
  }

  return rows * columns * samplesPerPixel * decodedBytesPerSample(samplesPerPixel, bitsAllocated);
}
