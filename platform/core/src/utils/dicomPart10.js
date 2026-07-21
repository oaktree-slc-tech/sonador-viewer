// Lightweight DICOM Part10 stream checks for the local/offline cache (ohif-viewers#125).
//
// Why this exists: WADO-RS retrieval with `transfer-syntax=*` returns the instance EXACTLY as the
// archive stored it. Files authored by client-side tooling (dcmjs-based M3D/PDF/SEG writers) can
// carry a sparse file-meta group without TransferSyntaxUID (0002,0010) — dicomParser.parseDicom
// then throws "missing required meta header attribute 0002,0010". Requests WITHOUT the
// transfer-syntax parameter make the server compose a normalized Part10 (complete meta), which is
// why the same objects load fine online. These helpers let the download manager detect the sparse
// case and refetch the normalized form, and let cache readers reject bad records.

const DICM_OFFSET = 128;

/** True when the buffer starts with a Part10 preamble + 'DICM' magic. */
export function hasDicmPrefix(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (
    u8.length > DICM_OFFSET + 4 &&
    u8[DICM_OFFSET] === 0x44 && // D
    u8[DICM_OFFSET + 1] === 0x49 && // I
    u8[DICM_OFFSET + 2] === 0x43 && // C
    u8[DICM_OFFSET + 3] === 0x4d // M
  );
}

/**
 * True when the file-meta group contains TransferSyntaxUID (0002,0010). The meta group is always
 * explicit-VR little endian, so the element starts with the byte sequence
 * 02 00 10 00 55 49 ("UI"); scanning the first few KB is sufficient — the meta group precedes the
 * dataset and is small.
 */
export function hasMetaTransferSyntax(bytes, searchLimit = 4096) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = Math.min(u8.length - 6, searchLimit);

  for (let i = DICM_OFFSET + 4; i < end; i++) {
    if (
      u8[i] === 0x02 && u8[i + 1] === 0x00 &&
      u8[i + 2] === 0x10 && u8[i + 3] === 0x00 &&
      u8[i + 4] === 0x55 && u8[i + 5] === 0x49
    ) {
      return true;
    }
  }
  return false;
}

/** Full check used before caching / serving: Part10 magic AND a parseable meta header. */
export function isUsablePart10(bytes) {
  return !!bytes && bytes.byteLength > 0 && hasDicmPrefix(bytes) && hasMetaTransferSyntax(bytes);
}

export default { hasDicmPrefix, hasMetaTransferSyntax, isUsablePart10 };
