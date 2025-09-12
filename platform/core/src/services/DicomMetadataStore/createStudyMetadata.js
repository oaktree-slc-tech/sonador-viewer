import _ from 'lodash';
import createSeriesMetadata from './createSeriesMetadata';


function createStudyMetadata(StudyInstanceUID) {
  // Add study metadata to the DICOM store

  return {
    StudyInstanceUID,
    StudyDescription: '',
    ModalitiesInStudy: [],
    isLoaded: false,
    series: [],
    StudyMeta: {},
    /**
     * @param {object} instance
     */
    addInstanceToSeries: function (instance) {
      this.addInstancesToSeries([instance]);
    },
    
    addInstancesToSeries: function (instances) {
      /** Add instances to the study. Instances will be indexed and added to the series
       *  they belong to.
       * 
       * @param {object[]} instances
       * @param {string} instances[].SeriesInstanceUID
       * @param {string} instances[].StudyDescription
      */

      const { SeriesInstanceUID } = instances[0];
      if (!this.StudyDescription) {
        this.StudyDescription = instances[0].StudyDescription;
      }
      let series = this.series.find((s) => s.SeriesInstanceUID === SeriesInstanceUID);

      if (!series) {
        series = createSeriesMetadata(SeriesInstanceUID);
        this.series.push(series);
      }

      series.addInstances(instances);
    },

    setSeriesMetadata: function (SeriesInstanceUID, seriesMetadata) {
      let existingSeries = this.series.find((s) => s.SeriesInstanceUID === SeriesInstanceUID);

      if (existingSeries) {
        existingSeries = Object.assign(existingSeries, seriesMetadata);
      } else {
        const series = createSeriesMetadata(SeriesInstanceUID);
        this.series.push(Object.assign(series, seriesMetadata));
      }
    },

    setStudyMetadata: function(studyMetadata) {
      /** Add metadata properties to the study
       * 
       * @param {object} studyMetadata: properties to add to the study instance\
       * @returns copy of the study metadata
      */
      _.extend(this.StudyMeta, studyMetadata);

      return this.StudyMeta;
    },

    getStudyMetadata: function() {
      /** Retrieve study metadata       
       * @returns copy of the study metadata
      */
      return this.StudyMeta;
    }


  };
}


export default createStudyMetadata;
