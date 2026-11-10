// The Segmentation Editor's import commands: file window, source readers, the import and its report

import createImportCommands, { formatBounds, IMPORT_FILE_TYPES, isImportableSeries, volumeFileKind } from './importCommands';

jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    display: { DisplaySetApi: { Instance: { displaySetService: { getDisplaySetByUID: () => undefined } } } },
    utils: { DicomLoaderService: {}, studyMetadataManager: { all: () => [] }, color: { hex2rgb: () => [0, 0, 0] } },
  },
}), { virtual: true });
jest.mock('@ohif/i18n', () => ({
  __esModule: true,
  default: {
    t: (key, options = {}) => key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name])),
  },
}), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({
  isSTLDisplaySet: displaySet => displaySet?.m3dModelType === 'model/stl',
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ cache: {}, utilities: {}, getWebWorkerManager: () => ({}) }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: { state: {}, segmentLocking: {}, triggerSegmentationEvents: {} },
  utilities: { segmentation: {} },
  ToolGroupManager: { getToolGroup: () => undefined },
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: () => {} }), { virtual: true });
jest.mock('../threeDTools/registerHoleFillingWorker', () => ({ registerHoleFillingWorker: () => {} }));
jest.mock('../threeDTools/registerLabelmapCarveWorker', () => ({ registerLabelmapCarveWorker: () => {} }));
jest.mock('./pickLocalFiles.js', () => ({ pickLocalFiles: jest.fn() }));
// The unit declaration's dialogs are UI (the viewer's dialog shell); the tests answer through
// `askModelUnits` and `confirmAsRead`
jest.mock('../components/confirmDialog', () => ({ callConfirmDialog: jest.fn() }));
jest.mock('../components/stlUnitsDialog', () => ({ callStlUnitsDialog: jest.fn() }));


const SEG = { displaySetInstanceUID: 'seg', Modality: 'SEG' };
const STL = { displaySetInstanceUID: 'stl', Modality: 'M3D', m3dModelType: 'model/stl', numImageFrames: 2 };
const CT = { displaySetInstanceUID: 'ct', Modality: 'CT' };
const DISPLAY_SETS = { seg: SEG, stl: STL, ct: CT };

const file = (name, bytes = [1, 2, 3]) => ({ name, arrayBuffer: async () => Uint8Array.from(bytes).buffer });

function setup({ segmentationId = 'work', deps = {}, logger = true } = {}) {
  const services = {
    UINotificationService: { show: jest.fn() },
    segmentationService: { id: 'segService' },
    ...(logger ? { LoggerService: { error: jest.fn() } } : {}),
  };
  const result = {
    segments: [{ segmentIndex: 2, label: 'femur', voxels: 10 }, { segmentIndex: 3, label: 'patella', voxels: 4 }],
    emptySegments: [{ label: 'tibia' }],
    overlapVoxels: 0,
    lockedVoxels: 0,
    writtenVoxels: 14,
    sourceBounds: { min: [-10.4, 0, 0], max: [10.5, 20, 30] },
    targetBounds: { min: [100, 100, 100], max: [300, 300, 200] },
  };
  const allDeps = {
    pickFiles: jest.fn(async () => []),
    readStlFiles: jest.fn(async () => ({ models: [{ label: 'femur' }] })),
    readM3DSeries: jest.fn(async () => ({ models: [{ label: 'a' }] })),
    readDicomSeg: jest.fn(() => ({ grid: {}, segments: [], overlapVoxels: 3 })),
    readNrrd: jest.fn(() => ({ grid: {}, segments: [] })),
    readNifti: jest.fn(() => ({ grid: {}, segments: [] })),
    importInto: jest.fn(async () => result),
    getContext: jest.fn(() => (segmentationId ? { segmentationId } : null)),
    getDisplaySet: jest.fn(uid => DISPLAY_SETS[uid]),
    getStudies: jest.fn(() => ['study']),
    fetchInstanceBytes: jest.fn(async () => Uint8Array.from([7, 8, 9])),
    setStatus: jest.fn(),
    // An image calibrated in millimetres, unless a test says otherwise, whose bounds are not at
    // hand (no comparison of the models with it), and models declared in millimetres
    getUnits: jest.fn(() => ({ length: 'mm' })),
    getImageBounds: jest.fn(() => null),
    askModelUnits: jest.fn(async () => 'mm'),
    confirmAsRead: jest.fn(async () => true),
    recordProvenance: jest.fn(),
    ...deps,
  };
  const { actions, definitions } = createImportCommands({ servicesManager: { services }, deps: allDeps });
  return { actions, definitions, services, deps: allDeps, result };
}

