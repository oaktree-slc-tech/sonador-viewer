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
