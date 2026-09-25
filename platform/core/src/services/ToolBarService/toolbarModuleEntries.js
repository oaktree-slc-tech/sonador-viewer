/**
 * Toolbar modules come in two shapes. The Sonador Viewer's own toolbar (`ToolbarRow`) reads
 * the v2 `{ definitions, defaultContext }` object; the OHIF v3 ToolbarService reads an array
 * of button UI types (`{ name, defaultComponent, evaluate }`). A v2 module may also carry v3
 * entries under `uiTypes`, which lets one extension contribute to both toolbars.
 *
 * @param {Object|Array} toolbarModule - the value returned by an extension's getToolbarModule
 * @returns {Object[]} the OHIF v3 button UI type entries in the module
 */
export function getToolbarUITypeEntries(toolbarModule) {
  if (Array.isArray(toolbarModule)) {
    return toolbarModule;
  }

  if (Array.isArray(toolbarModule?.uiTypes)) {
    return toolbarModule.uiTypes;
  }

  return [];
}

export default getToolbarUITypeEntries;