const notifications = services => services.UINotificationService.show.mock.calls.map(([n]) => [n.type, n.message]);

describe('volumeFileKind / isImportableSeries', () => {
  it('tells NRRD and NIfTI files apart by name', () => {
    expect(volumeFileKind('Segmentation.seg.nrrd')).toBe('nrrd');
    expect(volumeFileKind('labels.NII')).toBe('nifti');
    expect(volumeFileKind('labels.nii.gz')).toBe('nifti');
    expect(volumeFileKind('labels.txt')).toBeUndefined();
  });

  it('formats bounds rounded, in millimetres or the unit given, and a dash when there are none', () => {
    expect(formatBounds({ min: [-1.6, 0, 2], max: [3.4, 5, 6] })).toBe('x -2 to 3, y 0 to 5, z 2 to 6 mm');
    expect(formatBounds({ min: [0, 0, 0], max: [3, 3, 3] }, 'grid units')).toBe('x 0 to 3, y 0 to 3, z 0 to 3 grid units');
    expect(formatBounds(null)).toBe('-');
  });

  it('admits STL model series and DICOM-SEG series only', () => {
    expect(isImportableSeries(SEG)).toBe(true);
    expect(isImportableSeries(STL)).toBe(true);
    expect(isImportableSeries(CT)).toBe(false);
    expect(isImportableSeries({ Modality: 'M3D', m3dModelType: 'model/gltf-binary' })).toBe(false);
    expect(isImportableSeries(undefined)).toBe(false);
  });
});

