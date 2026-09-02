// Cornerstone3D request-pool, cache-ceiling and web-worker configuration.
//
// Cornerstone3D 4.22.13 ships an effectively unbounded image-load pool (1000 per request type);
// phase 1 drives one loadAndCacheImage request per slice through it, so bounding it is a
// prerequisite rather than a tuning. Every @cornerstonejs package here is ESM-only and untransformed
// in this node test environment, so all four are replaced with recording doubles.

const mockSetMaxSimultaneousRequests = jest.fn();
const mockSetMaxCacheSize = jest.fn();
const mockCoreInit = jest.fn().mockResolvedValue(undefined);
const mockDicomImageLoaderInit = jest.fn().mockResolvedValue(undefined);
const mockToolsInit = jest.fn().mockResolvedValue(undefined);
const mockPolySegInit = jest.fn().mockResolvedValue(undefined);
const mockGetSupportedTextureFormats = jest.fn(() => ({ norm16: true, norm16Linear: true }));
const mockGetShouldUseCPURendering = jest.fn(() => false);
const mockGetAuthorizationHeader = jest.fn(() => ({ Authorization: 'Bearer test-token' }));

jest.mock('@cornerstonejs/core', () => ({
  init: (...args) => mockCoreInit(...args),
  cache: { setMaxCacheSize: (...args) => mockSetMaxCacheSize(...args) },
  imageLoadPoolManager: {
    setMaxSimultaneousRequests: (...args) => mockSetMaxSimultaneousRequests(...args),
  },
  Enums: {
    RequestType: {
      Interaction: 'interaction',
      Thumbnail: 'thumbnail',
      Prefetch: 'prefetch',
      Compute: 'compute',
    },
  },
  getShouldUseCPURendering: (...args) => mockGetShouldUseCPURendering(...args),
}));

