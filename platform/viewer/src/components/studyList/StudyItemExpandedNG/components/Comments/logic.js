import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSeriesComment,
  createStudyComment,
  fetchSeriesComments,
  fetchStudyComments,
  fetchStudyWorklists,
  removeSeriesComment,
  removeStudyComment,
  updateSeriesComment,
  updateStudyComment,
} from '../../../../../api/ext';


// Query-key namespaces. The per-study rollup is keyed on the series array, not on a single
// UID, so it is invalidated by namespace; the per-resource lists are invalidated by resource.
export const ALL_SERIES_COMMENTS_QUERY_KEY = 'allSeriesDicomExtComments';
export const SERIES_COMMENTS_QUERY_KEY = 'seriesDicomExtComments';
export const STUDY_COMMENTS_QUERY_KEY = 'studyDicomExtComments';


export const useAllSeriesComments = (server, allSeries) => {

  const enabled = !!allSeries?.length > 0;
  return useQuery({
    queryKey: [ALL_SERIES_COMMENTS_QUERY_KEY, allSeries],
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
    queryKey: [SERIES_COMMENTS_QUERY_KEY, series?.SeriesInstanceUID],
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
      await invalidateSeriesComments(queryClient, series);
    },
  });
};


const invalidateSeriesComments = (queryClient, series) => {
  // Refresh the drawer's list for this series and the per-study rollup behind the thumbnail
  // comment counts.
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [ALL_SERIES_COMMENTS_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: [SERIES_COMMENTS_QUERY_KEY, series?.SeriesInstanceUID] }),
  ]);
};


export const useUpdateSeriesComment = (server, series, onSuccessCallback) => {
  // Change the text of a comment on the provided series. Variables: { commentId, text }.

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, text }) => updateSeriesComment(server, series, commentId, text),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await invalidateSeriesComments(queryClient, series);
    },
  });
};


export const useRemoveSeriesComment = (server, series, onSuccessCallback) => {
  // Permanently remove a comment from the provided series

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId) => removeSeriesComment(server, series, commentId),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await invalidateSeriesComments(queryClient, series);
    },
  });
};


export const useStudyComments = (server, studyId) => {
  // Create query methods for DICOM study comments.
  
  // @input server (object): server from which the study comments should be retrieved.
  // @input studyId (str or null/undefined): studyId for which the comments should be retrieved.
  //   if a null/undefined study is provided, an empty array will be returned. This is done to 
  //   accomodate ACL permission checks within components.

  return useQuery({
    queryKey: [STUDY_COMMENTS_QUERY_KEY, studyId],
    queryFn: () => fetchStudyComments(server, studyId),
    enabled: !!studyId,
  });
};


export const useStudyWorklists = (server, studyId) => {
  // Query the worklist items assigned to a study. Powers the review-history timeline in the
  // Study Details drawer. A null/undefined studyId disables the query (ACL-gated at the caller).

  return useQuery({
    queryKey: ['studyWorklists', studyId],
    queryFn: () => fetchStudyWorklists(server, studyId),
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
      await queryClient.invalidateQueries({ queryKey: [STUDY_COMMENTS_QUERY_KEY, studyId] });
    },
  });
};


export const useUpdateStudyComment = (server, studyId, onSuccessCallback) => {
  // Change the text of a comment on the provided study. Variables: { commentId, text }.

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, text }) => updateStudyComment(server, studyId, commentId, text),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await queryClient.invalidateQueries({ queryKey: [STUDY_COMMENTS_QUERY_KEY, studyId] });
    },
  });
};


export const useRemoveStudyComment = (server, studyId, onSuccessCallback) => {
  // Permanently remove a comment from the provided study

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId) => removeStudyComment(server, studyId, commentId),
    onSuccess: async () => {
      if (onSuccessCallback) {
        onSuccessCallback();
      }
      await queryClient.invalidateQueries({ queryKey: [STUDY_COMMENTS_QUERY_KEY, studyId] });
    },
  });
};