describe('importStlModels', () => {
  it('opens the file window for STL files and imports the chosen ones, reporting the result', async () => {
    const { actions, services, deps, result } = setup();
    const files = [file('femur.stl'), file('tibia.stl')];
    deps.pickFiles.mockResolvedValue(files);

    expect(await actions.importStlModels()).toBe(result);

    expect(deps.pickFiles).toHaveBeenCalledWith(IMPORT_FILE_TYPES.stl);
    expect(deps.readStlFiles).toHaveBeenCalledWith(files);
    expect(deps.importInto).toHaveBeenCalledWith({
      segmentationId: 'work',
      // The declared unit travels with each model (ohif-viewers#151 FR-5)
      payload: { models: [{ label: 'femur', provenance: { sourceUnit: 'mm', origin: 'declared', scale: 1, destination: 'mm' } }] },
      segmentationService: services.segmentationService,
      onProgress: expect.any(Function),
    });
    // What the 3D view shows while it runs: nothing behind the unit dialog, cleared at the end
    expect(deps.setStatus.mock.calls).toEqual([
      ['work', 'Reading 2 file(s)...'],
      ['work', null],
      ['work', 'Placing 1 segment(s) on the image grid...'],
      ['work', null],
    ]);
    expect(notifications(services)).toEqual([
      ['info', 'Importing 2 model(s)...'],
      ['success', 'Added 2 segment(s): femur, patella'],
      ['warning', 'These segments have no voxels on the image grid and were not added: tibia. '
        + 'The image spans x 100 to 300, y 100 to 300, z 100 to 200 mm; the imported data spans x -10 to 11, y 0 to 20, z 0 to 30 mm.'],
    ]);
  });

  it('says when locked segments kept their voxels', async () => {
    const { actions, services, deps, result } = setup();
    deps.pickFiles.mockResolvedValue([file('femur.stl')]);
    deps.importInto.mockResolvedValue({ ...result, lockedVoxels: 12 });

    await actions.importStlModels();

    expect(notifications(services)).toContainEqual(
      ['info', 'Where the imported segments overlap locked segments, the locked segments were kept.']);
  });

  it('does nothing when the window is cancelled', async () => {
    const { actions, services, deps } = setup();
    expect(await actions.importStlModels()).toBeUndefined();
    expect(deps.importInto).not.toHaveBeenCalled();
    expect(services.UINotificationService.show).not.toHaveBeenCalled();
  });

  it('asks for an open editor first', async () => {
    const { actions, services, deps } = setup({ segmentationId: null });
    expect(await actions.importStlModels()).toBeUndefined();
    expect(deps.pickFiles).not.toHaveBeenCalled();
    expect(notifications(services)).toEqual([['warning', 'Open a segmentation in the Segmentation Editor first.']]);
  });

  it('logs and shows a failure, leaving the segmentation as it was', async () => {
    const { actions, services, deps } = setup();
    deps.pickFiles.mockResolvedValue([file('bad.stl')]);
    const error = new Error('bad.stl has no triangles');
    deps.readStlFiles.mockRejectedValue(error);

    expect(await actions.importStlModels()).toBeUndefined();

    expect(deps.importInto).not.toHaveBeenCalled();
    expect(services.LoggerService.error).toHaveBeenCalledWith({
      error, title: 'Import STL Models', message: 'The import failed: bad.stl has no triangles', notify: true,
    });
    expect(deps.setStatus).toHaveBeenLastCalledWith('work', null);
  });

  it('reports each model as it is converted', async () => {
    const { actions, deps } = setup();
    deps.pickFiles.mockResolvedValue([file('a.stl'), file('b.stl')]);
    deps.readStlFiles.mockResolvedValue({ models: [{ label: 'a' }, { label: 'b' }] });
    deps.importInto.mockImplementation(async ({ onProgress }) => {
      onProgress(0.5);
      onProgress(1);
      return { segments: [], emptySegments: [], overlapVoxels: 0 };
    });

    await actions.importStlModels();

    expect(deps.setStatus.mock.calls.map(([, message]) => message)).toEqual([
      'Reading 2 file(s)...', null, 'Placing 2 segment(s) on the image grid...',
      'Converting model 2 of 2...', 'Converting model 2 of 2...', null,
    ]);
  });

  it('reports a cancelled import as a warning, not a failure, and lets nothing late put a status back', async () => {
    const { actions, services, deps } = setup();
    deps.pickFiles.mockResolvedValue([file('a.stl')]);
    let lateProgress;
    deps.importInto.mockImplementation(({ onProgress }) => {
      lateProgress = onProgress;
      return Promise.reject(Object.assign(new Error('The import was cancelled'), { cancelled: true }));
    });

    expect(await actions.importStlModels()).toBeUndefined();

    expect(services.LoggerService.error).not.toHaveBeenCalled();
    expect(notifications(services)).toContainEqual(['warning', 'The import was cancelled.']);
    expect(deps.setStatus).toHaveBeenLastCalledWith('work', null);

    // A model result arriving after the cancellation reports progress to a finished command
    const calls = deps.setStatus.mock.calls.length;
    lateProgress(0.5);
    expect(deps.setStatus).toHaveBeenCalledTimes(calls);
  });

  it('falls back to a notification when there is no logger', async () => {
    const { actions, services, deps } = setup({ logger: false });
    deps.pickFiles.mockResolvedValue([file('bad.stl')]);
    deps.readStlFiles.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await actions.importStlModels();

    expect(notifications(services)).toContainEqual(['error', 'The import failed: boom']);
    console.error.mockRestore();
  });
});

