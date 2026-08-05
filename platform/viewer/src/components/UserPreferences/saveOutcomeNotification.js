// Shared FR-7 outcome notifications for the User Preferences modal panels: the mutation
// resolves with `{ outcome: 'saved' | 'queued' | 'failed' }` (see
// useUpdateUserPreferenceSection) and rejects on a validation failure, which is never
// queued. `failed` means the write could not be queued either (no authenticated identity)
// -- the change is kept locally but will NOT sync, so the "will sync" promise must not be
// shown.

import { uiNotificationService } from '@ohif/core';

export const showSaveOutcome = (successMessage, sectionLabel) => ({
  onSuccess: ({ outcome }) => {
    if (outcome === 'saved') {
      uiNotificationService.show({
        title: successMessage,
        type: 'success',
      });
    } else if (outcome === 'queued') {
      uiNotificationService.show({
        title: 'Saved locally',
        message: `Your ${sectionLabel} will sync when reconnected.`,
        type: 'warning',
      });
    } else {
      uiNotificationService.show({
        title: `Failed to save ${sectionLabel}`,
        message: 'The change was kept locally but will not sync.',
        type: 'error',
      });
    }
  },
  onError: () => {
    uiNotificationService.show({
      title: `Failed to save ${sectionLabel}`,
      message: 'The server rejected the values.',
      type: 'error',
    });
  },
});
