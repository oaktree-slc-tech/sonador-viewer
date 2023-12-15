import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createAccessIdAndSecretKey, deleteAccessIdAndSecretKey, fetchAccesses } from '../../../../api/security';

export const useAccesses = () => {
  return useQuery({
    queryKey: ['accessIdAndSecretKey'],
    queryFn: () => fetchAccesses(),
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

export const useDeleteAccess = () => {
  const queryClint = useQueryClient();

  return useMutation({
    mutationFn: (data) => deleteAccessIdAndSecretKey(data),
    onSuccess: async () => {
      await queryClint.invalidateQueries(['accessIdAndSecretKey']);
    },
  });
};
