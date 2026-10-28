// The vocabulary of the 3D tools' handoff (ohif-viewers#152): why it is asked and what the user
// can choose. Shared by the canvas (SegEditorSurfaceView.resolveHandoff), the dialog
// (components/handoffDialog) and the commands, without the dialog's React dependencies.

/** The choices the handoff resolves to. */
export const HANDOFF_CHOICES = {
  // Show today's whole-surface Repair for Apply / Cancel; the switch is refused for now
  repair: 'repair',
  // Keep the 3D surface as it is; the switch is refused
  continue: 'continue',
  // Acknowledge the findings and write the best-effort conversion; the switch proceeds once the
  // write completed
  proceed: 'proceed',
  // Undo the unsynchronized edits back to the checkpoint (Redo restores them); the switch proceeds
  discard: 'discard',
};

/** Why the handoff is asked: the destination, or the user's own request. */
export const HANDOFF_REASONS = {
  sync: 'sync',
  labelmap: 'labelmap',
  target: 'target',
  import: 'import',
  exit: 'exit',
};
