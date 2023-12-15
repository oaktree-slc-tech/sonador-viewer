import { useQuery } from '@tanstack/react-query';

import { getCsrfToken } from '../api/security';

export const useCsrfToken = () => {
  return useQuery({
    queryKey: ['csrfToken'],
    queryFn: () => getCsrfToken(),
  });
};
