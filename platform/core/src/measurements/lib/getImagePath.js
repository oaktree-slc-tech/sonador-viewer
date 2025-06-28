const getImagePath = (StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameIndex) => {
  /**
  * Function to create imagePath with all imageData related
  * @param {string} StudyInstanceUID
  * @param {string} SeriesInstanceUID
  * @param {string} SOPInstanceUID
  * @param {string} frameIndex
  * @returns
  */

  return [StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameIndex].join('_');
};


export default getImagePath;