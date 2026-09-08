// Makes legacy `cornerstone.metaData.get` answer from Cornerstone3D.
//
// There is one source of truth for metadata -- the Cornerstone3D providers, backed by
// DicomMetadataStore -- and two front doors onto it. The legacy provider stays registered
// underneath as a fallback for any module name Cornerstone3D does not answer; the sunset phase
// deletes it once that list is empty.

import { metaData as c3dMetaData } from '@cornerstonejs/core';

/**
 * Wrap Cornerstone3D's metaData.get so it can never break the legacy lookup.
 *
 * Neither library's `metaData.get` wraps its providers in try/catch: both walk the list and take
 * the first non-undefined answer, so a provider that throws aborts the whole lookup rather than
 * falling through to the next one. Since this delegate sits at the top of the legacy chain, an
 * exception raised anywhere in the Cornerstone3D chain would take out every legacy consumer's
 * metadata, not just this one answer.
 */
export function createMetadataDelegate() {
  return function legacyMetadataDelegate(type, imageId) {
    try {
      // The id is passed through exactly as the legacy caller supplied it. Frame-suffix
      // normalisation belongs to the Cornerstone3D provider, which is the one place that knows
      // how its own map is keyed; rewriting ids here would give the two front doors different
      // behaviour for the same image.
      return c3dMetaData.get(type, imageId);
    } catch (error) {
      console.warn(`[legacyBridge] Cornerstone3D metadata lookup failed for ${type}.`, error);
      return undefined;
    }
  };
}

/**
 * Register the delegate above the legacy provider.
 *
 * @param {object} cornerstone - the legacy cornerstone-core module
 * @param {object} [options]
 * @param {object} [options.legacyProvider] - the provider to keep as fallback (CornerstoneMetadataProvider)
 * @param {number} [options.legacyPriority] - priority for that fallback
 * @returns {Function} the delegate that was registered
 */
export function registerLegacyMetadataDelegate(cornerstone, options) {
  const { legacyProvider, legacyPriority = 0 } = options || {};

  const delegate = createMetadataDelegate();

  // Both are registered here rather than in two modules so the ordering is visible in one place:
  // providers are consulted highest-first and the first non-undefined answer wins, which is the
  // whole of "Cornerstone3D answers, the legacy provider fills gaps".
  cornerstone.metaData.addProvider(delegate, 9999);

  if (legacyProvider) {
    cornerstone.metaData.addProvider(legacyProvider.get.bind(legacyProvider), legacyPriority);
  }

  return delegate;
}

export default registerLegacyMetadataDelegate;
