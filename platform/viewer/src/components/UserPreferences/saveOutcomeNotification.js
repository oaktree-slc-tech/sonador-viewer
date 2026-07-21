// Shared FR-7 outcome notifications for the User Preferences modal panels: the mutation
// resolves with `{ outcome: 'saved' | 'queued' | 'failed' }` (see
// useUpdateUserPreferenceSection) and rejects on a validation failure, which is never
// queued. `failed` means the write could not be queued either (no authenticated identity)
// -- the change is kept locally but will NOT sync, so the "will sync" promise must not be
// shown.

export const showSaveOutcome = (snackbar, successMessage, sectionLabel) => ({
  onSuccess: ({ outcome }) => {
    if (outcome === 'saved') {
      snackbar.show({
        message: successMessage,
        type: 'success',
      });
    } else if (outcome === 'queued') {
      snackbar.show({
        message: `Saved locally — your ${sectionLabel} will sync when reconnected.`,
        type: 'warning',
      });
    } else {
      snackbar.show({
        message: `Failed to save ${sectionLabel} to the server; the change was kept locally.`,
        type: 'error',
      });
    }
  },
  onError: () => {
    snackbar.show({
      message: `Failed to save ${sectionLabel}: the server rejected the values.`,
      type: 'error',
    });
  },
});
