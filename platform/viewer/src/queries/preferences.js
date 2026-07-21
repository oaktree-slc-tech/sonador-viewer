import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getUserPreferences, getUserPreferenceSection, updateUserPreferences } from '../api/preferences';
import { PREFERENCE_SECTION_PATHS } from '../constants/preferences';
import { submitPreferenceWrite } from '../lib/preferenceWriteQueue';
import { QueryKeys } from '../constants/queryKeys';

export const useUserPreferences = (select) => {
  return useQuery({
    queryKey: [QueryKeys.userPreferences],
    queryFn: getUserPreferences,
    select,
  });
};
export const useUpdateUserPreferences = () => {
  // Whole-document writes are deprecated in favor of the section endpoints (§5.2); the
  // section mutations below are the write path for new work (AR-10).
  return useMutation({
    mutationFn: updateUserPreferences,
  });
};

export const useUserPreferenceSection = (section, version) => {
  return useQuery({
    queryKey: [QueryKeys.userPreferences, section, version],
    queryFn: () => getUserPreferenceSection(section, version),
  });
};

export const useUpdateUserPreferenceSection = (section) => {
  // Section mutation submitted through the persistent write queue (AR-10): resolves with
  // `{ outcome: 'saved' }` on 2xx or `{ outcome: 'queued' }` when a retryable failure
  // enqueued the write (FR-7); rejects on validation failures (400), which are never queued.

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) =>
      submitPreferenceWrite({
        key: PREFERENCE_SECTION_PATHS[section],
        section,
        payload,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.userPreferences] });
    },
  });
};
