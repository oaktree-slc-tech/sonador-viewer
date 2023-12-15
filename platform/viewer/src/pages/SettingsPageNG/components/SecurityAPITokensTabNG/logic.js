import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createToken, deleteToken, fetchTokens } from '../../../../api/security';

export const useTokens = () => {
  return useQuery({
    queryKey: ['apiTokens'],
    queryFn: () => fetchTokens(),
  });
};

export const useCreateToken = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => createToken(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['apiTokens']);
    },
  });
};

export const useDeleteToken = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => deleteToken(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['apiTokens']);
    },
  });
};
