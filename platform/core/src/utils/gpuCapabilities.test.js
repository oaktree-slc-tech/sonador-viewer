// Unit tests for the GPU capability report and the volume-fit pre-flight.
//
// `assessVolumeFit` is exercised with an injected capability report rather than a real context:
// this package's jest environment is `node`, and the decision logic is what phase 1 depends on.

import {
  DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES,
  assessVolumeFit,
  bytesPerVoxel,
  configureGpuCapabilities,
  getGpuCapabilities,
  getLastVolumeFitAssessment,
  resetGpuCapabilities,
} from './gpuCapabilities';

const GPU = {
  webgl2: true,
  renderer: 'ANGLE (NVIDIA GeForce RTX 3060)',
  vendor: 'Google Inc.',
  maxTextureSize: 16384,
  max3dTextureSize: 2048,
  norm16: true,
  floatLinear: true,
  softwareRendered: false,
  cpuRendering: false,
};

const NO_NORM16 = { ...GPU, norm16: false };

describe('bytesPerVoxel', () => {
  it('uses 2 bytes for 16-bit data only when norm16 is usable', () => {
    expect(bytesPerVoxel('Int16Array', true)).toBe(2);
    expect(bytesPerVoxel('Uint16Array', true)).toBe(2);
    expect(bytesPerVoxel('Int16Array', false)).toBe(4);
    expect(bytesPerVoxel('Uint16Array', false)).toBe(4);
  });

  it('always uses 4 bytes for Float32 and 1 byte for 8-bit data', () => {
    expect(bytesPerVoxel('Float32Array', true)).toBe(4);
    expect(bytesPerVoxel('Float32Array', false)).toBe(4);
    expect(bytesPerVoxel('Uint8Array', true)).toBe(1);
    expect(bytesPerVoxel('Uint8Array', false)).toBe(1);
  });

  it('falls back to 4 bytes for an unknown data type', () => {
    expect(bytesPerVoxel(undefined, true)).toBe(4);
    expect(bytesPerVoxel('SomethingElse', true)).toBe(4);
  });
});

