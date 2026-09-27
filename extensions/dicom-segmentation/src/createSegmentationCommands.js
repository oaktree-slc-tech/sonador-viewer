// Commands that start a segmentation in the viewer and open the Segmentation Editor on it
// (ohif-viewers#143):
//
// - createSegmentation: a blank segmentation, one empty segment, on the active CT/MR series
//   (the Cornerstone viewer's More -> Create Segmentation).
// - openModelsAsSegmentation: an STL model series voxelized onto the series it was made from,
//   one segment per model (the M3D models panel's Open as Segmentation). Models locked in the
//   panel are left out, and the user is told which before the editor opens -- unless they have
//   asked not to be (the dialog's "don't ask again", a general preference).
//
// Both register an in-memory segmentation (createInMemorySegmentation) and open the editor on
// that segmentation (the display set's `segEditorSegmentationId`, read by the editor's viewport).

import OHIF, { LOCKED_MODELS_WARNING_PREFERENCE_KEY, UserPreferencesService } from '@ohif/core';
import i18n from '@ohif/i18n';
import { viewerbaseDisplaySetIsCTOrMRVolume, viewerbaseGetDisplaySet } from '@ohif/ui';
import {
  callConfirmDialog,
  listModelsForConversion,
  modelsToLabelmap,
  setSegmentationEditorLayout,
} from '@ohif/extension-seg3d-editor';
import { findM3DSourceDisplaySet } from '@ohif/extension-viewerm3d';

import { createInMemorySegmentation, getDisplaySetImageIds, hexToRgb } from './createInMemorySegmentation';


const { DisplaySetApi } = OHIF.display;
const { StackManager, studyMetadataManager } = OHIF.utils;

// The display set attribute naming the segmentation the Segmentation Editor opens on
export const EDITOR_SEGMENTATION_ATTRIBUTE = 'segEditorSegmentationId';

const t = (key, options) => i18n.t(key, { ns: 'SegmentationEditor', ...options });

function _displaySetService() {
  return DisplaySetApi.Instance.displaySetService;
}

function _studyDisplaySets(StudyInstanceUID) {
  const study = studyMetadataManager.get(StudyInstanceUID);
  return study ? [].concat(...(study.getDisplaySets?.() || study._displaySets || [])) : [];
}

function _findImageSet(StudyInstanceUID, displaySetInstanceUID) {
  // The study metadata's own display set. Only it is sure to carry `images` (the instances): on an
  // ImageSet that property is non-enumerable, so every copy of a display set -- the viewports'
  // redux data, and the copy the Segmentation Editor publishes to the display set service -- lacks
  // it. The display set service therefore cannot be relied on for a series' images.
  return _studyDisplaySets(StudyInstanceUID)
    .find(displaySet => displaySet.displaySetInstanceUID === displaySetInstanceUID);
}

function _ensureStack(displaySet) {
  // Registers the series' image ids with the metadata providers (as displaying the series would),
  // which reading its volume geometry relies on
  StackManager.findOrCreateStack({ StudyInstanceUID: displaySet.StudyInstanceUID }, displaySet);
}

/**
 * Open the Segmentation Editor on an image display set, showing the given segmentation.
 *
 * The segmentation is named on the display set service's object for the series, where the
 * editor's viewport reads it. The layout is given VIEWPORT data -- the active viewport's own copy,
 * or a copy of the display set -- never a shared object: the layout stamps its plugin on what it
 * is given, and a display set carrying the editor's plugin reopens the editor whenever the viewer
 * reloads the series from it (for example when the editor republishes it on exit).
 *
 * @param {Object} displaySet - the series' display set
 * @param {string} segmentationId
 * @param {Object} [options]
 * @param {Object} [options.viewportData] - the active viewport's data for this display set
 * @param {Function} [options.getServiceDisplaySet] - (displaySetInstanceUID) => the service's object
 */
export function openEditorOnSegmentation(displaySet, segmentationId, {
  viewportData,
  getServiceDisplaySet = uid => _displaySetService().getDisplaySetByUID(uid),
  open = setSegmentationEditorLayout,
} = {}) {
  const { displaySetInstanceUID } = displaySet;
  const serviceDisplaySet = getServiceDisplaySet(displaySetInstanceUID) || displaySet;
  serviceDisplaySet[EDITOR_SEGMENTATION_ATTRIBUTE] = segmentationId;

  const layoutDisplaySet = viewportData?.displaySetInstanceUID === displaySetInstanceUID
    ? viewportData
    : { ...displaySet, [EDITOR_SEGMENTATION_ATTRIBUTE]: segmentationId };
  return open(layoutDisplaySet, [{}]);
}

export function segmentationLabelFor(displaySet) {
  const description = displaySet?.SeriesDescription || displaySet?.seriesDescription;
  return description
    ? t('Segmentation – {{series}}', { series: description })
    : t('Segmentation');
}

/**
 * What the user is told before locked models are left out: the models by name, and what to do
 * about it. Worded as an alert -- a question for the title, a verb on the confirming button,
 * Cancel on the other -- with the suppression checkbox beneath the message.
 */
