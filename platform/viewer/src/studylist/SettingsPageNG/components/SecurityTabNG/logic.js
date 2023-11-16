import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createAccessIdAndSecretKey, createToken, fetchAccesses, fetchTokens } from '../../../../api/security';

export const useTokens = ({ server, isEnabled }) => {
  return useQuery({
    queryKey: ['apiTokens', server?.token],
    queryFn: () => fetchTokens(server),
    enabled: !!server?.token && isEnabled,
  });
};

export const useCreateToken = () => {
  const queryClint = useQueryClient();

  return useMutation({
    mutationFn: (data) => createToken(data),
    onSuccess: async () => {
      await queryClint.invalidateQueries(['apiTokens']);
    },
  });
};

export const useAccesses = ({ server, isEnabled }) => {
  return useQuery({
    queryKey: ['accessIdAndSecretKey', server?.token],
    queryFn: () => fetchAccesses(server),
    enabled: !!server?.token && isEnabled,
  });
};

export const useCreateAccess = () => {
  const queryClint = useQueryClient();

  return useMutation({
    mutationFn: (data) => createAccessIdAndSecretKey(data),
    onSuccess: async () => {
      await queryClint.invalidateQueries(['accessIdAndSecretKey']);
    },
  });
};