// The norm16 probe lives on a subpath because the memoised `getCanUseNorm16Texture` is not
// exported from the package entry point at all (see the note in cornerstone3d.js).
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({
  getSupportedTextureFormats: (...args) => mockGetSupportedTextureFormats(...args),
}), { virtual: true });
// `virtual` because these packages' exports maps do not present an entry point jest can resolve.
jest.mock('@cornerstonejs/tools', () => ({ init: (...args) => mockToolsInit(...args) }), {
  virtual: true,
});
jest.mock('@cornerstonejs/dicom-image-loader', () => ({
  init: (...args) => mockDicomImageLoaderInit(...args),
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({
  init: (...args) => mockPolySegInit(...args),
}), { virtual: true });
jest.mock('./polySegSingleFlight', () => ({ createSingleFlightPolySeg: polySeg => polySeg }));
jest.mock('../DICOMWeb/getAuthorizationHeader', () => ({
  __esModule: true,
  default: (...args) => mockGetAuthorizationHeader(...args),
}));

const DEFAULTS = { interaction: 10, thumbnail: 5, prefetch: 5, compute: 10 };

function poolLimits() {
  return Object.fromEntries(mockSetMaxSimultaneousRequests.mock.calls);
}

// The module latches its init promise, so each case needs a fresh copy of it.
function loadModule() {
  let mod;
  jest.isolateModules(() => {
    mod = require('./cornerstone3d');
  });
  return mod;
}

describe('initCornerstone3d configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSupportedTextureFormats.mockReturnValue({ norm16: true, norm16Linear: true });
    mockGetShouldUseCPURendering.mockReturnValue(false);
  });

  it('applies the upstream OHIF v3 pool defaults and leaves the cache ceiling alone', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({});

    expect(poolLimits()).toEqual(DEFAULTS);
    // No maxCacheSizeBytes in the config means the library's own 3 GiB default stands.
    expect(mockSetMaxCacheSize).not.toHaveBeenCalled();
  });

  it('behaves as the library defaults when there is no cornerstone3d section at all', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d();

    expect(poolLimits()).toEqual(DEFAULTS);
    expect(mockSetMaxCacheSize).not.toHaveBeenCalled();
  });

  it('applies pool limits and the cache ceiling from appConfig', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({
      cornerstone3d: {
        maxNumRequests: { interaction: 20, thumbnail: 3, prefetch: 40, compute: 8 },
        maxCacheSizeBytes: 1024 * 1024 * 1024,
      },
    });

    expect(poolLimits()).toEqual({
      interaction: 20,
      thumbnail: 3,
      prefetch: 40,
      compute: 8,
    });
    expect(mockSetMaxCacheSize).toHaveBeenCalledWith(1024 * 1024 * 1024);
  });

  it('falls back to the default for any request type the config omits', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({ cornerstone3d: { maxNumRequests: { interaction: 2 } } });

    expect(poolLimits()).toEqual({ ...DEFAULTS, interaction: 2 });
  });

  it('passes maxWebWorkers to the dicom image loader', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({ cornerstone3d: { maxWebWorkers: 3 } });

    expect(mockDicomImageLoaderInit.mock.calls[0][0]).toMatchObject({ maxWebWorkers: 3 });
  });

  it('gives the loader an auth hook, so remote series are not requested anonymously', async () => {
    // Regression: the volumetric surfaces load through @cornerstonejs/dicom-image-loader, which
    // has its own options and none of the legacy loader's configuration. Without this, every
    // wadors frame request went out unauthenticated and came back 403.
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({});

    const { beforeSend } = mockDicomImageLoaderInit.mock.calls[0][0];
    expect(typeof beforeSend).toBe('function');

    // v3's contract: beforeSend RETURNS headers, which the loader merges over its defaults --
    // it does not set them on the xhr the way the legacy loader's beforeSend(xhr) did.
    expect(await beforeSend()).toEqual({ Authorization: 'Bearer test-token' });
  });

  it('forwards loader transport errors to the app httpErrorHandler', async () => {
    const httpErrorHandler = jest.fn();
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({ httpErrorHandler });

    const { errorInterceptor } = mockDicomImageLoaderInit.mock.calls[0][0];
    const error = new Error('403');
    errorInterceptor(error);

    expect(httpErrorHandler).toHaveBeenCalledWith(error);
  });

  it('defaults maxWebWorkers to the value the legacy web-worker init uses', async () => {
    // Same formula as platform/viewer/src/utils/initWebWorkers.js, so the two decode pools do not
    // size themselves differently on the same machine.
    global.navigator = { hardwareConcurrency: 16 };
    try {
      const { initCornerstone3d } = loadModule();

      await initCornerstone3d({});

      expect(mockDicomImageLoaderInit.mock.calls[0][0]).toMatchObject({ maxWebWorkers: 6 });
    } finally {
      delete global.navigator;
    }
  });

  it('floors maxWebWorkers at 1 on a single-core client', async () => {
    global.navigator = { hardwareConcurrency: 1 };
    try {
      const { initCornerstone3d } = loadModule();

      await initCornerstone3d({});

      expect(mockDicomImageLoaderInit.mock.calls[0][0]).toMatchObject({ maxWebWorkers: 1 });
    } finally {
      delete global.navigator;
    }
  });

  it('is idempotent: repeat calls do not re-run init or re-apply configuration', async () => {
    const { initCornerstone3d } = loadModule();

    await initCornerstone3d({ cornerstone3d: { maxNumRequests: { interaction: 7 } } });
    // The second caller's config is ignored -- the first one won.
    await initCornerstone3d({ cornerstone3d: { maxNumRequests: { interaction: 99 } } });

    expect(mockCoreInit).toHaveBeenCalledTimes(1);
    expect(mockToolsInit).toHaveBeenCalledTimes(1);
    expect(poolLimits().interaction).toBe(7);
  });

  it('hands the GPU pre-flight Cornerstone3D norm16 and CPU-rendering facts', async () => {
    // The extension probes clean for NEAREST but not LINEAR, which is exactly the case
    // `getCanUseNorm16Texture` exists to catch: norm16 is NOT usable.
    mockGetSupportedTextureFormats.mockReturnValue({ norm16: true, norm16Linear: false });
    mockGetShouldUseCPURendering.mockReturnValue(true);

    let gpuCapabilities;
    let initCornerstone3d;
    jest.isolateModules(() => {
      gpuCapabilities = require('./gpuCapabilities');
      ({ initCornerstone3d } = require('./cornerstone3d'));
    });

    // A context that advertises the extension, so the report reflects what was pushed in rather
    // than the module's own fallback probe.
    global.document = {
      createElement: () => ({
        getContext: () => ({
          RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3, MAX_3D_TEXTURE_SIZE: 4,
          getParameter: () => 2048,
          getExtension: name => (name === 'EXT_texture_norm16' ? { R16_SNORM_EXT: 1 } : null),
        }),
      }),
    };

    try {
      await initCornerstone3d({ cornerstone3d: { volumeTextureBudgetBytes: 1234567 } });

      expect(mockGetSupportedTextureFormats).toHaveBeenCalled();
      expect(gpuCapabilities.getVolumeTextureBudgetBytes()).toBe(1234567);

      const capabilities = gpuCapabilities.getGpuCapabilities();
      // norm16 requires BOTH filters; the extension being present is not enough, which is the
      // whole reason the library probes rather than feature-detects.
      expect(capabilities.norm16).toBe(false);
      expect(capabilities.cpuRendering).toBe(true);
    } finally {
      delete global.document;
    }
  });
});
