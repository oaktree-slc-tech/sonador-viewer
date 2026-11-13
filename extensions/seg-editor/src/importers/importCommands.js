// Commands that bring segments into the Segmentation Editor's working segmentation:
//
// - importStlModels / importDicomSeg / importNrrdNifti: files from the user's computer, chosen in
//   the platform's file window (the editor panel's menu).
// - addSeriesToCurrentSegmentation: an STL model series or a DICOM-SEG series of the open study
//   (the study browser's series menu, while the editor is open);
//   canAddSeriesToCurrentSegmentation says whether the menu item applies to a series.
//
// Each source becomes an import payload (importers/*) that importIntoSegmentation numbers and
// writes; what was added, and what was empty or overlapped, is reported through the
// notification service. A failure is logged and shown, and leaves the segmentation as it was.
// STL files carry no unit: the user declares the unit the models were saved in, with nothing
// pre-selected, or imports them as read (ohif-viewers#151 FR-5). A unit encoded by the source (an
// M3D series) is kept. A declared unit converts to millimetres once, on an image calibrated in
// them; on one without pixel spacing the models go in as read, in the grid's units. Each added
// segment's provenance is recorded (utils/importProvenance.js) and stated in the report.

import OHIF from '@ohif/core';
import { isSTLDisplaySet, setActionStatus } from '@ohif/extension-viewerm3d';
import i18n from '@ohif/i18n';

import { callConfirmDialog } from '../components/confirmDialog';
import { callStlUnitsDialog } from '../components/stlUnitsDialog';
import { volumeAxes } from '../threeDTools/labelmapCarve.js';
import { getLabelmapForEdit } from '../threeDTools/segmentEdits.js';
import { request3DToolAction } from '../threeDTools/threeDToolState';
import { getSegEditorToolContext } from '../toolbox/segEditorToolContext';
import { PROVENANCE_ORIGIN, recordSegmentProvenance } from '../utils/importProvenance';
import { getSegEditorUnits, LENGTH_UNITS } from '../utils/segEditorUnits';

import { createStudyFrameResolver, parseDicomSeg } from './dicomSeg.js';
import { importIntoSegmentation, labelmapWorldBounds } from './labelmapImport.js';
import { parseNifti } from './nifti.js';
import { parseNrrd } from './nrrd.js';
import { pickLocalFiles } from './pickLocalFiles.js';
import { modelsFromM3DSeries, modelsFromStlFiles } from './stlModels.js';
import { modelsNeedingRescale, rescaleModel, STL_UNIT_BY_CODE, STL_UNITS } from './stlScale.js';


const { DisplaySetApi } = OHIF.display;
const { DicomLoaderService, studyMetadataManager } = OHIF.utils;

const t = (key, options) => i18n.t(key, { ns: 'SegmentationEditor', ...options });

// The file window's filters, per import
export const IMPORT_FILE_TYPES = {
  stl: { accept: '.stl,model/stl', multiple: true },
  dicomSeg: { accept: '.dcm,application/dicom', multiple: false },
  volume: { accept: '.nrrd,.nii,.nii.gz,.gz', multiple: false },
};

/** 'nrrd' | 'nifti' | undefined, from a file name */
export function volumeFileKind(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/\.nrrd$/.test(name)) {
    return 'nrrd';
  }
  if (/\.nii(\.gz)?$/.test(name) || /\.gz$/.test(name)) {
    return 'nifti';
  }
  return undefined;
}

// The declaration that a model's unit is unknown: imported as read, nothing physical claimed
export const AS_READ = 'as-read';

/** Whether a series can be added to a segmentation: STL models, or a DICOM SEG */
export function isImportableSeries(displaySet) {
  return !!displaySet && (displaySet.Modality === 'SEG' || isSTLDisplaySet(displaySet));
}

/** 'x 10 to 20, y 0 to 5, z -3 to 3 mm' */
/**
 * Bounds for a message, rounded, followed by the unit they are in: 'mm' on an image calibrated in
 * millimetres, the grid's units on one that is not, or the name of an unknown model unit.
 */
export function formatBounds(bounds, unit = 'mm') {
  if (!bounds) {
    return '-';
  }
  const round = value => Math.round(value);
  const axes = ['x', 'y', 'z'].map((axis, d) => `${axis} ${round(bounds.min[d])} to ${round(bounds.max[d])}`).join(', ');
  return unit ? `${axes} ${unit}` : axes;
}

