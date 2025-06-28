import studyMetadataManager from '../../utils/studyMetadataManager';


export default function (imagePath, thumbnail = false) {
  // Retrieve the image ID from the provided image path

  const [StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameIndex] = imagePath.split('_');
    
  // Retriev study metadata
  const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
  if (studyMetadata) {

    // Retrieve series
    const series = studyMetadata.getSeriesByUID(SeriesInstanceUID);
    if (series) {

      // Retrieve instance
      const instance = series.getInstanceByUID(SOPInstanceUID);
      if (instance) {

        // Determine Image ID from the frame index
        return instance.getImageId(frameIndex, thumbnail);
      }
    }
  }
  
  
  return undefined;
}
