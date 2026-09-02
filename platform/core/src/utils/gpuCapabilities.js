// GPU capability discovery and volume-fit pre-flight for the Cornerstone3D-primary loader.
//
// Why this exists: neither Cornerstone3D 4.22.13 nor vtk.js 34.15.1 checks MAX_3D_TEXTURE_SIZE or
// reads a GL error after texStorage3D. An over-size 3D texture samples as zero and renders as a
// uniform grey field with no error anywhere in the console, so phase 1 has to decide BEFORE it
// allocates a volume texture whether the series can be rendered on this client at all.
//
// Framework-free and side-effect-free. Nothing here imports Cornerstone3D or touches a
// rendering engine; the two facts that only Cornerstone3D knows (its norm16 probe result and
// whether it fell back to CPU rendering) are pushed in through `configureGpuCapabilities` by
// `initCornerstone3d` after `init()` has run. The only side effect is a throwaway canvas context,
// created at most once per session for `getGpuCapabilities()`.

/**
 * Default texture budget: 0.75 GiB. This is the Direct3D 11 per-resource ceiling for a
 * 3 GiB-VRAM client -- min(max(128, 0.25 x VRAM), 2048) MB -- which is the lowest hardware class
 * the deployment's environment matrix expects to be present. VRAM is not readable from
 * JavaScript, so this is a deliberate conservative floor rather than an inferred value; a
 * deployment raises it from `appConfig.cornerstone3d.volumeTextureBudgetBytes` once
 * `probeTextureAllocation` has established the real ceiling for its clients.
 */
export const DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES = 0.75 * 1024 * 1024 * 1024;

// Renderer strings that mean "there is no GPU here".
const SOFTWARE_RENDERER_PATTERNS = [/swiftshader/i, /\bwarp\b/i, /llvmpipe/i];

// Upper bound on the slice-decimation factor searched by `_suggestDecimation`. Beyond this the
// series is not usefully renderable as a volume and phase 1 should fall back rather than decimate.
const MAX_DECIMATION = 64;

let _capabilities = null;
let _lastAssessment = null;

let _config = {
  volumeTextureBudgetBytes: DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES,
  // Undefined means "probe for it"; a boolean is Cornerstone3D's own answer.
  norm16: undefined,
  cpuRendering: false,
};

/**
 * Supply the values this module cannot work out for itself. Called by `initCornerstone3d` with the
 * `appConfig.cornerstone3d` section and Cornerstone3D's post-init rendering facts.
 *
 * @param {object} [settings]
 * @param {number} [settings.volumeTextureBudgetBytes] - per-volume texture ceiling
 * @param {boolean} [settings.norm16] - Cornerstone3D's `getCanUseNorm16Texture()` result
 * @param {boolean} [settings.cpuRendering] - Cornerstone3D's `getShouldUseCPURendering()` result
 */
export function configureGpuCapabilities(settings = {}) {
  const { volumeTextureBudgetBytes, norm16, cpuRendering } = settings;

  if (Number.isFinite(volumeTextureBudgetBytes) && volumeTextureBudgetBytes > 0) {
    _config.volumeTextureBudgetBytes = volumeTextureBudgetBytes;
  }
  if (typeof norm16 === 'boolean') {
    _config.norm16 = norm16;
  }
  if (typeof cpuRendering === 'boolean') {
    _config.cpuRendering = cpuRendering;
  }

  // The memo may have been taken before Cornerstone3D reported in; re-probe on next request.
  _capabilities = null;
}

/** Drop the memoised capability report and every configured value. Test seam. */
export function resetGpuCapabilities() {
  _capabilities = null;
  _lastAssessment = null;
  _config = {
    volumeTextureBudgetBytes: DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES,
    norm16: undefined,
    cpuRendering: false,
  };
}

/** The configured per-volume texture budget in bytes. */
export function getVolumeTextureBudgetBytes() {
  return _config.volumeTextureBudgetBytes;
}

function _createContext() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') || null;
  } catch (error) {
    return null;
  }
}

function _loseContext(gl) {
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (error) {
    // Losing the throwaway context is best-effort; the canvas is unreferenced either way.
  }
}

