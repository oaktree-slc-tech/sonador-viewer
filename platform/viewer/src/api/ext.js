// Methods for retrieving data from the DICOM-EXT API of an imaging server
import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken } from './sonador';


export const fetchSeriesComments = (server, series) => {
  // Retrieve comments for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', series.SeriesInstanceUID, 'comments'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};


export const createSeriesComment = (server, series, text) => {
  // Create a comment for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', series.SeriesInstanceUID, 'comments'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ Text: text }),
  });
};


export const fetchStudyComments = (server, studyId) => {
  // Retrieve comments for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'comments'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};


export const createStudyComment = (server, studyId, text) => {
  // Create a comment for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'comments'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ Text: text }),
  });
};

export const fetchDownloadStudies = async (server, studyId) => {
  // Download DICOM Studies data from Orthanc

  // return fetch(urlUtil.urlJoin(server.wadoRoot, 'study', studyId, 'ID', 'archive'), {
  //   headers: { Authorization: `Bearer ${getAuthToken()}` },
  // })
  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'archive');

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch archive: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Create a temporary anchor to trigger the download
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${studyId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Revoke the object URL after download
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download failed:', error);
  }
}

export const fetchDownloadSeries = (server, seriesId) => {
  // Download DICOM Series data from Orthanc

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', seriesId, 'ID', 'archive'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
}
