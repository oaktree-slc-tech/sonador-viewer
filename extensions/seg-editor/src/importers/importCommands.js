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
// STL files carry no unit: a model that does not look like millimetres against the image is
// offered for rescaling before it is placed (stlScale.js). The check needs an image calibrated in
// millimetres; on one without pixel spacing the grid's steps say nothing about a model's unit.

import OHIF from '@ohif/core';
import { isSTLDisplaySet, setActionStatus } from '@ohif/extension-viewerm3d';
import i18n from '@ohif/i18n';

import { callConfirmDialog } from '../components/confirmDialog';
import { volumeAxes } from '../threeDTools/labelmapCarve.js';
import { getLabelmapForEdit } from '../threeDTools/segmentEdits.js';
import { getSegEditorToolContext } from '../toolbox/segEditorToolContext';
import { getSegEditorUnits, LENGTH_UNITS } from '../utils/segEditorUnits';

import { createStudyFrameResolver, parseDicomSeg } from './dicomSeg.js';
import { importIntoSegmentation, labelmapWorldBounds } from './labelmapImport.js';
import { parseNifti } from './nifti.js';
import { parseNrrd } from './nrrd.js';
import { pickLocalFiles } from './pickLocalFiles.js';
import { modelsFromM3DSeries, modelsFromStlFiles } from './stlModels.js';
import { modelsNeedingRescale, rescaleModel } from './stlScale.js';


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

/** Whether a series can be added to a segmentation: STL models, or a DICOM SEG */
export function isImportableSeries(displaySet) {
  return !!displaySet && (displaySet.Modality === 'SEG' || isSTLDisplaySet(displaySet));
}

/** 'x 10 to 20, y 0 to 5, z -3 to 3 mm' */
export function formatBounds(bounds) {
  if (!bounds) {
    return '-';
  }
  const mm = value => Math.round(value);
  return ['x', 'y', 'z'].map((axis, d) => `${axis} ${mm(bounds.min[d])} to ${mm(bounds.max[d])}`).join(', ') + ' mm';
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
    // The image grid's bounds, which an STL model's scale is judged against, and the units they
    // are in (the check runs only on a grid calibrated in millimetres)
    getImageBounds = _imageBounds,
    getUnits = getSegEditorUnits,
    // Asks how models that do not look like millimetres are imported: 'confirm' (rescale),
    // 'alternate' (as they are) or 'cancel'
    askRescale = options => callConfirmDialog({
      uiDialogService: servicesManager?.services?.UIDialogService, ...options,
    }),
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

  function _report(title, result, payload) {
    const names = list => list.map(segment => segment.label).join(', ');
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
          image: formatBounds(result.targetBounds),
          source: formatBounds(result.sourceBounds),
        }),
      });
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
   * STL models with the scale the user chose: each group of models that looks to be in another
   * unit than millimetres is offered for rescaling. Resolves undefined when the user cancels.
   */
  async function _checkStlScale(title, segmentationId, payload, status) {
    if (getUnits().length !== LENGTH_UNITS.mm) {
      notify({
        type: 'info',
        title,
        message: t('The image has no pixel spacing, so the scale of the models could not be checked. They are placed as read, in the image grid\'s units.'),
      });
      return payload;
    }
    let imageBounds = null;
    try {
      imageBounds = getImageBounds(segmentationId);
    } catch (error) {
      console.warn('[SegEditor-import] The image bounds are not available; the STL scale is not checked', error);
    }
    if (!imageBounds) {
      return payload;
    }
    const rescaled = new Map();
    for (const { suggestion, models } of modelsNeedingRescale(payload.models, imageBounds)) {
      const names = models.map(model => model.label).join(', ');
      // The dialog asks over the view: no status behind it
      status(null);
      const answer = await askRescale({
        id: 'seg-editor-stl-scale',
        title: t('Check the model scale'),
        message: t('{{models}} may be in {{unit}} rather than millimetres. Read as millimetres, it is {{extent}} mm across and does not fit the image ({{image}} mm across). Rescaled from {{unit}}, it is {{scaled}} mm across.', {
          models: names,
          unit: t(suggestion.name),
          extent: formatLength(suggestion.extent),
          image: formatLength(Math.max(...[0, 1, 2].map(d => imageBounds.max[d] - imageBounds.min[d]))),
          scaled: formatLength(suggestion.scaledExtent),
        }),
        confirmText: t('Rescale from {{unit}}', { unit: suggestion.unit }),
        alternateText: t('Import as-is'),
        cancelText: t('Cancel'),
      });
      if (answer === 'cancel' || answer === false) {
        return undefined;
      }
      if (answer === 'confirm' || answer === true) {
        models.forEach(model => rescaled.set(model, suggestion.factor));
      }
    }
    if (!rescaled.size) {
      return payload;
    }
    return {
      ...payload,
      models: payload.models.map(model => (rescaled.has(model) ? rescaleModel(model, rescaled.get(model)) : model)),
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
        return _checkStlScale(title, workingSegmentationId(), await readStlFiles(files), status);
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
        return readM3DSeries({ displaySet, studies: studyList });
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