/** A length for a message: three significant figures, without trailing zeros ('0.3', '1200'). */
export function formatLength(value) {
  return String(Number(Number(value).toPrecision(3)));
}

/** The world bounds of a segmentation's labelmap grid, or null when it is not available. */
function _imageBounds(segmentationId) {
  const labelmap = getLabelmapForEdit(segmentationId);
  return labelmap ? labelmapWorldBounds({ dimensions: labelmap.dimensions, axes: volumeAxes(labelmap.indexToWorld) }) : null;
}

function _toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function _findStudyDisplaySet(displaySetInstanceUID) {
  // The study metadata's own display set, which carries what the display set service's copy may
  // not (an ImageSet's non-enumerable `images`, a model series' `series`)
  for (const study of studyMetadataManager.all() || []) {
    const displaySet = (study.getDisplaySets?.() || study.displaySets || [])
      .find(candidate => candidate.displaySetInstanceUID === displaySetInstanceUID);
    if (displaySet) {
      return displaySet;
    }
  }
  return DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
}

/**
 * @param {Object} params
 * @param {Object} params.servicesManager
 * @param {Object} [params.deps] - injectable (tests)
 */
export default function createImportCommands({ servicesManager, deps = {} }) {
  const {
    pickFiles = pickLocalFiles,
    readStlFiles = modelsFromStlFiles,
    readM3DSeries = modelsFromM3DSeries,
    readDicomSeg = parseDicomSeg,
    readNrrd = parseNrrd,
    readNifti = parseNifti,
    importInto = importIntoSegmentation,
    getContext = getSegEditorToolContext,
    getDisplaySet = _findStudyDisplaySet,
    getStudies = () => studyMetadataManager.all() || [],
    fetchInstanceBytes = (displaySet, studies) => DicomLoaderService.findDicomDataPromise(displaySet, studies),
    isImportable = isImportableSeries,
    // What the import is doing, shown over the editor's 3D view (keyed by the working segmentation)
    setStatus = setActionStatus,
    // The image grid's bounds, which a model's scale is compared against, and the units they are
    // in (a declared unit converts to millimetres only on a grid calibrated in them)
    getImageBounds = _imageBounds,
    getUnits = getSegEditorUnits,
    // Asks which unit the models were saved in (ohif-viewers#151 FR-5): resolves the unit code,
    // AS_READ, or null when cancelled
    askModelUnits = options => callStlUnitsDialog({
      uiDialogService: servicesManager?.services?.UIDialogService, ...options,
    }),
    // Confirms an import as read onto an uncalibrated image: true, or false when cancelled
    confirmAsRead = options => callConfirmDialog({
      uiDialogService: servicesManager?.services?.UIDialogService, ...options,
    }),
    // Keeps where each added segment came from, for the report and the serializer
    recordProvenance = recordSegmentProvenance,
    // Resolves a 3D surface the 2D views have not caught up with before the import replaces the
    // labelmap (ohif-viewers#152 handoff): false when the user chose to keep editing in 3D
    resolveHandoff = async () => {
      const resolved = await request3DToolAction('resolveHandoff', { reason: 'import' });
      return resolved === undefined ? true : resolved !== false;
    },
  } = deps;

  const notify = options => servicesManager?.services?.UINotificationService?.show(options);
  const logError = ({ error, title, message }) => {
    const { LoggerService } = servicesManager?.services || {};
    if (typeof LoggerService?.error === 'function') {
      LoggerService.error({ error, title, message, notify: true });
    } else {
      console.error(`[SegEditor-import] ${title}`, error);
      notify({ type: 'error', title, message });
    }
  };

  const workingSegmentationId = () => getContext()?.segmentationId;

  /**
   * Where the added segments' geometry came from (ohif-viewers#151 FR-7): the source unit and how
   * it was known, the scale applied, and whether the image was calibrated. One sentence per kind.
   */
  function _unitsReport(segments) {
    const groups = new Map();
    segments.forEach(segment => {
      const record = segment.provenance;
      if (!record) {
        return;
      }
      const key = [record.origin, record.sourceUnit, record.scale, record.destination].join('|');
      const group = groups.get(key) || { record, labels: [] };
      group.labels.push(segment.label);
      groups.set(key, group);
    });
    const sentences = [...groups.values()].map(({ record, labels }) => {
      const segments = labels.join(', ');
      if (record.origin === PROVENANCE_ORIGIN.asRead) {
        return record.destination === 'mm'
          ? t('{{segments}}: unit unknown, imported as read and recorded as uncalibrated.', { segments })
          : t('{{segments}}: imported as read onto an uncalibrated image, in its grid units.', { segments });
      }
      const unit = t(STL_UNIT_BY_CODE[record.sourceUnit]?.name || record.sourceUnit);
      const how = record.origin === PROVENANCE_ORIGIN.encoded ? t('{{unit}} from the source', { unit }) : t('declared in {{unit}}', { unit });
      if (record.scale === null) {
        return t('{{segments}}: {{how}}, placed as read on an uncalibrated image.', { segments, how });
      }
      return record.scale === 1
        ? t('{{segments}}: {{how}}, no conversion needed.', { segments, how })
        : t('{{segments}}: {{how}}, converted to millimetres once (× {{scale}}).', { segments, how, scale: formatLength(record.scale) });
    });
    return sentences.length ? `${t('Units')}: ${sentences.join(' ')}` : '';
  }

  /**
   * The unit an import's source bounds are in. The bounds are the union of the placed sources, in
   * the grid's coordinates: a model converted from a known unit, any model on an uncalibrated grid,
   * and a labelmap source are in the grid's units. A model imported as read onto a calibrated
   * image keeps its own unknown unit, read as millimetres. When every model is such, the extent is
   * in the models' own units; when only some are, it is millimetres as placed, and the message
   * names the models whose unit is unknown.
   */
  function _sourceUnit(result, gridUnit) {
    const models = [...result.segments, ...result.emptySegments].filter(segment => segment.provenance);
    const asRead = models.filter(({ provenance }) => provenance.destination === 'mm' && provenance.sourceUnit === 'unknown');
    if (!asRead.length) {
      return gridUnit;
    }
    if (asRead.length === models.length) {
      return t('in the models\' own units (unknown)');
    }
    return t('{{unit}} as placed; {{models}} imported as read, unit unknown', {
      unit: gridUnit, models: asRead.map(model => model.label).join(', '),
    });
  }

  function _report(title, result, payload) {
    const names = list => list.map(segment => segment.label).join(', ');
    // What the image's coordinates are in: millimetres, or the grid's own steps
    const gridUnit = getUnits().length === LENGTH_UNITS.mm ? 'mm' : t('grid units');
    if (result.segments.length) {
      notify({
        type: 'success',
        title,
        message: t('Added {{count}} segment(s): {{segments}}', {
          count: result.segments.length, segments: names(result.segments),
        }),
      });
    }
    if (result.emptySegments.length) {
      // Where the import and the image are, so a source in another frame of reference can be
      // recognised from the message
      notify({
        type: 'warning',
        title,
        message: t('These segments have no voxels on the image grid and were not added: {{segments}}. The image spans {{image}}; the imported data spans {{source}}.', {
          segments: names(result.emptySegments),
          image: formatBounds(result.targetBounds, gridUnit),
          source: formatBounds(result.sourceBounds, _sourceUnit(result, gridUnit)),
        }),
      });
    }
    const units = _unitsReport(result.segments);
    if (units) {
      notify({ type: 'info', title, message: units });
    }
    if (result.overlapVoxels) {
      notify({
        type: 'info',
        title,
        message: t('The imported segments overlap segments already in the segmentation. Where they do, the imported segment was kept.'),
      });
    }
    if (result.lockedVoxels) {
      notify({
        type: 'info',
        title,
        message: t('Where the imported segments overlap locked segments, the locked segments were kept.'),
      });
    }
    if (payload.overlapVoxels) {
      notify({
        type: 'info',
        title,
        message: t('Some of the imported segments overlap each other. Where they do, the segment listed later was kept.'),
      });
    }
  }

  async function _runImport(title, produce) {
    // `produce(status)` resolves the import payload, or undefined when the user cancelled; it
    // reports what it is doing through `status(message)`
    const segmentationId = workingSegmentationId();
    if (!segmentationId) {
      notify({ type: 'warning', title, message: t('Open a segmentation in the Segmentation Editor first.') });
      return undefined;
    }
    // The import replaces voxels the 3D surface may be ahead of: that is resolved first
    if (!(await resolveHandoff())) {
      notify({ type: 'info', title, message: t('The import was not started: the 3D surface is still being edited.') });
      return undefined;
    }
    // Status is published only while this command runs: nothing that finishes late (a reader, a
    // model result after a cancellation) may put a message back over the view
    let live = true;
    const status = message => live && setStatus(segmentationId, message);

    try {
      const payload = await produce(status);
      if (!payload) {
        return undefined;
      }
      const count = (payload.models || payload.segments || []).length;
      status(t('Placing {{count}} segment(s) on the image grid...', { count }));
      const result = await importInto({
        segmentationId,
        payload,
        segmentationService: servicesManager.services.segmentationService,
        // Models are voxelized one at a time
        onProgress: payload.models
          ? fraction => status(t('Converting model {{n}} of {{count}}...', {
            n: Math.min(count, Math.round(fraction * count) + 1), count,
          }))
          : undefined,
      });
      result.segments.forEach(segment => segment.provenance
        && recordProvenance(segmentationId, segment.segmentIndex, segment.provenance));
      _report(title, result, payload);
      return result;
    } catch (error) {
      if (error?.cancelled) {
        // The worker it waited on was stopped (the surface turned off, the editor closed)
        notify({ type: 'warning', title, message: t('The import was cancelled.') });
        return undefined;
      }
      logError({
        error,
        title,
        message: t('The import failed: {{message}}', { message: error?.message || String(error) }),
      });
      return undefined;
    } finally {
      status(null);
      live = false;
    }
  }

  /**
   * The models of an import with their units declared (ohif-viewers#151 FR-5). An STL file carries
   * no unit: the user names the unit the models were saved in, with nothing pre-selected, or
   * imports them as read, uncalibrated. A model whose source encoded its unit (an M3D instance's
   * Measurement Units Code Sequence) keeps it and is not asked about. On a grid calibrated in
   * millimetres a known unit is converted to them once; on an uncalibrated grid a physical unit
   * cannot be placed, so the models go in as read, in the grid's units, and the record says so.
   * The comparison of each model with the image is advice beside the choice, never a declaration.
   * Resolves undefined when the user cancels.
   */
  async function _declareModelUnits(title, segmentationId, payload, status) {
    const models = payload.models || [];
    const calibrated = getUnits().length === LENGTH_UNITS.mm;
    const undeclared = models.filter(model => !model.unit);
    const names = undeclared.map(model => model.label).join(', ');
    // model -> { unit: a STL_UNITS entry or null, origin }
    const declared = new Map(models.filter(model => model.unit)
      .map(model => [model, { unit: model.unit, origin: PROVENANCE_ORIGIN.encoded }]));

    if (undeclared.length && !calibrated) {
      // The dialog asks over the view: no status behind it
      status(null);
      const proceed = await confirmAsRead({
        id: 'seg-editor-model-units',
        title: t('Model units'),
        message: t('The image is not calibrated in millimetres, so a unit declared for {{models}} could not be placed on it. The models are imported as read, in the image grid\'s units, and recorded as uncalibrated.', { models: names }),
        confirmText: t('Import as read'),
        cancelText: t('Cancel'),
      });
      if (!proceed) {
        return undefined;
      }
      undeclared.forEach(model => declared.set(model, { unit: null, origin: PROVENANCE_ORIGIN.asRead }));
    } else if (undeclared.length) {
      let imageBounds = null;
      try {
        imageBounds = getImageBounds(segmentationId);
      } catch (error) {
        console.warn('[SegEditor-import] The image bounds are not available; the models are not compared with the image', error);
      }
      const suggestions = imageBounds
        ? modelsNeedingRescale(undeclared, imageBounds).map(({ suggestion, models: group }) => t('{{models}}: read as millimetres, {{extent}} mm across against an image {{image}} mm across; from {{unit}}, {{scaled}} mm across.', {
          models: group.map(model => model.label).join(', '),
          extent: formatLength(suggestion.extent),
          image: formatLength(Math.max(...[0, 1, 2].map(d => imageBounds.max[d] - imageBounds.min[d]))),
          unit: t(suggestion.name),
          scaled: formatLength(suggestion.scaledExtent),
        }))
        : [];
      status(null);
      const choice = await askModelUnits({
        id: 'seg-editor-model-units',
        title: t('Declare the model units'),
        message: t('STL files carry no unit. Choose the source unit for {{models}}. A declared unit is converted to millimetres once and placed in the patient coordinates of the image; Unknown imports the models as read, uncalibrated.', { models: names }),
        options: [
          ...STL_UNITS.map(unit => ({ value: unit.unit, label: `${t(unit.name)} (${unit.unit})` })),
          { value: AS_READ, label: t('Unknown: import as read, uncalibrated') },
        ],
        suggestions,
        confirmText: t('Import'),
        cancelText: t('Cancel'),
      });
      if (!choice) {
        return undefined;
      }
      const unit = choice === AS_READ ? null : STL_UNIT_BY_CODE[choice];
      undeclared.forEach(model => declared.set(model, { unit, origin: unit ? PROVENANCE_ORIGIN.declared : PROVENANCE_ORIGIN.asRead }));
    }

    const destination = calibrated ? 'mm' : 'unknown';
    return {
      ...payload,
      models: models.map(model => {
        const { unit, origin } = declared.get(model) || { unit: null, origin: PROVENANCE_ORIGIN.asRead };
        // Converted once, to millimetres, only when both ends are physical
        const scale = unit && calibrated ? unit.factor : null;
        const provenance = { sourceUnit: unit ? unit.unit : 'unknown', origin, scale, destination };
        return { ...(scale && scale !== 1 ? rescaleModel(model, scale) : model), provenance };
      }),
    };
  }

  const importingModels = (title, count) => notify({
    type: 'info', title, message: t('Importing {{count}} model(s)...', { count }),
  });

  const actions = {
    importStlModels() {
      const title = t('Import STL Models');
      return _runImport(title, async status => {
        const files = await pickFiles(IMPORT_FILE_TYPES.stl);
        if (!files.length) {
          return undefined;
        }
        importingModels(title, files.length);
        status(t('Reading {{count}} file(s)...', { count: files.length }));
        return _declareModelUnits(title, workingSegmentationId(), await readStlFiles(files), status);
      });
    },

    importDicomSeg() {
      return _runImport(t('Import DICOM-SEG'), async status => {
        const [file] = await pickFiles(IMPORT_FILE_TYPES.dicomSeg);
        if (!file) {
          return undefined;
        }
        status(t('Reading {{name}}...', { name: file.name }));
        return readDicomSeg(await file.arrayBuffer(), {
          resolveReferencedFrame: createStudyFrameResolver(getStudies()),
        });
      });
    },

    importNrrdNifti() {
      return _runImport(t('Import NRRD / NIfTI'), async status => {
        const [file] = await pickFiles(IMPORT_FILE_TYPES.volume);
        if (!file) {
          return undefined;
        }
        const kind = volumeFileKind(file.name);
        if (!kind) {
          throw new Error(`${file.name} is not an NRRD or NIfTI file`);
        }
        status(t('Reading {{name}}...', { name: file.name }));
        const buffer = await file.arrayBuffer();
        return kind === 'nrrd' ? readNrrd(buffer) : readNifti(buffer);
      });
    },

    canAddSeriesToCurrentSegmentation({ displaySetInstanceUID }) {
      return !!(workingSegmentationId() && isImportable(getDisplaySet(displaySetInstanceUID)));
    },

    addSeriesToCurrentSegmentation({ displaySetInstanceUID, studies }) {
      const title = t('Add to Current Segmentation');
      const displaySet = getDisplaySet(displaySetInstanceUID);
      if (!isImportable(displaySet)) {
        notify({
          type: 'warning',
          title,
          message: t('Only STL model series and DICOM-SEG series can be added to a segmentation.'),
        });
        return undefined;
      }

      return _runImport(title, async status => {
        const studyList = studies || getStudies();
        if (displaySet.Modality === 'SEG') {
          status(t('Reading the segmentation...'));
          const bytes = await fetchInstanceBytes(displaySet, studyList);
          return readDicomSeg(_toArrayBuffer(bytes), {
            resolveReferencedFrame: createStudyFrameResolver(studyList),
          });
        }
        importingModels(title, displaySet.numImageFrames || 1);
        status(t('Loading the models of the series...'));
        return _declareModelUnits(title, workingSegmentationId(), await readM3DSeries({ displaySet, studies: studyList }), status);
      });
    },
  };

  const definitions = {
    // The editor panel's menu: available while the editor is the active viewport
    importStlModels: { commandFn: actions.importStlModels, options: {} },
    importDicomSeg: { commandFn: actions.importDicomSeg, options: {} },
    importNrrdNifti: { commandFn: actions.importNrrdNifti, options: {} },
    // The study browser's series menu: reachable from the viewer whatever the active viewport
    canAddSeriesToCurrentSegmentation: {
      commandFn: actions.canAddSeriesToCurrentSegmentation, options: {}, context: 'VIEWER',
    },
    addSeriesToCurrentSegmentation: {
      commandFn: actions.addSeriesToCurrentSegmentation, options: {}, context: 'VIEWER',
    },
  };

  return { actions, definitions };
}
