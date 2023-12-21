import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSeriesComment, fetchSeriesComments } from '../../../../../api/ext';

export const useSeriesComments = (server, series) => {
  // Create query methods for DICOM series comments

  return useQuery({
    queryKey: ['seriesDicomExtComments', series?.SeriesInstanceUID],
    queryFn: () => fetchSeriesComments(server, series),
    enabled: !!series?.SeriesInstanceUID && !!series,
  });
};

export const useCreateComment = (server, series, onSuccessCallback) => {
  // Create a new comment for the provided series

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => createSeriesComment(server, series, data),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await queryClient.invalidateQueries(['seriesDicomExtComments', series?.SeriesInstanceUID]);
    },
  });
};
