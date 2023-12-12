import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createToken, fetchTokens } from '../../../../api/security';

export const useTokens = ({ server }) => {
  return useQuery({
    queryKey: ['apiTokens', server?.token],
    queryFn: () => fetchTokens(server),
    enabled: !!server?.token,
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