function _noWebGlCapabilities() {
  return {
    webgl2: false,
    renderer: null,
    vendor: null,
    maxTextureSize: 0,
    max3dTextureSize: 0,
    norm16: false,
    floatLinear: false,
    softwareRendered: !!_config.cpuRendering,
    cpuRendering: !!_config.cpuRendering,
  };
}

function _probeCapabilities() {
  const gl = _createContext();

  if (!gl) {
    return _noWebGlCapabilities();
  }

  let renderer = null;
  let vendor = null;

  // WEBGL_debug_renderer_info is the only way to see the real adapter; Firefox and privacy modes
  // withhold it, in which case the generic RENDERER string is all there is.
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  try {
    renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    vendor = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
  } catch (error) {
    renderer = null;
    vendor = null;
  }

  // Cornerstone3D's own answer wins when it has one: its probe renders through EXT_texture_norm16
  // with both NEAREST and LINEAR filtering, which is stricter (and more honest) than asking whether
  // the extension is merely present. The extension check is the fallback for callers that reach
  // this module before `initCornerstone3d` has reported in.
  const norm16 =
    typeof _config.norm16 === 'boolean'
      ? _config.norm16
      : !!gl.getExtension('EXT_texture_norm16');

  const capabilities = {
    webgl2: true,
    renderer: renderer || null,
    vendor: vendor || null,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0,
    max3dTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) || 0,
    norm16,
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    softwareRendered:
      !!_config.cpuRendering ||
      SOFTWARE_RENDERER_PATTERNS.some(pattern => pattern.test(renderer || '')),
    cpuRendering: !!_config.cpuRendering,
  };

  _loseContext(gl);

  return capabilities;
}

/**
 * The client's rendering limits, memoised for the session. Creates at most one throwaway
 * WebGL2 context.
 */
export function getGpuCapabilities() {
  if (!_capabilities) {
    _capabilities = _probeCapabilities();
  }

  return _capabilities;
}

/**
 * Texture bytes per voxel for a Cornerstone3D volume `dataType`. The volume's dataType is
 * decided by `generateVolumePropsFromImageIds._determineDataType`: 16-bit signed or a negative
 * rescale gives Int16Array, unsigned gives Uint16Array, a float rescale gives Float32Array.
 *
 * 16-bit data is uploaded as R16_SNORM (2 bytes) only when norm16 is usable; otherwise it is
 * widened to R32F. Anything unrecognised is treated as 4 bytes, which is the conservative answer.
 */
export function bytesPerVoxel(dataType, norm16) {
  const name = String(dataType || '');

  if (/^u?int8/i.test(name)) {
    return 1;
  }
  if (/^u?int16/i.test(name)) {
    return norm16 ? 2 : 4;
  }

  return 4;
}

function _suggestDecimation({ x, y, z, bpv, maxDepth, budgetBytes }) {
  // The smallest [1, 1, k], then [2, 2, k], that brings both depth and bytes within limits.
  const inPlaneFactors = [1, 2];

  for (const inPlane of inPlaneFactors) {
    const dx = Math.ceil(x / inPlane);
    const dy = Math.ceil(y / inPlane);

    for (let k = 1; k <= MAX_DECIMATION; k++) {
      const dz = Math.ceil(z / k);

      if (dz <= maxDepth && dx * dy * dz * bpv <= budgetBytes) {
        return [inPlane, inPlane, k];
      }
    }
  }

  return null;
}

/**
 * Decide whether a volume of this shape can be allocated on this client.
 *
 * Decision order: no WebGL2 -> 'no-webgl'; depth over MAX_3D_TEXTURE_SIZE -> 'depth'; texture bytes
 * over the budget -> 'budget'; otherwise 'ok'.
 *
 * @param {object} input
 * @param {number[]} input.dimensions - [x, y, z]
 * @param {string} input.dataType - typed-array name, e.g. 'Int16Array'
 * @param {object} [input.capabilities] - override the session report (tests, and phase 1 replay)
 * @param {number} [input.budgetBytes] - override the configured budget
 * @returns {{fits: boolean, reason: string, textureBytes: number, budgetBytes: number,
 *            maxDepth: number, suggestedDecimation: number[]|null}}
 */
