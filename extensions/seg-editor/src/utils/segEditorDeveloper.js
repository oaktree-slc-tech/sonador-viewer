// The Segmentation Editor's developer tools flag (ohif-viewers#149, AR-5): one boolean in the app
// config, `window.config.segEditor.developerTools`, default false. It shows the weld control in the
// 3D panel and enables the edit-case export; a production viewer shows neither.

/**
 * @param {Object} [config] - the app config (defaults to `window.config`)
 * @returns {boolean}
 */
export function isDeveloperToolsEnabled(config = typeof window !== 'undefined' ? window.config : undefined) {
  return config?.segEditor?.developerTools === true;
}

export default isDeveloperToolsEnabled;
