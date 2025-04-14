import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSeriesComment,
  createStudyComment,
  fetchSeriesComments,
  fetchStudyComments,
} from '../../../../../api/ext';

export const useAllSeriesComments = (server, allSeries) => {

  const enabled = !!allSeries?.length > 0;
  return useQuery({
    queryKey: ['allSeriesDicomExtComments', allSeries, ],
    queryFn: () => {
      return Promise.all(
        allSeries.map(async series => {
          const response = await fetchSeriesComments(server, series);
          return {
            response,
            SeriesInstanceUID: series.SeriesInstanceUID,
          }
        }));
    },
    enabled,
  });
};
export const useSeriesComments = (server, series) => {
  // Create query methods for DICOM series comments

  const enabled = !!series?.SeriesInstanceUID && !!series;
  return useQuery({
    queryKey: ['seriesDicomExtComments', series?.SeriesInstanceUID],
    queryFn: () => fetchSeriesComments(server, series),
    enabled,
  });
};

export const useCreateSeriesComment = (server, series, onSuccessCallback) => {
  // Create a new comment for the provided series

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => createSeriesComment(server, series, data),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await Promise.all([
        queryClient.invalidateQueries(['allSeriesDicomExtComments', series?.SeriesInstanceUID]),
        queryClient.invalidateQueries(['seriesDicomExtComments', series?.SeriesInstanceUID])
      ]) ;
    },
  });
};

export const useStudyComments = (server, studyId) => {
  // Create query methods for DICOM study comments

  return useQuery({
    queryKey: ['studyDicomExtComments', studyId],
    queryFn: () => fetchStudyComments(server, studyId),
    enabled: !!studyId,
  });
};

export const useCreateStudyComment = (server, studyId, onSuccessCallback) => {
  // Create a new comment for the provided series

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => {
      return createStudyComment(server, studyId, data);
    },
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await queryClient.invalidateQueries(['studyDicomExtComments', studyId]);
    },
  });
};
