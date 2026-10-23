// A reproducible record of a 3D edit for developers (ohif-viewers#149, FR-12): the surface before
// and after, the selection, the options, the diagnostics, and the voxels the write proposed and
// applied, so a case seen in the browser can be replayed against the plain-array modules in Node.
//
// Geometry and numbers only: no DICOM attributes, identifiers or study metadata are included.
// That does not make a bundle anonymous: anatomical geometry can identify a patient, so a bundle
// made from real data keeps the handling restrictions of its source. The export is available with
// the developer tools flag only (utils/segEditorDeveloper).

import { assembleCut, prepareCut } from './deleteSelection.js';
import { carveLabelmap, deltaLabelmap } from './labelmapCarve.js';
import { compareDefects, conditionSurface, surfaceDiagnostics } from './meshRepair.js';
import { WRITE_KINDS } from './surfaceEditMemo.js';

export const EDIT_CASE_SCHEMA = 'sonador.segEditor.3dEditCase';
export const EDIT_CASE_VERSION = 1;

export const EDIT_CASE_NOTE = 'Geometry and numbers only: no DICOM attributes, identifiers or study metadata. '
  + 'Anatomical geometry can still identify a patient; a bundle made from real data keeps the handling '
  + 'restrictions of its source.';

const _surface = surface => (surface
  ? { points: surface.points, polys: surface.polys, patchPolysOffset: surface.patchPolysOffset }
  : null);

/**
 * The bundle of an edit (built on Apply, and again once its write has run).
 *
 * @param {Object} params
 * @param {Object} params.edit - the canvas's applied edit (before, after, selected, cut, options...)
 * @param {Object} params.memo - its surface-edit memo (write descriptor, writeReport once run)
 * @returns {Object} a JSON-serializable bundle once passed through serializeEditCase
 */
export function buildEditCase({ edit, memo }) {
  const diagnostics = { ...(edit.cut?.diagnostics || {}) };
  delete diagnostics.inputEdges;
  const report = memo?.writeReport || null;
  return {
    schema: EDIT_CASE_SCHEMA,
    version: EDIT_CASE_VERSION,
    note: EDIT_CASE_NOTE,
    editId: edit.id ?? null,
    operation: edit.operation || (edit.kind === 'smooth' ? 'smooth' : edit.repair ? 'repair' : 'remove'),
    segmentIndex: edit.segmentIndex,
    options: edit.options || null,
    depth: edit.depth ?? 0,
    selectedTriangles: Array.from(edit.selected || []),
    selectedPoints: edit.selectedPoints || null,
    before: _surface(edit.before),
    after: _surface(edit.after),
    editBox: edit.editBox || null,
    diagnostics: edit.kind === 'smooth'
      ? { moved: edit.moved, options: edit.options }
      : diagnostics,
    write: memo
      ? {
        kind: memo.write?.kind || null,
        surfaceOnly: !!memo.surfaceOnly,
        ...(report || { status: 'pending' }),
      }
      : null,
  };
}

/** JSON of a bundle, with typed arrays written as plain arrays. */
export function serializeEditCase(bundle) {
  return JSON.stringify(bundle, (key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value), 2);
}

/** The file name a bundle downloads as. */
export function editCaseFileName(bundle, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `seg-editor-3d-${bundle.operation || 'edit'}-${stamp}.json`;
}

/**
 * Download a bundle as a JSON file through a temporary object URL (browser only).
 *
 * @param {Object} bundle
 * @param {Object} [deps] - the document and URL to use (tests)
 * @returns {string} the file name
 */
export function downloadEditCase(bundle, { doc = typeof document !== 'undefined' ? document : null, url = typeof URL !== 'undefined' ? URL : null } = {}) {
  const name = editCaseFileName(bundle);
  if (!doc || !url?.createObjectURL) {
    throw new Error('The edit case can only be downloaded in a browser');
  }
  const blob = new Blob([serializeEditCase(bundle)], { type: 'application/json' });
  const href = url.createObjectURL(blob);
  try {
    const anchor = doc.createElement('a');
    anchor.href = href;
    anchor.download = name;
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    doc.body.removeChild(anchor);
  } finally {
    setTimeout(() => url.revokeObjectURL(href), 0);
  }
  return name;
}

const _same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Replay a bundle against the plain-array modules and compare with what the browser recorded: the
 * cut's input diagnostics and counts, the result's diagnostics and introduced defects, and the
 * write's proposed voxels (when the bundle holds the labelmap box). No OpenCascade is needed: the
 * recorded result surface is diagnosed as it is, and the patch stage is not refitted.
 *
 * @param {Object} bundle - a parsed bundle (arrays, as serializeEditCase writes them)
 * @returns {{ matches: boolean, differences: string[], replay: Object }}
 */