export function assessVolumeFit(input = {}) {
  const { dimensions, dataType } = input;
  const capabilities = input.capabilities || getGpuCapabilities();
  const budgetBytes = Number.isFinite(input.budgetBytes)
    ? input.budgetBytes
    : _config.volumeTextureBudgetBytes;

  const [x = 0, y = 0, z = 0] = dimensions || [];
  const bpv = bytesPerVoxel(dataType, capabilities.norm16);
  const textureBytes = x * y * z * bpv;
  const maxDepth = capabilities.max3dTextureSize || 0;

  let reason = 'ok';
  if (!capabilities.webgl2) {
    reason = 'no-webgl';
  } else if (z > maxDepth) {
    reason = 'depth';
  } else if (textureBytes > budgetBytes) {
    reason = 'budget';
  }

  const assessment = {
    fits: reason === 'ok',
    reason,
    textureBytes,
    budgetBytes,
    maxDepth,
    suggestedDecimation:
      reason === 'depth' || reason === 'budget'
        ? _suggestDecimation({ x, y, z, bpv, maxDepth, budgetBytes })
        : null,
  };

  _lastAssessment = {
    ...assessment,
    dimensions: [x, y, z],
    dataType,
    bytesPerVoxel: bpv,
  };

  return assessment;
}

/** The most recent `assessVolumeFit` result, with its inputs. Surfaced under window.__sonador.gpu. */
export function getLastVolumeFitAssessment() {
  return _lastAssessment;
}

const GL_NO_ERROR = 0;
const GL_OUT_OF_MEMORY = 0x0505;

/**
 * Allocate a 3D texture of the given shape on a throwaway WebGL2 context and report whether the
 * driver accepted it.
 *
 * This is NOT run automatically: it is a diagnostic, and a flag-gated option for callers that
 * want a real allocation rather than an estimate. It deliberately takes its own context rather
 * than the memoised one, because
 * an out-of-memory allocation can lose the context it ran on.
 *
 * @param {object} shape
 * @param {number} shape.width
 * @param {number} shape.height
 * @param {number} shape.depth
 * @param {'R16_SNORM'|'R32F'|'R16F'|'R8'} [shape.internalFormat]
 * @returns {{ok: boolean, reason: string, glError: number|null, contextLost: boolean}}
 */
export function probeTextureAllocation({ width, height, depth, internalFormat = 'R16_SNORM' } = {}) {
  const gl = _createContext();

  if (!gl) {
    return { ok: false, reason: 'no-webgl', glError: null, contextLost: false };
  }

  let format;
  if (internalFormat === 'R16_SNORM') {
    // R16_SNORM lives on the extension object, not on the context.
    format = gl.getExtension('EXT_texture_norm16')?.R16_SNORM_EXT;
  } else {
    format = gl[internalFormat];
  }

  if (format === undefined) {
    _loseContext(gl);
    return { ok: false, reason: 'unsupported-format', glError: null, contextLost: false };
  }

  let texture = null;
  let glError = GL_NO_ERROR;

  try {
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, texture);
    // Clear any error left over from context setup so getError() reports only this allocation.
    gl.getError();
    gl.texStorage3D(gl.TEXTURE_3D, 1, format, width, height, depth);
    glError = gl.getError();
  } catch (error) {
    glError = GL_OUT_OF_MEMORY;
  } finally {
    if (texture) {
      try {
        gl.deleteTexture(texture);
      } catch (error) {
        // The context is already gone; nothing to release.
      }
    }
  }

  const contextLost = typeof gl.isContextLost === 'function' ? gl.isContextLost() : false;

  let reason = 'ok';
  if (contextLost) {
    reason = 'context-lost';
  } else if (glError === GL_OUT_OF_MEMORY) {
    reason = 'OUT_OF_MEMORY';
  } else if (glError !== GL_NO_ERROR) {
    reason = `gl-error-${glError}`;
  }

  _loseContext(gl);

  return { ok: reason === 'ok', reason, glError, contextLost };
}

export default {
  DEFAULT_VOLUME_TEXTURE_BUDGET_BYTES,
  configureGpuCapabilities,
  resetGpuCapabilities,
  getVolumeTextureBudgetBytes,
  getGpuCapabilities,
  bytesPerVoxel,
  assessVolumeFit,
  getLastVolumeFitAssessment,
  probeTextureAllocation,
};
