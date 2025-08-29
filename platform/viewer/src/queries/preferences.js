import { useMutation, useQuery } from '@tanstack/react-query';

import { getUserPreferences, updateUserPreferences } from '../api/preferences';
import { QueryKeys } from '../constants/queryKeys';

export const useUserPreferences = (select) => {
  return useQuery({
    queryKey: [QueryKeys.userPreferences],
    queryFn: getUserPreferences,
    select,
  });
};
export const useUpdateUserPreferences = () => {
  return useMutation({
    mutationFn: updateUserPreferences,
  });
};
