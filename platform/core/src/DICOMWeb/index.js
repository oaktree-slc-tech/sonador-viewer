import getAttribute from './getAttribute.js';
import getAuthorizationHeader from './getAuthorizationHeader.js';
import getModalities from './getModalities.js';
import getName from './getName.js';
import getNumber from './getNumber.js';
import getString from './getString.js';

const dcmStudyTags = ['PatientName', 'PatientID', 'AccessionNumber', 'StudyDate', 'StudyDescription'];

const DICOMWeb = {
  dcmStudyTags,
  getAttribute,
  getAuthorizationHeader,
  getModalities,
  getName,
  getNumber,
  getString,
};

export default DICOMWeb;