export function replayEditCase(bundle) {
  const differences = [];
  const replay = {};
  if (bundle.schema !== EDIT_CASE_SCHEMA || bundle.version !== EDIT_CASE_VERSION) {
    differences.push(`schema ${bundle.schema} v${bundle.version} is not ${EDIT_CASE_SCHEMA} v${EDIT_CASE_VERSION}`);
    return { matches: false, differences, replay };
  }
  const before = bundle.before && {
    points: Float32Array.from(bundle.before.points), polys: Int32Array.from(bundle.before.polys),
  };
  const after = bundle.after?.points?.length && {
    points: Float32Array.from(bundle.after.points), polys: Int32Array.from(bundle.after.polys),
  };
  const recorded = bundle.diagnostics || {};

  if (bundle.operation === 'remove' && before) {
    const prepared = prepareCut({
      surface: before, selectedTriangles: bundle.selectedTriangles, options: bundle.options || {},
    });
    replay.input = prepared.diagnostics.input;
    replay.removedTriangles = prepared.diagnostics.removedTriangles;
    replay.holes = prepared.loops?.length || 0;
    replay.preexistingLoops = prepared.diagnostics.preexistingLoops;
    if (!_same(replay.input, recorded.input)) {
      differences.push('input diagnostics differ');
    }
    if (replay.removedTriangles !== recorded.removedTriangles) {
      differences.push(`removed triangles ${replay.removedTriangles} vs ${recorded.removedTriangles}`);
    }
    if (recorded.preexistingLoops && !_same(replay.preexistingLoops, recorded.preexistingLoops)) {
      differences.push('pre-existing loops differ');
    }
    if (after && prepared.changed) {
      const outputDiagnostics = surfaceDiagnostics(conditionSurface(after).triangles);
      replay.output = {
        boundaryEdgeCount: outputDiagnostics.boundaryEdgeCount,
        nonManifoldEdgeCount: outputDiagnostics.nonManifoldEdgeCount,
        inconsistentEdgeCount: outputDiagnostics.inconsistentEdgeCount,
        closed: outputDiagnostics.closed,
      };
      replay.introduced = compareDefects(
        { points: before.points, diagnostics: prepared.diagnostics.inputEdges },
        { points: after.points, diagnostics: outputDiagnostics });
      if (!_same(replay.output, recorded.output)) {
        differences.push('output diagnostics differ');
      }
      if (recorded.introduced && !_same(replay.introduced, recorded.introduced)) {
        differences.push('introduced defects differ');
      }
    }
  } else if (before && after) {
    const outputDiagnostics = surfaceDiagnostics(conditionSurface(after).triangles);
    replay.output = { closed: outputDiagnostics.closed, boundaryEdgeCount: outputDiagnostics.boundaryEdgeCount };
  }

  const write = bundle.write;
  if (write?.proposed && write.labelmap && write.boxBefore && write.domain) {
    const args = {
      original: before,
      edited: after || null,
      boxData: Uint8Array.from(write.boxBefore),
      dimensions: write.labelmap.dimensions,
      segmentIndex: bundle.segmentIndex,
      axes: write.labelmap.axes,
      indexBox: write.domain,
    };
    const proposed = write.kind === WRITE_KINDS.smooth
      ? deltaLabelmap(args)
      : { remove: carveLabelmap({ ...args, selectedPoints: bundle.selectedPoints, depth: bundle.depth }), add: new Int32Array(0) };
    replay.proposed = { remove: Array.from(proposed.remove), add: Array.from(proposed.add) };
    if (!_same(replay.proposed, write.proposed)) {
      differences.push('proposed voxels differ');
    }
    const { dimensions } = write.labelmap;
    const outside = [...replay.proposed.remove, ...replay.proposed.add].filter(index => {
      const i = index % dimensions[0];
      const j = Math.floor(index / dimensions[0]) % dimensions[1];
      const k = Math.floor(index / (dimensions[0] * dimensions[1]));
      const { min, max } = write.domain;
      return i < min[0] || i > max[0] || j < min[1] || j > max[1] || k < min[2] || k > max[2];
    }).length;
    replay.farField = outside;
    if (outside !== (write.farField || 0)) {
      differences.push(`far-field voxels ${outside} vs ${write.farField || 0}`);
    }
  }
  // assembleCut is exported for callers that hold the patch results too
  replay.assembleCut = assembleCut;
  delete replay.assembleCut;
  return { matches: differences.length === 0, differences, replay };
}
