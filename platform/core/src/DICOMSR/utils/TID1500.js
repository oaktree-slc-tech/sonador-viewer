// Provides DICOM-SR TID-1500 Measurement Report Templates with a defined callback
// structure which allows for the injection of custom attributes into a content
// sequence. Used by the Sonador Viewer to preserve description, text, and 
// other extended attributes.

import _ from 'lodash';

import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';
import { normalizers, data as dcmjsData, utilities, derivations } from "dcmjs";

const { TID1500, addAccessors } = utilities;
const { TID1500MeasurementReport: csTID1500MeasurementReport, TID1501MeasurementGroup } = TID1500;


export default class SonadorTID1500MeasurementReport extends csTID1500MeasurementReport {
  // Sonador wrapper around TID1500 Measurement Report. Provides patched methdos to allow
  // for injection of extended attributes to the measurement report instances.

    addTID1501MeasurementGroups(derivationSourceDatasets, options = {}) {
      // Add TID1501 Measurement Groups to the measurement report

      // @input derivationSourceDatasets: iterable of source data to be added to the sequence
      // @input options (object): options for the method
      //    @callback: onContentItemCreate
      const {
        CurrentRequestedProcedureEvidenceSequence,
        ImageLibraryContentSequence
      } = this;

      const { sopInstanceUIDsToSeriesInstanceUIDMap } = options;

      if (derivationSourceDatasets.length > 1 && sopInstanceUIDsToSeriesInstanceUIDMap === undefined) {
        throw new Error(
          `addTID1501MeasurementGroups provided with ${derivationSourceDatasets.length} derivationSourceDatasets, with no sopInstanceUIDsToSeriesInstanceUIDMap in options.`
        );
      }

      const { TID1501MeasurementGroups } = this.TIDIncludeGroups;

      if (!TID1501MeasurementGroups) {
        return;
      }

      // Create content sequence for the measurement report
      let ContentSequence = [];

      TID1501MeasurementGroups.forEach(child => {

        // Generate child SR item, add to the content sequence, and trigger callback (if defined)
        const childSrItem = child.contentItem();
        ContentSequence = ContentSequence.concat(childSrItem);

        if (_.isFunction(options.onContentItemCreate)) {
          options.onContentItemCreate(child, childSrItem);
        }
      });

      const parsedSOPInstances = [];

      // For each measurement that is referenced, add a link to the
      // Image Library Group and the Current Requested Procedure Evidence
      // with the proper ReferencedSOPSequence
      TID1501MeasurementGroups.forEach(measurementGroup => {
        measurementGroup.TID300Measurements.forEach(measurement => {
          const { ReferencedSOPInstanceUID } = measurement.ReferencedSOPSequence;

          if (!parsedSOPInstances.includes(ReferencedSOPInstanceUID)) {
            ImageLibraryContentSequence.push({
              RelationshipType: "CONTAINS",
              ValueType: "IMAGE",
              ReferencedSOPSequence: measurement.ReferencedSOPSequence
            });

            let derivationSourceDataset;

            if (derivationSourceDatasets.length === 1) {
                
              // If there is only one derivationSourceDataset, use it.
              derivationSourceDataset = derivationSourceDatasets[0];
              
            } else {
              const SeriesInstanceUID = sopInstanceUIDsToSeriesInstanceUIDMap[ ReferencedSOPInstanceUID ];

              derivationSourceDataset = derivationSourceDatasets.find(
                dsd => dsd.SeriesInstanceUID === SeriesInstanceUID
              );
            }

            /**
             * Note: the VM of the ReferencedSeriesSequence and ReferencedSOPSequence are 1, so
             * it is correct that we have a full `CurrentRequestedProcedureEvidenceSequence`
             * item per `SOPInstanceUID`.
             */
            CurrentRequestedProcedureEvidenceSequence.push({
              StudyInstanceUID: derivationSourceDataset.StudyInstanceUID,
              ReferencedSeriesSequence: {
                SeriesInstanceUID: derivationSourceDataset.SeriesInstanceUID,
                ReferencedSOPSequence: measurement.ReferencedSOPSequence
              }
            });

            parsedSOPInstances.push(ReferencedSOPInstanceUID);
          }
        });
      });

      const ImagingMeasurments = {
          RelationshipType: "CONTAINS",
          ValueType: "CONTAINER",
          ConceptNameCodeSequence: {
              CodeValue: "126010",
              CodingSchemeDesignator: "DCM",
              CodeMeaning: "Imaging Measurements" // TODO: would be nice to abstract the code sequences (in a dictionary? a service?)
          },
          ContinuityOfContent: "SEPARATE",
          ContentSequence
      };

      this.tid1500.ContentSequence.push(ImagingMeasurments);
  }
}