describe('importStlModels: the model units (ohif-viewers#151 FR-5)', () => {
  // A 200 mm image at the origin, and a femur 160 mm long inside it, as read and in metres
  const IMAGE = { min: [0, 0, 0], max: [200, 200, 200] };
  const model = (label, scale, extra = {}) => ({
    label,
    surface: { points: Float32Array.from([20, 20, 20, 180, 40, 40, 40, 180, 40].map(v => v * scale)), polys: [] },
    ...extra,
  });
  const points3 = env => env.deps.importInto.mock.calls[0][0].payload.models.map(m => m.surface.points[3]);
  const provenances = env => env.deps.importInto.mock.calls[0][0].payload.models.map(m => m.provenance);

  function unitsSetup(models, answer, { length = 'mm', bounds = IMAGE, asRead = true } = {}) {
    const env = setup({
      deps: {
        readStlFiles: jest.fn(async () => ({ models })),
        getImageBounds: jest.fn(() => bounds),
        getUnits: jest.fn(() => ({ length })),
        askModelUnits: jest.fn(async () => answer),
        confirmAsRead: jest.fn(async () => asRead),
      },
    });
    env.deps.pickFiles.mockResolvedValue([file('femur.stl')]);
    return env;
  }

  it('asks which unit the models were saved in, offering every unit with none chosen, and converts once', async () => {
    // A femur saved in metres, declared (wrongly, but explicitly) as inches: the comparison with
    // the image suggests metres, the declaration wins, and the conversion is by the declared unit
    const env = unitsSetup([model('femur', 0.001)], 'in');
    await env.actions.importStlModels();

    expect(env.deps.askModelUnits).toHaveBeenCalledTimes(1);
    const question = env.deps.askModelUnits.mock.calls[0][0];
    expect(question.title).toBe('Declare the model units');
    // The conversion is promised only for a declared unit, beside the Unknown choice
    expect(question.message).toBe('STL files carry no unit. Choose the source unit for femur. A declared unit is converted to millimetres once and placed in the patient coordinates of the image; Unknown imports the models as read, uncalibrated.');
    expect(question.options.map(option => option.value)).toEqual(['mm', 'µm', 'cm', 'in', 'm', 'as-read']);
    expect(question.options[3].label).toBe('inches (in)');
    expect(question.options[5].label).toBe('Unknown: import as read, uncalibrated');
    expect(question.confirmText).toBe('Import');
    // The comparison with the image is advice beside the choice
    expect(question.suggestions).toEqual(['femur: read as millimetres, 0.16 mm across against an image 200 mm across; from metres, 160 mm across.']);
    expect(points3(env)[0]).toBeCloseTo(0.18 * 25.4, 3);
    expect(provenances(env)).toEqual([{ sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' }]);
    // No status over the view while the dialog asks
    expect(env.deps.setStatus.mock.calls.map(([, message]) => message)).toEqual([
      'Reading 1 file(s)...', null, 'Placing 1 segment(s) on the image grid...', null,
    ]);
  });

  it('leaves a model declared in millimetres alone, imports as read on the unknown choice, and nothing on cancel', async () => {
    const mm = unitsSetup([model('femur', 1)], 'mm');
    await mm.actions.importStlModels();
    expect(points3(mm)[0]).toBe(180);
    expect(provenances(mm)).toEqual([{ sourceUnit: 'mm', origin: 'declared', scale: 1, destination: 'mm' }]);

    const asRead = unitsSetup([model('femur', 0.001)], 'as-read');
    await asRead.actions.importStlModels();
    expect(points3(asRead)[0]).toBeCloseTo(0.18, 6);
    expect(provenances(asRead)).toEqual([{ sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' }]);

    const cancelled = unitsSetup([model('femur', 0.001)], null);
    expect(await cancelled.actions.importStlModels()).toBeUndefined();
    expect(cancelled.deps.importInto).not.toHaveBeenCalled();
  });

  it('asks once for every undeclared model, and suggests a unit only for the ones that look wrong as millimetres', async () => {
    const env = unitsSetup([model('femur', 0.001), model('tibia', 0.001), model('patella', 1)], 'm');
    await env.actions.importStlModels();
    expect(env.deps.askModelUnits).toHaveBeenCalledTimes(1);
    const question = env.deps.askModelUnits.mock.calls[0][0];
    expect(question.message).toMatch(/Choose the source unit for femur, tibia, patella\./);
    expect(question.suggestions).toEqual(['femur, tibia: read as millimetres, 0.16 mm across against an image 200 mm across; from metres, 160 mm across.']);
    // One declaration for the import: every model is converted from metres
    expect(points3(env).map(v => Math.round(v))).toEqual([180, 180, 180000]);
  });

  it('keeps a unit the source encoded and does not ask about those models', async () => {
    const inches = { unit: 'in', name: 'inches', factor: 25.4 };
    const encodedOnly = unitsSetup([model('implant', 1 / 25.4, { unit: inches })], 'mm');
    await encodedOnly.actions.importStlModels();
    expect(encodedOnly.deps.askModelUnits).not.toHaveBeenCalled();
    expect(points3(encodedOnly)[0]).toBeCloseTo(180, 3);
    expect(provenances(encodedOnly)).toEqual([{ sourceUnit: 'in', origin: 'encoded', scale: 25.4, destination: 'mm' }]);

    const mixed = unitsSetup([model('implant', 1 / 25.4, { unit: inches }), model('femur', 1)], 'mm');
    await mixed.actions.importStlModels();
    expect(mixed.deps.askModelUnits.mock.calls[0][0].message).toMatch(/Choose the source unit for femur\./);
    expect(provenances(mixed).map(record => record.origin)).toEqual(['encoded', 'declared']);
  });

  it('imports as read onto an image without a millimetre calibration, after saying so, and records the grid as uncalibrated', async () => {
    const env = unitsSetup([model('femur', 0.001)], 'm', { length: 'units' });
    await env.actions.importStlModels();
    expect(env.deps.askModelUnits).not.toHaveBeenCalled();
    expect(env.deps.getImageBounds).not.toHaveBeenCalled();
    expect(env.deps.confirmAsRead).toHaveBeenCalledTimes(1);
    expect(env.deps.confirmAsRead.mock.calls[0][0]).toMatchObject({
      title: 'Model units',
      message: 'The image is not calibrated in millimetres, so a unit declared for femur could not be placed on it. The models are imported as read, in the image grid\'s units, and recorded as uncalibrated.',
      confirmText: 'Import as read',
    });
    expect(points3(env)[0]).toBeCloseTo(0.18, 6);
    expect(provenances(env)).toEqual([{ sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'unknown' }]);

    // An encoded unit is kept in the record but not applied: nothing physical can be placed
    const encoded = unitsSetup([model('implant', 1, { unit: { unit: 'in', name: 'inches', factor: 25.4 } })], 'm', { length: 'units' });
    await encoded.actions.importStlModels();
    expect(encoded.deps.confirmAsRead).not.toHaveBeenCalled();
    expect(points3(encoded)[0]).toBe(180);
    expect(provenances(encoded)).toEqual([{ sourceUnit: 'in', origin: 'encoded', scale: null, destination: 'unknown' }]);

    const declined = unitsSetup([model('femur', 0.001)], 'm', { length: 'units', asRead: false });
    expect(await declined.actions.importStlModels()).toBeUndefined();
    expect(declined.deps.importInto).not.toHaveBeenCalled();
  });

  it('still asks, without a comparison, when the image bounds are not available', async () => {
    const env = unitsSetup([model('femur', 0.001)], 'mm');
    env.deps.getImageBounds.mockImplementation(() => {
      throw new Error('no labelmap');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await env.actions.importStlModels();
    warn.mockRestore();
    expect(env.deps.askModelUnits.mock.calls[0][0].suggestions).toEqual([]);
    expect(env.deps.importInto).toHaveBeenCalled();
  });

  it('says what unit the bounds of an empty import are in', async () => {
    const empty = (label, provenance) => ({
      segments: [], emptySegments: [{ label, provenance }], overlapVoxels: 0, lockedVoxels: 0, writtenVoxels: 0,
      sourceBounds: { min: [0, 0, 0], max: [3, 3, 3] }, targetBounds: { min: [0, 0, 0], max: [3, 3, 3] },
    });
    const warning = env => notifications(env.services).find(([type]) => type === 'warning')[1];

    // As read onto an uncalibrated image: both spans are in the grid's units
    const unknownGrid = unitsSetup([model('femur', 1)], 'm', { length: 'units' });
    unknownGrid.deps.importInto.mockResolvedValue(empty('femur', { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'unknown' }));
    await unknownGrid.actions.importStlModels();
    expect(warning(unknownGrid)).toBe('These segments have no voxels on the image grid and were not added: femur. '
      + 'The image spans x 0 to 3, y 0 to 3, z 0 to 3 grid units; the imported data spans x 0 to 3, y 0 to 3, z 0 to 3 grid units.');

    // Converted from a declared unit onto a calibrated image: both in millimetres
    const converted = unitsSetup([model('femur', 1)], 'in');
    converted.deps.importInto.mockResolvedValue(empty('femur', { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' }));
    await converted.actions.importStlModels();
    expect(warning(converted)).toMatch(/The image spans x 0 to 3, y 0 to 3, z 0 to 3 mm; the imported data spans x 0 to 3, y 0 to 3, z 0 to 3 mm\.$/);

    // As read onto a calibrated image: the model's own unit is unknown, and the message says so
    const asRead = unitsSetup([model('femur', 1)], 'as-read');
    asRead.deps.importInto.mockResolvedValue(empty('femur', { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' }));
    await asRead.actions.importStlModels();
    expect(warning(asRead)).toMatch(/The image spans x 0 to 3, y 0 to 3, z 0 to 3 mm; the imported data spans x 0 to 3, y 0 to 3, z 0 to 3 in the models' own units \(unknown\)\.$/);

    // A known unit beside an unknown one in one import: the extent is of the placed coordinates,
    // one model converted from inches, the other read as millimetres
    const inches = { unit: 'in', name: 'inches', factor: 25.4 };
    const mixed = unitsSetup([model('implant', 1, { unit: inches }), model('femur', 1)], 'as-read');
    mixed.deps.importInto.mockResolvedValue({
      ...empty('implant', { sourceUnit: 'in', origin: 'encoded', scale: 25.4, destination: 'mm' }),
      emptySegments: [
        { label: 'implant', provenance: { sourceUnit: 'in', origin: 'encoded', scale: 25.4, destination: 'mm' } },
        { label: 'femur', provenance: { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' } },
      ],
      sourceBounds: { min: [0, 0, 0], max: [25.4, 25.4, 25.4] },
    });
    await mixed.actions.importStlModels();
    expect(mixed.deps.askModelUnits.mock.calls[0][0].message).toMatch(/Choose the source unit for femur\./);
    expect(provenances(mixed)).toEqual([
      { sourceUnit: 'in', origin: 'encoded', scale: 25.4, destination: 'mm' },
      { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' },
    ]);
    expect(warning(mixed)).toBe('These segments have no voxels on the image grid and were not added: implant, femur. '
      + 'The image spans x 0 to 3, y 0 to 3, z 0 to 3 mm; the imported data spans x 0 to 25, y 0 to 25, z 0 to 25 mm as placed; femur imported as read, unit unknown.');
  });

  it('records where each added segment came from, and reports it in the units the user knows', async () => {
    const env = unitsSetup([model('femur', 1 / 25.4), model('tibia', 1 / 25.4)], 'in');
    env.deps.importInto.mockResolvedValue({
      segments: [
        { segmentIndex: 2, label: 'femur', voxels: 10, provenance: { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' } },
        { segmentIndex: 3, label: 'tibia', voxels: 4, provenance: { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' } },
        { segmentIndex: 4, label: 'implant', voxels: 4, provenance: { sourceUnit: 'mm', origin: 'encoded', scale: 1, destination: 'mm' } },
        { segmentIndex: 5, label: 'cup', voxels: 4, provenance: { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' } },
        { segmentIndex: 6, label: 'hand', voxels: 4 },
      ],
      emptySegments: [], overlapVoxels: 0, lockedVoxels: 0, writtenVoxels: 22,
    });
    await env.actions.importStlModels();
    expect(env.deps.recordProvenance.mock.calls).toEqual([
      ['work', 2, { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' }],
      ['work', 3, { sourceUnit: 'in', origin: 'declared', scale: 25.4, destination: 'mm' }],
      ['work', 4, { sourceUnit: 'mm', origin: 'encoded', scale: 1, destination: 'mm' }],
      ['work', 5, { sourceUnit: 'unknown', origin: 'as-read', scale: null, destination: 'mm' }],
    ]);
    expect(notifications(env.services)).toContainEqual(['info',
      'Units: femur, tibia: declared in inches, converted to millimetres once (× 25.4). '
      + 'implant: millimetres from the source, no conversion needed. '
      + 'cup: unit unknown, imported as read and recorded as uncalibrated.']);
  });
});

describe('importDicomSeg / importNrrdNifti', () => {
  it('reads a SEG file with the study\'s images as the fallback for frame positions', async () => {
    const { actions, deps, services } = setup();
    deps.pickFiles.mockResolvedValue([file('liver.dcm', [4, 5])]);

    await actions.importDicomSeg();

    expect(deps.pickFiles).toHaveBeenCalledWith(IMPORT_FILE_TYPES.dicomSeg);
    const [buffer, options] = deps.readDicomSeg.mock.calls[0];
    expect(Array.from(new Uint8Array(buffer))).toEqual([4, 5]);
    expect(typeof options.resolveReferencedFrame).toBe('function');
    expect(deps.getStudies).toHaveBeenCalled();
    // The SEG's own overlap is reported alongside the import's
    expect(notifications(services)).toContainEqual(
      ['info', 'Some of the imported segments overlap each other. Where they do, the segment listed later was kept.']);
  });

  it('reads NRRD and NIfTI by extension, and refuses other files', async () => {
    const { actions, deps, services } = setup();

    deps.pickFiles.mockResolvedValueOnce([file('a.seg.nrrd')]);
    await actions.importNrrdNifti();
    expect(deps.readNrrd).toHaveBeenCalledTimes(1);
    expect(deps.readNifti).not.toHaveBeenCalled();

    deps.pickFiles.mockResolvedValueOnce([file('b.nii.gz')]);
    await actions.importNrrdNifti();
    expect(deps.readNifti).toHaveBeenCalledTimes(1);

    deps.pickFiles.mockResolvedValueOnce([file('c.txt')]);
    await actions.importNrrdNifti();
    expect(services.LoggerService.error).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Import NRRD / NIfTI', message: 'The import failed: c.txt is not an NRRD or NIfTI file',
    }));
    expect(deps.importInto).toHaveBeenCalledTimes(2);
  });
});

describe('canAddSeriesToCurrentSegmentation', () => {
  it('is true for a SEG or STL series while the editor has a working segmentation', () => {
    const { actions } = setup();
    expect(actions.canAddSeriesToCurrentSegmentation({ displaySetInstanceUID: 'seg' })).toBe(true);
    expect(actions.canAddSeriesToCurrentSegmentation({ displaySetInstanceUID: 'stl' })).toBe(true);
    expect(actions.canAddSeriesToCurrentSegmentation({ displaySetInstanceUID: 'ct' })).toBe(false);
    expect(actions.canAddSeriesToCurrentSegmentation({ displaySetInstanceUID: 'missing' })).toBe(false);

    const { actions: closed } = setup({ segmentationId: null });
    expect(closed.canAddSeriesToCurrentSegmentation({ displaySetInstanceUID: 'seg' })).toBe(false);
  });
});

describe('addSeriesToCurrentSegmentation', () => {
  it('reads a SEG series\' bytes through the loader service, with the given studies', async () => {
    const { actions, deps, result } = setup();

    expect(await actions.addSeriesToCurrentSegmentation({ displaySetInstanceUID: 'seg', studies: ['viewer'] })).toBe(result);

    expect(deps.fetchInstanceBytes).toHaveBeenCalledWith(SEG, ['viewer']);
    const [buffer] = deps.readDicomSeg.mock.calls[0];
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buffer))).toEqual([7, 8, 9]);
    expect(deps.getStudies).not.toHaveBeenCalled();
  });

  it('reads an STL series\' models, falling back to the study manager for the studies', async () => {
    const { actions, deps, services } = setup();

    await actions.addSeriesToCurrentSegmentation({ displaySetInstanceUID: 'stl' });

    expect(deps.readM3DSeries).toHaveBeenCalledWith({ displaySet: STL, studies: ['study'] });
    expect(deps.setStatus.mock.calls[0]).toEqual(['work', 'Loading the models of the series...']);
    expect(notifications(services)[0]).toEqual(['info', 'Importing 2 model(s)...']);
    // The series' models go through the unit declaration as STL files do (ohif-viewers#151 FR-5)
    expect(deps.askModelUnits).toHaveBeenCalledTimes(1);
    expect(deps.importInto).toHaveBeenCalledWith(expect.objectContaining({
      payload: { models: [{ label: 'a', provenance: { sourceUnit: 'mm', origin: 'declared', scale: 1, destination: 'mm' } }] },
    }));
  });

  it('turns other series away', async () => {
    const { actions, deps, services } = setup();
    expect(await actions.addSeriesToCurrentSegmentation({ displaySetInstanceUID: 'ct' })).toBeUndefined();
    expect(deps.importInto).not.toHaveBeenCalled();
    expect(notifications(services)).toEqual([
      ['warning', 'Only STL model series and DICOM-SEG series can be added to a segmentation.'],
    ]);
  });
});

describe('definitions', () => {
  it('registers the series commands in the viewer context and the panel commands in the editor\'s', () => {
    const { definitions } = setup();
    expect(definitions.canAddSeriesToCurrentSegmentation.context).toBe('VIEWER');
    expect(definitions.addSeriesToCurrentSegmentation.context).toBe('VIEWER');
    expect(definitions.importStlModels.context).toBeUndefined();
    expect(Object.keys(definitions)).toEqual([
      'importStlModels', 'importDicomSeg', 'importNrrdNifti',
      'canAddSeriesToCurrentSegmentation', 'addSeriesToCurrentSegmentation',
    ]);
  });
});

describe('imports and the 3D handoff (ohif-viewers#152)', () => {
  it('does not start while the user keeps editing a 3D surface the 2D views have not received', async () => {
    const resolveHandoff = jest.fn(async () => false);
    const { actions, services, deps } = setup({ deps: { resolveHandoff } });

    expect(await actions.importStlModels()).toBeUndefined();

    expect(resolveHandoff).toHaveBeenCalledTimes(1);
    expect(deps.pickFiles).not.toHaveBeenCalled();
    expect(deps.importInto).not.toHaveBeenCalled();
    expect(notifications(services)).toEqual([['info', 'The import was not started: the 3D surface is still being edited.']]);
  });

  it('goes ahead once the handoff is resolved', async () => {
    const resolveHandoff = jest.fn(async () => true);
    const { actions, deps, result } = setup({ deps: { resolveHandoff } });
    deps.pickFiles.mockResolvedValue([file('femur.stl')]);

    expect(await actions.importStlModels()).toBe(result);
    expect(resolveHandoff).toHaveBeenCalledTimes(1);
  });
});
