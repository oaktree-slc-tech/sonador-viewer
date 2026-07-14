import { utils, classes, DicomMetadataStore } from '@ohif/core';
import { components } from '@ohif/extension-cornerstone';

const { studyMetadataManager } = utils;
const { ImageSet } = classes;
const { DicomTagBrowser } = components;

/**
 * Build the displaySets array the ported OHIF-v3 DicomTagBrowser expects.
 *
 * The v3 component reads tag values directly off the display set
 * (`activeDisplaySet.images[i]` for an ImageSet), assuming each image IS a
 * naturalized, keyword-keyed instance dataset. In the Sonador viewer the v2
 * `studyMetadataManager` display sets instead hold `OHIFInstanceMetadata`
 * wrappers, so we cannot hand those straight to the component.
 *
 * Rather than unwrap the wrappers (which bypasses the central metadata store),
 * we source the instance metadata from the `DicomMetadataStore` — the single
 * authoritative, already-naturalized copy that the Sonador loader populates for
 * every instance. We keep the v2 display sets only for their series-listing
 * chrome (displaySetInstanceUID, SeriesNumber, label fields) and rebuild each
 * as an `ImageSet` whose `images` are the store's naturalized instances. This
 * yields exactly the shape v3 expects while keeping all tag data flowing
 * through the DicomMetadataStore.
 */
function buildDisplaySetsFromStore(StudyInstanceUID, sourceDisplaySets) {
  return sourceDisplaySets.map(sourceDisplaySet => {
    const { SeriesInstanceUID } = sourceDisplaySet;

    const series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
    const instances = series ? series.instances : [];

    if (!instances || instances.length === 0) {
      console.warn(
        `[DICOMTagBrowser] No instances found in DicomMetadataStore for series ${SeriesInstanceUID}.`
      );
    }

    // Sort by InstanceNumber so the instance scrubber walks slices in order.
    // Copy the array first to avoid mutating the store's instance list.
    const sortedInstances = [...(instances || [])].sort(
      (a, b) => (a.InstanceNumber ?? 0) - (b.InstanceNumber ?? 0)
    );

    const imageSet = new ImageSet(sortedInstances);

    // Series-listing chrome consumed by the component's Series dropdown.
    imageSet.setAttributes({
      displaySetInstanceUID: sourceDisplaySet.displaySetInstanceUID,
      StudyInstanceUID,
      SeriesInstanceUID,
      SeriesDate: sourceDisplaySet.SeriesDate,
      SeriesTime: sourceDisplaySet.SeriesTime,
      SeriesNumber: sourceDisplaySet.SeriesNumber,
      SeriesDescription: sourceDisplaySet.SeriesDescription,
      Modality: sourceDisplaySet.Modality,
    });

    return imageSet;
  });
}

export default function getCommandsModule(servicesManager) {
  // Retrieve the available commands for the module

  const actions = {
    openDICOMTagViewer({ viewports }) {
      // Open the DICOM tag viewer for the currently active study

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const activeViewportSpecificData = viewportSpecificData[activeViewportIndex];

      const { StudyInstanceUID, displaySetInstanceUID } = activeViewportSpecificData;

      const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
      const sourceDisplaySets = studyMetadata.getDisplaySets();

      // Re-source instance metadata from the central DicomMetadataStore so the
      // ported v3 component receives naturalized instances without bypassing it.
      const displaySets = buildDisplaySetsFromStore(StudyInstanceUID, sourceDisplaySets);

      // Launch via UIModalService, mirroring how OHIF-v3 opens the DICOM Tag
      // Browser. The OHIFModal (react-modal) centers its content unconditionally
      // and supplies the title + close chrome, so the ported v3 component is used
      // directly without an additional dialog-shell wrapper.
      const { UIModalService } = servicesManager.services;

      UIModalService.show({
        content: DicomTagBrowser,
        contentProps: {
          displaySets,
          displaySetInstanceUID,
        },
        title: 'DICOM Tag Browser',
        shouldCloseOnEsc: true,
      });
    },
  };

  const definitions = {
    openDICOMTagViewer: {
      commandFn: actions.openDICOMTagViewer,
      storeContexts: ['servers', 'viewports'],
    },
  };

  return {
    actions,
    definitions,
  };
}
