import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createAccessIdAndSecretKey, fetchAccesses } from '../../../../api/security';

export const useAccesses = ({ server }) => {
  return useQuery({
    queryKey: ['accessIdAndSecretKey', server?.token],
    queryFn: () => fetchAccesses(server),
    enabled: !!server?.token,
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
