// Lazy, single-flight loader for the OpenCascade.js runtime used by the 3D editing tools
// (ohif-viewers#142).
//
// The runtime is Zalo's CascadeStudio build of opencascade.js (OCCT 8.0, the ~120 classes
// CascadeStudio uses, ES module, browser only). Its wasm is large (~27 MB), so nothing here is
// imported at app start: the glue and the wasm are fetched on the first `loadOpenCascade()` call
// and every later caller shares the same instance. A failed load is forgotten so a retry can
// succeed.

let occPromise = null;
let occInstance = null;

const defaultDeps = {
  // Emscripten factory (async, returns the initialised module)
  loadFactory: () => import(/* webpackChunkName: "opencascade" */ 'opencascade.js'),
  // Emitted as an asset; the import resolves to its URL
  loadWasmUrl: () =>
    import(/* webpackChunkName: "opencascade" */ 'opencascade.js/dist/cascadestudio.wasm'),
};

/**
 * Loads (once) and returns the OpenCascade.js module instance.
 *
 * @param {Object} [options]
 * @param {Object} [options.moduleArgs] - extra Emscripten module arguments
 * @param {Object} [options.deps] - injectable loaders (tests)
 * @returns {Promise<Object>}
 */
export function loadOpenCascade({ moduleArgs = {}, deps = {} } = {}) {
  if (occPromise) {
    return occPromise;
  }

  const { loadFactory, loadWasmUrl } = { ...defaultDeps, ...deps };

  occPromise = Promise.all([loadFactory(), loadWasmUrl()])
    .then(([factoryModule, wasmModule]) => {
      const factory = factoryModule.default || factoryModule;
      const wasmUrl = wasmModule.default || wasmModule;

      return factory({
        locateFile: file => (file.endsWith('.wasm') ? wasmUrl : file),
        ...moduleArgs,
      });
    })
    .then(instance => {
      occInstance = instance;
      return instance;
    })
    .catch(err => {
      occPromise = null;
      throw err;
    });

  return occPromise;
}

/** The loaded instance, or null until `loadOpenCascade()` has resolved. */
export function getOpenCascade() {
  return occInstance;
}

export function isOpenCascadeLoaded() {
  return occInstance !== null;
}

/** Forgets the loaded instance (tests). The wasm module itself cannot be unloaded. */
export function resetOpenCascadeForTests() {
  occPromise = null;
  occInstance = null;
}