export function lockedModelsWarning({ unlocked, locked }) {
  const names = locked.map(segment => segment.label).join(', ');
  const total = unlocked.length + locked.length;
  const leftOut = locked.length === 1
    ? t('One of the {{total}} models is locked and will be left out: {{models}}.', { total, models: names })
    : t('{{lockedCount}} of the {{total}} models are locked and will be left out: {{models}}.', {
      lockedCount: locked.length, total, models: names,
    });
  return {
    title: t('Open Only the Unlocked Models?'),
    message: `${leftOut} ${t('Unlock a model in the models panel to include it.')}`,
    confirmText: t('Open Unlocked Models'),
    cancelText: t('Cancel'),
    suppressionLabel: t('Don\'t ask again'),
  };
}

/**
 * @param {Object} params
 * @param {Object} params.servicesManager
 * @param {Object} [params.deps] - injectable (tests)
 */
export default function createSegmentationCommands({ servicesManager, deps = {} }) {
  const {
    create = createInMemorySegmentation,
    listModels = listModelsForConversion,
    convertModels = modelsToLabelmap,
    openEditor = openEditorOnSegmentation,
    ensureStack = _ensureStack,
    getDisplaySet = uid => _displaySetService().getDisplaySetByUID(uid),
    getStudyDisplaySets = _studyDisplaySets,
    findImageSet = _findImageSet,
    confirm = options => callConfirmDialog({
      uiDialogService: servicesManager.services.UIDialogService, ...options,
    }),
    warnsAboutLockedModels = () => UserPreferencesService.getGeneral(LOCKED_MODELS_WARNING_PREFERENCE_KEY) !== false,
    stopWarningAboutLockedModels = () => UserPreferencesService.setGeneral(LOCKED_MODELS_WARNING_PREFERENCE_KEY, false),
  } = deps;

  const notify = options => servicesManager?.services?.UINotificationService?.show(options);

  const actions = {
    createSegmentation({ viewports }) {
      const { viewportSpecificData, activeViewportIndex } = viewports || {};
      if (!viewerbaseDisplaySetIsCTOrMRVolume(viewportSpecificData, activeViewportIndex)) {
        return undefined;
      }
      const viewportData = viewportSpecificData[activeViewportIndex];
      const displaySet = findImageSet(viewportData.StudyInstanceUID, viewportData.displaySetInstanceUID)
        || viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex).displaySet;
      if (!displaySet?.images?.length) {
        throw new Error('The series has no images to segment');
      }

      ensureStack(displaySet);
      const { segmentationId } = create({
        displaySet,
        label: segmentationLabelFor(displaySet),
        segments: [{ label: t('Segment {{index}}', { index: 1 }) }],
        origin: 'blank',
      });
      openEditor(displaySet, segmentationId, { viewportData });
      return segmentationId;
    },

    async openModelsAsSegmentation({ displaySetInstanceUID, onProgress = () => {} }) {
      const m3dDisplaySet = getDisplaySet(displaySetInstanceUID);
      const sourceDisplaySet = m3dDisplaySet
        && findM3DSourceDisplaySet(m3dDisplaySet, getStudyDisplaySets(m3dDisplaySet.StudyInstanceUID));
      if (!sourceDisplaySet) {
        throw new Error('The images these models were made from are not in this study');
      }

      // Locked models stay out of the segmentation. Said before the conversion starts, so the
      // user can unlock a model first instead of finding it missing in the editor.
      const m3dSeriesInstanceUID = m3dDisplaySet.SeriesInstanceUID;
      const models = listModels({ m3dSeriesInstanceUID });
      if (!models.unlocked.length && models.locked.length) {
        notify({
          type: 'warning',
          title: t('Open as Segmentation'),
          message: t('All of the models are locked. Unlock a model in the models panel to open it as a segmentation.'),
        });
        return undefined;
      }
      if (models.locked.length && warnsAboutLockedModels()) {
        const { confirmed, suppressed } = await confirm({
          id: 'open-models-as-segmentation-locked', ...lockedModelsWarning(models),
        });
        if (!confirmed) {
          return undefined;
        }
        if (suppressed) {
          stopWarningAboutLockedModels();
        }
      }

      ensureStack(sourceDisplaySet);
      onProgress(t('Converting models...'));
      const result = await convertModels({
        m3dSeriesInstanceUID,
        imageIds: getDisplaySetImageIds(sourceDisplaySet),
      });

      onProgress(t('Opening the editor...'));
      const { segmentationId } = create({
        displaySet: sourceDisplaySet,
        label: m3dDisplaySet.SeriesDescription || segmentationLabelFor(sourceDisplaySet),
        segments: result.segments.map(segment => ({ label: segment.label, color: hexToRgb(segment.color) })),
        origin: 'models',
        labelmapBuffer: result.labelmapBuffer,
        bufferImageIds: result.bufferImageIds,
      });
      openEditor(sourceDisplaySet, segmentationId);

      if (result.emptySegments.length) {
        notify({
          type: 'warning',
          title: t('Open as Segmentation'),
          message: t('These models could not be converted and are empty segments: {{models}}', {
            models: result.emptySegments.map(segment => segment.label).join(', '),
          }),
        });
      }
      if (result.overlapVoxels) {
        notify({
          type: 'info',
          title: t('Open as Segmentation'),
          message: t('Some models overlap. Where they do, the model listed later was kept.'),
        });
      }
      return segmentationId;
    },
  };

  const definitions = {
    createSegmentation: {
      commandFn: actions.createSegmentation,
      storeContexts: ['viewports'],
      options: {},
      context: 'VIEWER',
    },
    openModelsAsSegmentation: {
      commandFn: actions.openModelsAsSegmentation,
      options: {},
      context: 'VIEWER',
    },
  };

  return { actions, definitions };
}