describe('assessVolumeFit', () => {
  afterEach(() => {
    resetGpuCapabilities();
  });

  it('accepts a volume that fits the default 0.75 GiB budget', () => {
    // 512 x 512 x 1500 x 2 bytes = 786,432,000 <= 805,306,368.
    const result = assessVolumeFit({
      dimensions: [512, 512, 1500],
      dataType: 'Int16Array',
      capabilities: GPU,
    });

    expect(result.fits).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.textureBytes).toBe(512 * 512 * 1500 * 2);
    expect(result.budgetBytes).toBe(DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES);
    expect(result.suggestedDecimation).toBeNull();
  });

  it('rejects on budget when 16-bit data has to be widened to R32F', () => {
    // Without norm16 the same series is uploaded at 4 bytes/voxel:
    // 512 x 512 x 1600 x 4 = 1,677,721,600, over twice the budget.
    const result = assessVolumeFit({
      dimensions: [512, 512, 1600],
      dataType: 'Int16Array',
      capabilities: NO_NORM16,
    });

    expect(result.fits).toBe(false);
    expect(result.reason).toBe('budget');
    expect(result.textureBytes).toBe(512 * 512 * 1600 * 4);
    // k=2 still leaves 838,860,800 bytes, which is over the 805,306,368 budget; k=3 is the first
    // factor that fits.
    expect(result.suggestedDecimation).toEqual([1, 1, 3]);
  });

  it('rejects on budget at 512x512x1600 even with norm16, and keeps the in-plane resolution', () => {
    // 512 x 512 x 1600 x 2 = 838,860,800 > 805,306,368.
    const result = assessVolumeFit({
      dimensions: [512, 512, 1600],
      dataType: 'Int16Array',
      capabilities: GPU,
    });

    expect(result.reason).toBe('budget');
    expect(result.suggestedDecimation).toEqual([1, 1, 2]);
  });

  it('rejects on depth past MAX_3D_TEXTURE_SIZE and suggests a decimation that fits', () => {
    const result = assessVolumeFit({
      dimensions: [512, 512, 3000],
      dataType: 'Int16Array',
      capabilities: GPU,
    });

    expect(result.fits).toBe(false);
    expect(result.reason).toBe('depth');
    expect(result.maxDepth).toBe(2048);

    const [i, j, k] = result.suggestedDecimation;
    expect([i, j]).toEqual([1, 1]);
    expect(Math.ceil(3000 / k)).toBeLessThanOrEqual(2048);
    expect(512 * 512 * Math.ceil(3000 / k) * 2).toBeLessThanOrEqual(
      DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES
    );
  });

  it('falls back to in-plane decimation when slice decimation alone cannot fit the volume', () => {
    // At 4096 x 4096 x 4 bytes a single slice is 67 MB, so no slice-decimation factor within the
    // search bound gets the volume under the budget; the in-plane factor has to move.
    const result = assessVolumeFit({
      dimensions: [4096, 4096, 2048],
      dataType: 'Float32Array',
      capabilities: GPU,
    });

    expect(result.reason).toBe('budget');

    const [i, j, k] = result.suggestedDecimation;
    expect([i, j]).toEqual([2, 2]);
    expect(2048 * 2048 * Math.ceil(2048 / k) * 4).toBeLessThanOrEqual(
      DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES
    );
  });

  it('reports no-webgl without a WebGL2 context and suggests nothing', () => {
    const result = assessVolumeFit({
      dimensions: [512, 512, 100],
      dataType: 'Int16Array',
      capabilities: { ...GPU, webgl2: false, max3dTextureSize: 0 },
    });

    expect(result.fits).toBe(false);
    expect(result.reason).toBe('no-webgl');
    expect(result.suggestedDecimation).toBeNull();
  });

  it('honours a configured budget over the default', () => {
    configureGpuCapabilities({ volumeTextureBudgetBytes: 2 * 1024 * 1024 * 1024 });

    const result = assessVolumeFit({
      dimensions: [512, 512, 1600],
      dataType: 'Int16Array',
      capabilities: GPU,
    });

    expect(result.reason).toBe('ok');
    expect(result.budgetBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it('records the last assessment with its inputs for the debug surface', () => {
    assessVolumeFit({
      dimensions: [512, 512, 3000],
      dataType: 'Int16Array',
      capabilities: GPU,
    });

    const last = getLastVolumeFitAssessment();
    expect(last.dimensions).toEqual([512, 512, 3000]);
    expect(last.dataType).toBe('Int16Array');
    expect(last.bytesPerVoxel).toBe(2);
    expect(last.reason).toBe('depth');
  });
});

describe('getGpuCapabilities', () => {
  afterEach(() => {
    resetGpuCapabilities();
    delete global.document;
  });

  it('reports no WebGL2 when there is no document to create a canvas on', () => {
    delete global.document;

    const capabilities = getGpuCapabilities();

    expect(capabilities.webgl2).toBe(false);
    expect(capabilities.max3dTextureSize).toBe(0);
    expect(capabilities.norm16).toBe(false);
  });

  it('reads the limits off a WebGL2 context and memoises the report', () => {
    const gl = makeFakeGl({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' });
    const getContext = jest.fn(() => gl);
    global.document = { createElement: () => ({ getContext }) };

    const first = getGpuCapabilities();
    const second = getGpuCapabilities();

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.webgl2).toBe(true);
    expect(first.max3dTextureSize).toBe(2048);
    expect(first.maxTextureSize).toBe(16384);
    expect(first.renderer).toBe('llvmpipe (LLVM 15.0.7, 256 bits)');
    // llvmpipe is a software rasteriser.
    expect(first.softwareRendered).toBe(true);
  });

  it('prefers the norm16 answer Cornerstone3D supplies over the extension probe', () => {
    // The extension is present, but Cornerstone3D's stricter NEAREST+LINEAR render probe failed.
    global.document = {
      createElement: () => ({ getContext: () => makeFakeGl({ norm16Extension: true }) }),
    };

    configureGpuCapabilities({ norm16: false, cpuRendering: true });
    const capabilities = getGpuCapabilities();

    expect(capabilities.norm16).toBe(false);
    expect(capabilities.cpuRendering).toBe(true);
    expect(capabilities.softwareRendered).toBe(true);
  });
});

function makeFakeGl({ renderer = 'ANGLE (Intel UHD Graphics)', norm16Extension = false } = {}) {
  const gl = {
    RENDERER: 0x1f01,
    VENDOR: 0x1f00,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    getParameter: jest.fn(name => {
      if (name === 0x1f01) {
        return renderer;
      }
      if (name === 0x1f00) {
        return 'Test Vendor';
      }
      if (name === 0x0d33) {
        return 16384;
      }
      if (name === 0x8073) {
        return 2048;
      }
      return 0;
    }),
    getExtension: jest.fn(name => {
      if (name === 'EXT_texture_norm16' && norm16Extension) {
        return { R16_SNORM_EXT: 0x8f98 };
      }
      if (name === 'WEBGL_lose_context') {
        return { loseContext: () => {} };
      }
      return null;
    }),
  };

  return gl;
}
