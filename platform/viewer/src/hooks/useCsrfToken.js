import { useQuery } from '@tanstack/react-query';

import { getCsrfToken } from '../api/security';

export const useCsrfToken = ({ server }) => {
  return useQuery({
    queryKey: ['csrfToken'],
    queryFn: () => getCsrfToken({ server }),
  });
};
