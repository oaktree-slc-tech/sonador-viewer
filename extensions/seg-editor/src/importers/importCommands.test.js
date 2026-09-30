// The Segmentation Editor's import commands: file window, source readers, the import and its report

import createImportCommands, { IMPORT_FILE_TYPES, formatBounds, isImportableSeries, volumeFileKind } from './importCommands';

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
jest.mock('./pickLocalFiles.js', () => ({ pickLocalFiles: jest.fn() }));


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

  it('formats bounds in whole millimetres, and a dash when there are none', () => {
    expect(formatBounds({ min: [-1.6, 0, 2], max: [3.4, 5, 6] })).toBe('x -2 to 3, y 0 to 5, z 2 to 6 mm');
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
      segmentationId: 'work', payload: { models: [{ label: 'femur' }] }, segmentationService: services.segmentationService,
      onProgress: expect.any(Function),
    });
    // What the 3D view shows while it runs, cleared at the end
    expect(deps.setStatus.mock.calls).toEqual([
      ['work', 'Reading 2 file(s)...'],
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
      'Reading 2 file(s)...', 'Placing 2 segment(s) on the image grid...',
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
    expect(deps.importInto).toHaveBeenCalledWith(expect.objectContaining({ payload: { models: [{ label: 'a' }] } }));
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
