// The legacy-facing bridge: the classic 2D viewport reads pixels and metadata from Cornerstone3D.
//
// Cornerstone3D is the only decoder and the only owner of pixel memory. The legacy stack --
// react-cornerstone-viewport, cornerstone-tools, the legacy segmentation module, tool state, and
// every legacy call site -- is untouched and sits on top of this.
//
// The bridge is built to be deleted. Everything it installs is installed from `installLegacyBridge`
// below, so removing that one call and this directory is the whole of its removal. Nothing outside
// this directory may import from it.

import { registerLegacyBridgeLoaders } from './bridgeImageLoader.js';
import { installLegacyCacheMirror } from './cacheMirror.js';
import { registerLegacyMetadataDelegate } from './metadataDelegate.js';

/**
 * Install the bridge. Called once, from the viewer's setConfiguration, in place of the
 * cornerstone-wado-image-loader registration block it replaces.
 *
 * @param {object} deps
 * @param {object} deps.cornerstone - the legacy cornerstone-core module
 * @param {object} [deps.legacyMetadataProvider] - CornerstoneMetadataProvider, kept as fallback
 * @returns {{uninstall: Function}} uninstall removes what can be removed (the cache listeners);
 *   loader and provider registration is not reversible in either library.
 */
export function installLegacyBridge({ cornerstone, legacyMetadataProvider }) {
  if (!cornerstone) {
    throw new Error('[legacyBridge] installLegacyBridge requires the legacy cornerstone module.');
  }

  registerLegacyBridgeLoaders(cornerstone);
  registerLegacyMetadataDelegate(cornerstone, { legacyProvider: legacyMetadataProvider });
  const uninstallMirror = installLegacyCacheMirror(cornerstone);

  return { uninstall: uninstallMirror };
}

export default installLegacyBridge;
