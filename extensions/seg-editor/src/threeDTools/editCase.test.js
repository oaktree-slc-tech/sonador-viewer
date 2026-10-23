// The developer edit-case bundle: built from a real cut, serialized, and replayed against the
// plain-array modules

import { isClosedManifold, uvSphere, verticesWhere } from './testing/meshes';
import { cutAndPatch, editIndexBox } from './deleteSelection';
import {
  buildEditCase,
  EDIT_CASE_SCHEMA,
  EDIT_CASE_VERSION,
  editCaseFileName,
  replayEditCase,
  serializeEditCase,
} from './editCase';
import { carveLabelmap, extractIndexBox } from './labelmapCarve';
import { fanCap } from './meshCut';
import { orientPatchToRim } from './meshRepair';


const N = 32;
const ORIGIN = -16;
const indexToWorld = ([i, j, k]) => [ORIGIN + i, ORIGIN + j, ORIGIN + k];

function labelmap() {
  const scalarData = new Uint8Array(N * N * N);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const [x, y, z] = indexToWorld([i, j, k]);
        scalarData[i + N * (j + N * k)] = Math.hypot(x, y, z) <= 10 ? 1 : 0;
      }
    }
  }
  return { scalarData, dimensions: [N, N, N], indexToWorld };
}

const cap = loop => {
  const patch = fanCap(loop);
  return { points: patch.points, triangles: orientPatchToRim(patch.triangles, loop.length / 3).triangles };
};
const patchHoles = async loops => loops.map(loop => ({ patch: cap(loop), method: 'fitted', attempts: [] }));
const surface = uvSphere({ radius: 9.6, segments: 16, rings: 16 });

async function recordedCase() {
  // The cut as the canvas runs it, and the write as the writer runs it, recorded on the memo
  const cells = [];
  for (let t = 0; t < surface.polys.length / 4; t++) {
    if ([1, 2, 3].every(k => surface.points[3 * surface.polys[4 * t + k] + 2] > 6)) {
      cells.push(t);
    }
  }
  const options = { closure: 'auto', rimCleanup: 'full', weldTolerance: 0, islandMaxTriangles: 50, maxConstraints: 8 };
  const cut = await cutAndPatch({ surface, selectedTriangles: cells, options, deps: { patchHoles } });
  const map = labelmap();
  const depth = 2;
  const { axes, indexBox } = editIndexBox({ editBox: cut.editBox, depth, labelmap: map });
  const boxBefore = extractIndexBox(map.scalarData, map.dimensions, indexBox);
  const remove = carveLabelmap({
    original: surface, edited: cut.edited, boxData: boxBefore, dimensions: map.dimensions, segmentIndex: 1,
    axes, indexBox, selectedPoints: cut.selectedPoints, depth,
  });
  const edit = {
    id: 7, operation: 'remove', segmentIndex: 1, options, depth, selected: cells,
    before: surface, after: cut.edited, selectedPoints: cut.selectedPoints, editBox: cut.editBox, cut,
  };
  const memo = {
    write: { kind: 'delete', selectedPoints: cut.selectedPoints, depth },
    surfaceOnly: false,
    writeReport: {
      status: 'written', kind: 'delete', domain: indexBox, domainVoxels: boxBefore.length,
      proposedRemove: remove.length, proposedAdd: 0, removed: remove.length, added: 0, dropped: 0, farField: 0,
      proposed: { remove: Array.from(remove), add: [] }, applied: { remove: Array.from(remove), add: [] },
      labelmap: { dimensions: map.dimensions, axes }, boxBefore,
    },
  };
  return { edit, memo, cut, remove };
}

describe('editCase', () => {
  it('builds a bundle of geometry and numbers only, and serializes typed arrays as arrays', async () => {
    const { edit, memo, cut } = await recordedCase();

    const bundle = buildEditCase({ edit, memo });

    expect(bundle).toMatchObject({
      schema: EDIT_CASE_SCHEMA, version: EDIT_CASE_VERSION, editId: 7, operation: 'remove', segmentIndex: 1, depth: 2,
      write: { kind: 'delete', status: 'written', farField: 0 },
    });
    expect(bundle.note).toMatch(/no DICOM attributes/);
    expect(bundle.note).toMatch(/can still identify a patient/);
    expect(bundle.diagnostics.inputEdges).toBeUndefined();
    expect(bundle.diagnostics).toMatchObject({ acceptable: true, removedTriangles: cut.diagnostics.removedTriangles });
    const keys = Object.keys(bundle);
    ['PatientID', 'StudyInstanceUID', 'SeriesInstanceUID', 'imageIds', 'segmentationId'].forEach(key => expect(keys).not.toContain(key));

    const json = serializeEditCase(bundle);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.before.points)).toBe(true);
    expect(parsed.before.points).toHaveLength(surface.points.length);
    expect(Array.isArray(parsed.write.boxBefore)).toBe(true);
    expect(parsed.write.proposed.remove).toEqual(Array.from(memo.writeReport.proposed.remove));
    expect(editCaseFileName(bundle, new Date('2026-10-18T12:34:56.789Z'))).toBe('seg-editor-3d-remove-20261018T123456Z.json');
  });

  it('replays a serialized case to the same diagnostics and proposed voxels', async () => {
    const { edit, memo } = await recordedCase();
    const parsed = JSON.parse(serializeEditCase(buildEditCase({ edit, memo })));

    const result = replayEditCase(parsed);

    expect(result.differences).toEqual([]);
    expect(result.matches).toBe(true);
    expect(result.replay.input).toEqual(parsed.diagnostics.input);
    expect(result.replay.introduced).toEqual(parsed.diagnostics.introduced);
    expect(result.replay.proposed.remove).toEqual(parsed.write.proposed.remove);
    expect(result.replay.farField).toBe(0);
    expect(isClosedManifold(parsed.after.polys)).toBe(true);
  });

  it('notices a case whose recorded outcome no longer matches the modules', async () => {
    const { edit, memo } = await recordedCase();
    const parsed = JSON.parse(serializeEditCase(buildEditCase({ edit, memo })));
    parsed.diagnostics.removedTriangles += 1;
    parsed.write.proposed.remove.pop();

    const result = replayEditCase(parsed);

    expect(result.matches).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.stringMatching(/removed triangles/), 'proposed voxels differ',
    ]));
    expect(replayEditCase({ schema: 'other', version: 1 }).matches).toBe(false);
  });

  it('describes a smooth and a pending write without a cut', () => {
    const bundle = buildEditCase({
      edit: { kind: 'smooth', moved: 12, options: { strength: 0.5 }, segmentIndex: 2, before: surface, after: surface, selected: [1] },
      memo: { write: { kind: 'smooth' }, surfaceOnly: false },
    });
    expect(bundle).toMatchObject({ operation: 'smooth', diagnostics: { moved: 12 }, write: { kind: 'smooth', status: 'pending' } });
    expect(verticesWhere(surface.points, () => true).length).toBe(surface.points.length / 3);
  });
});
