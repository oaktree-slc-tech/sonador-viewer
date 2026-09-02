// Canary over the pinned Cornerstone3D image cache.
//
// `volumeLease.release` re-stamps `sharedCacheKey` after removing a volume, and the unit tests for
// it model the library's behaviour in a mock. That model is only as good as the library it was
// read from, so the four facts it depends on are pinned here against the installed source. The
// library is ESM behind an `exports` map with no jest-resolvable entry point, so this reads the
// file rather than executing it -- a canary, not a behavioural test. If it fails after a
// Cornerstone3D bump, re-read `_putVolumeCommon`/`_decacheVolume` and re-check both the fix and
// the mock before touching this file.

import fs from 'fs';
import path from 'path';

function findPackageRoot() {
  let dir = __dirname;

  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules/@cornerstonejs/core');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  throw new Error('@cornerstonejs/core is not installed');
}

const PACKAGE_ROOT = findPackageRoot();
const VERSION = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
).version;
const SOURCE = fs.readFileSync(path.join(PACKAGE_ROOT, 'dist/esm/cache/cache.js'), 'utf8');

// Text of one method/arrow-property, from its name to the start of the next one.
function bodyOf(name) {
  const start = SOURCE.indexOf(name);
  expect(start).toBeGreaterThan(-1);

  const rest = SOURCE.slice(start + name.length);
  const next = rest.search(/\n\s{0,8}(?:this\.[a-zA-Z_]+ = |[a-zA-Z_]+\()/);

  return next === -1 ? rest : rest.slice(0, next);
}

describe('pinned Cornerstone3D cache behaviour', () => {
  it('is the version these assumptions were read from', () => {
    expect(VERSION).toBe('4.22.13');
  });

  it('stamps every slice of a loading volume with that volume id, unconditionally', () => {
    // Why a second volume over the same imageIds takes the protection from the first.
    const body = bodyOf('_putVolumeCommon(volumeId, volume, cachedVolume)');

    expect(body).toContain('volume.imageIds?.forEach');
    expect(body).toContain('image.sharedCacheKey = volumeId;');
    // No comparison against an existing key: whatever was there is overwritten.
    expect(body).not.toMatch(/sharedCacheKey\s*(===|!==|\?\?)/);
  });

  it('clears the stamp only where it names the volume being removed', () => {
    // Why removing the second volume leaves the first one's slices unprotected.
    const body = bodyOf('this._decacheVolume = (volumeId)');

    expect(body).toContain('cachedImage.sharedCacheKey === volumeId');
    expect(body).toContain('cachedImage.sharedCacheKey = undefined;');
  });

  it('evicts unstamped images first when it needs space', () => {
    // Why an unprotected slice under a live volume is a real defect and not a cosmetic one.
    const body = bodyOf('decacheIfNecessaryUntilBytesAvailable(numBytes, volumeImageIds)');

    expect(body).toContain('filter((cachedImage) => !cachedImage.sharedCacheKey)');
  });

  it('holds cached images in `_imageCache`, keyed by imageId', () => {
    // The field the re-stamp reaches for, there being no public setter for a shared cache key.
    expect(SOURCE).toContain('this._imageCache = new Map();');
    expect(SOURCE).toContain('const cachedImage = this._imageCache.get(imageId);');
    expect(SOURCE).not.toMatch(/set\s+sharedCacheKey|setSharedCacheKey/);
  });
});
