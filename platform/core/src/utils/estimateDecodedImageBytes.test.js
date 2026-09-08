// The prefetch gate has to know an image's cost before it exists, so the estimate comes from the
// pixel module rather than from the cache. What matters is that it never under-estimates when it
// cannot tell.

import estimateDecodedImageBytes, {
  CONSERVATIVE_DECODED_IMAGE_BYTES,
  MAX_DECODED_BYTES_PER_SAMPLE,
} from './estimateDecodedImageBytes';

const get = pixelModule => () => pixelModule;

describe('estimateDecodedImageBytes', () => {
  it('reserves the decoded width, not the stored width, for a monochrome image', () => {
    // BitsAllocated describes what is stored. `postProcessDecodedPixels` picks the output typed
    // array from the post-scale range and promotes to Uint32Array or Float32Array, and the cache is
    // charged `pixelData.byteLength` -- so a 16-bit source can occupy four bytes per sample.
    expect(estimateDecodedImageBytes(get({ rows: 512, columns: 512, samplesPerPixel: 1, bitsAllocated: 16 })))
      .toBe(512 * 512 * MAX_DECODED_BYTES_PER_SAMPLE);
    expect(estimateDecodedImageBytes(get({ rows: 512, columns: 512, samplesPerPixel: 1, bitsAllocated: 8 })))
      .toBe(512 * 512 * MAX_DECODED_BYTES_PER_SAMPLE);
  });

  it('uses the stored width for a colour image, which is not rescaled', () => {
    expect(estimateDecodedImageBytes(get({ rows: 256, columns: 128, samplesPerPixel: 3, bitsAllocated: 8 })))
      .toBe(256 * 128 * 3);
  });

  it('never reserves less than the stored width', () => {
    // 64-bit samples would exceed the promotion width; the bound has to be an upper one.
    expect(estimateDecodedImageBytes(get({ rows: 10, columns: 10, samplesPerPixel: 1, bitsAllocated: 64 })))
      .toBe(10 * 10 * 8);
  });

  it('treats every missing or invalid required field as an unknown image', () => {
    // Substituting a plausible default produces a number that looks authoritative and is not.
    for (const partial of [
      {},
      { rows: 512 },
      { rows: 512, columns: 512 },
      { rows: 512, columns: 512, samplesPerPixel: 1 },
      { columns: 512, samplesPerPixel: 1, bitsAllocated: 16 },
      { rows: 512, samplesPerPixel: 1, bitsAllocated: 16 },
      { rows: 512, columns: 512, bitsAllocated: 16 },
      { rows: 0, columns: 512, samplesPerPixel: 1, bitsAllocated: 16 },
      { rows: 512, columns: 512, samplesPerPixel: 0, bitsAllocated: 16 },
      { rows: 512, columns: 512, samplesPerPixel: 1, bitsAllocated: 0 },
    ]) {
      expect(estimateDecodedImageBytes(get(partial))).toBe(CONSERVATIVE_DECODED_IMAGE_BYTES);
    }
  });

  it('falls back conservatively when there is no pixel module at all', () => {
    expect(estimateDecodedImageBytes(get(undefined))).toBe(CONSERVATIVE_DECODED_IMAGE_BYTES);
  });

  it('survives a metadata provider that throws', () => {
    // Neither library wraps its providers, so a throwing one aborts the whole lookup.
    const throwing = () => {
      throw new Error('provider blew up');
    };
    expect(estimateDecodedImageBytes(throwing, 'wadors:x')).toBe(CONSERVATIVE_DECODED_IMAGE_BYTES);
  });

  it('honours a caller-supplied fallback', () => {
    expect(estimateDecodedImageBytes(get(undefined), 'x', 1234)).toBe(1234);
  });
});
