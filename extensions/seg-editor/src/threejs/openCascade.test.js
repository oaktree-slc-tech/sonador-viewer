// OpenCascade.js loader (ohif-viewers#142)

import {
  getOpenCascade,
  isOpenCascadeLoaded,
  loadOpenCascade,
  resetOpenCascadeForTests,
} from './openCascade';

const WASM_URL = '/static/wasm/cascadestudio.abc123.wasm';

function setup({ factory } = {}) {
  const instance = { name: 'occ' };
  const factoryFn = jest.fn(factory || (async () => instance));
  const deps = {
    loadFactory: jest.fn(async () => ({ default: factoryFn })),
    loadWasmUrl: jest.fn(async () => ({ default: WASM_URL })),
  };
  return { instance, factoryFn, deps };
}

describe('loadOpenCascade', () => {
  afterEach(() => resetOpenCascadeForTests());

  it('initialises the Emscripten module with the wasm asset URL', async () => {
    const { instance, factoryFn, deps } = setup();

    expect(isOpenCascadeLoaded()).toBe(false);
    expect(getOpenCascade()).toBeNull();

    const occ = await loadOpenCascade({ deps });

    expect(occ).toBe(instance);
    expect(getOpenCascade()).toBe(instance);
    expect(isOpenCascadeLoaded()).toBe(true);

    const { locateFile } = factoryFn.mock.calls[0][0];
    expect(locateFile('cascadestudio.wasm')).toBe(WASM_URL);
    expect(locateFile('cascadestudio.data')).toBe('cascadestudio.data');
  });

  it('shares one load between concurrent and later callers', async () => {
    const { instance, factoryFn, deps } = setup();

    const [a, b] = await Promise.all([loadOpenCascade({ deps }), loadOpenCascade({ deps })]);
    const c = await loadOpenCascade({ deps });

    expect(a).toBe(instance);
    expect(b).toBe(instance);
    expect(c).toBe(instance);
    expect(factoryFn).toHaveBeenCalledTimes(1);
    expect(deps.loadFactory).toHaveBeenCalledTimes(1);
    expect(deps.loadWasmUrl).toHaveBeenCalledTimes(1);
  });

  it('passes extra module arguments through', async () => {
    const { factoryFn, deps } = setup();
    const print = jest.fn();

    await loadOpenCascade({ deps, moduleArgs: { print } });

    expect(factoryFn.mock.calls[0][0].print).toBe(print);
  });

  it('forgets a failed load so the next call retries', async () => {
    const { deps } = setup();
    let attempts = 0;
    deps.loadFactory = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network');
      }
      return { default: async () => ({ name: 'occ-retry' }) };
    });

    await expect(loadOpenCascade({ deps })).rejects.toThrow('network');
    expect(isOpenCascadeLoaded()).toBe(false);

    await expect(loadOpenCascade({ deps })).resolves.toEqual({ name: 'occ-retry' });
    expect(deps.loadFactory).toHaveBeenCalledTimes(2);
  });
});
